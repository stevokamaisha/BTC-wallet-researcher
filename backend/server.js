import express from 'express';

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '24kb' }));

const PORT = Number(process.env.PORT || 10000);
const OPENAI_API_KEY = String(process.env.OPENAI_API_KEY || '').trim();
const APP_ACCESS_TOKEN = String(process.env.APP_ACCESS_TOKEN || '').trim();
const OPENAI_MODEL = String(process.env.OPENAI_MODEL || 'gpt-5.6-luna').trim();
const MAX_STARTS_PER_HOUR = Number(process.env.MAX_STARTS_PER_HOUR || 20);

const buckets = new Map();

function requireAppToken(req, res, next) {
  if (!APP_ACCESS_TOKEN) {
    return res.status(503).json({ error: 'Server is missing APP_ACCESS_TOKEN.' });
  }
  const supplied = String(req.get('X-App-Token') || '').trim();
  if (!supplied || supplied !== APP_ACCESS_TOKEN) {
    return res.status(401).json({ error: 'Invalid app access token.' });
  }
  next();
}

function rateLimit(req, res, next) {
  const now = Date.now();
  const hour = 60 * 60 * 1000;
  const key = String(req.ip || 'unknown');
  const current = buckets.get(key) || [];
  const fresh = current.filter((t) => now - t < hour);
  if (fresh.length >= MAX_STARTS_PER_HOUR) {
    return res.status(429).json({ error: 'Hourly deep-search limit reached. Try again later.' });
  }
  fresh.push(now);
  buckets.set(key, fresh);
  next();
}

async function openai(path, options = {}) {
  if (!OPENAI_API_KEY) throw new Error('Server is missing OPENAI_API_KEY.');
  const response = await fetch('https://api.openai.com/v1' + path, {
    ...options,
    headers: {
      'Authorization': 'Bearer ' + OPENAI_API_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : {}; }
  catch { data = { error: { message: text || 'Invalid OpenAI response' } }; }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || ('OpenAI HTTP ' + response.status);
    const err = new Error(message);
    err.status = response.status;
    throw err;
  }
  return data;
}

function categoryInstruction(category) {
  const map = {
    airdrop: 'Focus on official airdrops with current eligibility or claim windows.',
    protocol: 'Focus on protocol rewards or distributions that users can legitimately claim based on their own eligible activity/address.',
    bounty: 'Focus on explicitly public bounties or crypto puzzles whose issuer clearly authorizes public participation.',
    mining: 'Focus on active proof-of-work mining or other new-issuance opportunities; distinguish issuance from free claims.',
    testnet: 'Focus on official testnet, points, incentive, or participation programs with current public eligibility.',
    all: 'Search across official airdrops, protocol rewards, explicitly public bounties/puzzles, mining/new issuance, and testnet/incentive programs.'
  };
  return map[category] || map.all;
}

function buildPrompt(query, category, depth) {
  const depthText = depth === 'max'
    ? 'Search broadly and keep cross-checking until you have high confidence. Inspect many relevant public sources when useful.'
    : depth === 'deep'
      ? 'Search broadly and cross-check important claims against multiple sources where possible.'
      : 'Search efficiently and prioritize the strongest current sources.';

  return [
    'You are the public-web research engine for a crypto opportunity research application.',
    '',
    'USER REQUEST:',
    query,
    '',
    'SEARCH SCOPE:',
    categoryInstruction(category),
    depthText,
    '',
    'RESEARCH RULES:',
    '- Search the public indexed web. Prioritize official project sites, official documentation, foundations, official GitHub repositories, official announcements, and primary sources.',
    '- You may use reputable news, forums, social posts, and community discussions for leads, but verify material claims against a primary/official source whenever possible.',
    '- Never classify a dormant, inactive, lost, old, or high-balance third-party wallet as abandoned or claimable merely because it has not moved.',
    '- Never seek, generate, expose, guess, brute-force, or instruct the user to obtain another person\'s seed phrase, private key, wallet password, or authentication secret.',
    '- Treat any site asking the user to reveal a seed phrase/private key as suspicious and say so.',
    '- For a public crypto puzzle or bounty, include it only if the issuer explicitly published it for public solving/participation.',
    '- Distinguish active, expired, announced-but-not-live, unverified, and suspicious opportunities.',
    '- Do not imply that remaining token supply is free to claim. Explain mining/hardware/eligibility requirements.',
    '- Note geographic/KYC restrictions when official sources specify them.',
    '- Prefer current information and identify dates/deadlines.',
    '',
    'OUTPUT FORMAT:',
    'Start with a concise summary. Then list the strongest opportunities found. For each include:',
    '1) Project/opportunity name',
    '2) Chain/token',
    '3) Opportunity type',
    '4) Current status',
    '5) What a legitimate participant must do',
    '6) Reward/amount if officially stated',
    '7) Eligibility and geographic/KYC restrictions if known',
    '8) Deadline/claim window if known',
    '9) Official source(s)',
    '10) Verification notes and scam warnings',
    '',
    'End with a section called "Rejected / unverified leads" for notable results that could not be verified or looked suspicious.',
    'Use inline citations from web search and keep the report factual.'
  ].join('\n');
}

function toolForDepth(depth) {
  const tool = {
    type: 'web_search',
    search_context_size: depth === 'quick' ? 'medium' : 'high'
  };
  if (depth === 'max') tool.return_token_budget = 'unlimited';
  return tool;
}

function extractText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const parts = [];
  for (const item of response?.output || []) {
    if (item?.type !== 'message') continue;
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') parts.push(content.text);
    }
  }
  return parts.join('\n\n').trim();
}

function extractSources(response) {
  const found = new Map();

  function add(url, title) {
    if (!url || typeof url !== 'string') return;
    if (!/^https?:\/\//i.test(url)) return;
    if (!found.has(url)) found.set(url, { url, title: title || url });
  }

  function walk(value) {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const x of value) walk(x);
      return;
    }
    if (typeof value !== 'object') return;

    if (value.type === 'url_citation') {
      add(value.url || value.url_citation?.url, value.title || value.url_citation?.title);
    }
    if (value.url && (value.type === 'source' || value.type === 'web_search_result')) {
      add(value.url, value.title);
    }
    if (Array.isArray(value.sources)) {
      for (const s of value.sources) add(s?.url, s?.title);
    }

    for (const child of Object.values(value)) walk(child);
  }

  walk(response?.output || []);
  return [...found.values()].slice(0, 100);
}

app.get('/health', (req, res) => {
  res.json({
    ok: true,
    service: 'crypto-claim-research-backend',
    version: '10.0',
    model: OPENAI_MODEL,
    openaiConfigured: Boolean(OPENAI_API_KEY),
    accessTokenConfigured: Boolean(APP_ACCESS_TOKEN)
  });
});

app.post('/api/search', requireAppToken, rateLimit, async (req, res) => {
  try {
    const query = String(req.body?.query || '').trim();
    const category = String(req.body?.category || 'all').trim().toLowerCase();
    const depth = ['quick', 'deep', 'max'].includes(String(req.body?.depth || 'deep'))
      ? String(req.body.depth)
      : 'deep';

    if (query.length < 5) return res.status(400).json({ error: 'Search query is too short.' });
    if (query.length > 1800) return res.status(400).json({ error: 'Search query is too long.' });

    const requestBody = {
      model: OPENAI_MODEL,
      input: buildPrompt(query, category, depth),
      tools: [toolForDepth(depth)],
      tool_choice: 'auto',
      include: ['web_search_call.action.sources'],
      background: true,
      store: true,
      max_output_tokens: depth === 'quick' ? 5000 : 9000
    };

    if (depth !== 'quick') {
      requestBody.reasoning = { effort: depth === 'max' ? 'high' : 'medium' };
    }

    const response = await openai('/responses', {
      method: 'POST',
      body: JSON.stringify(requestBody)
    });

    res.json({ id: response.id, status: response.status || 'queued', model: OPENAI_MODEL });
  } catch (e) {
    console.error('start search error:', e.message);
    res.status(e.status || 500).json({ error: e.message || 'Unable to start deep search.' });
  }
});

app.get('/api/search/:id', requireAppToken, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!/^resp_[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'Invalid response ID.' });
    const response = await openai('/responses/' + encodeURIComponent(id), { method: 'GET' });
    const status = response.status || 'unknown';
    res.json({
      id: response.id,
      status,
      text: status === 'completed' ? extractText(response) : '',
      sources: status === 'completed' ? extractSources(response) : [],
      error: response?.error?.message || response?.incomplete_details?.reason || null
    });
  } catch (e) {
    console.error('retrieve search error:', e.message);
    res.status(e.status || 500).json({ error: e.message || 'Unable to retrieve deep search.' });
  }
});

app.post('/api/search/:id/cancel', requireAppToken, async (req, res) => {
  try {
    const id = String(req.params.id || '');
    if (!/^resp_[A-Za-z0-9_-]+$/.test(id)) return res.status(400).json({ error: 'Invalid response ID.' });
    const response = await openai('/responses/' + encodeURIComponent(id) + '/cancel', {
      method: 'POST',
      body: '{}'
    });
    res.json({ id: response.id, status: response.status || 'cancelled' });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Unable to cancel search.' });
  }
});


const ESPLORA_PROVIDERS = [
  {
    name: 'Blockstream',
    base: 'https://blockstream.info/api',
    explorer: 'https://blockstream.info/address/'
  },
  {
    name: 'mempool.space',
    base: 'https://mempool.space/api',
    explorer: 'https://mempool.space/address/'
  }
];

const chainCache = new Map();
const CHAIN_CACHE_MS = 10 * 60 * 1000;

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': options.accept || 'application/json,text/plain,*/*',
        'User-Agent': 'CryptoClaimWalletResearcher/10.0 (+public blockchain research)',
        ...(options.headers || {})
      }
    });
    const text = await response.text();
    if (!response.ok) {
      const err = new Error('HTTP ' + response.status + ' from ' + new URL(url).hostname);
      err.status = response.status;
      err.body = text.slice(0, 300);
      throw err;
    }
    return { response, text };
  } finally {
    clearTimeout(timer);
  }
}

function yearsAgo(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / (365.2425 * 86400000);
}

function cacheGet(key) {
  const hit = chainCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.time > CHAIN_CACHE_MS) {
    chainCache.delete(key);
    return null;
  }
  return hit.value;
}

function cachePut(key, value) {
  chainCache.set(key, { time: Date.now(), value });
  return value;
}

async function esploraText(path, timeoutMs = 12000) {
  const cacheKey = 'text:' + path;
  const cached = cacheGet(cacheKey);
  if (cached != null) return cached;

  const errors = [];
  for (const provider of ESPLORA_PROVIDERS) {
    try {
      const { text } = await fetchWithTimeout(
        provider.base + path,
        { accept: 'application/json,text/plain,*/*' },
        timeoutMs
      );
      const value = { text, provider };
      cachePut(cacheKey, value);
      return value;
    } catch (e) {
      errors.push(provider.name + ': ' + (e.message || String(e)));
    }
  }
  throw new Error(errors.join(' | '));
}

async function esploraJson(path, timeoutMs = 12000) {
  const cacheKey = 'json:' + path;
  const cached = cacheGet(cacheKey);
  if (cached != null) return cached;

  const errors = [];
  for (const provider of ESPLORA_PROVIDERS) {
    try {
      const { text } = await fetchWithTimeout(
        provider.base + path,
        { accept: 'application/json' },
        timeoutMs
      );
      const value = { data: JSON.parse(text), provider };
      cachePut(cacheKey, value);
      return value;
    } catch (e) {
      errors.push(provider.name + ': ' + (e.message || String(e)));
    }
  }
  throw new Error(errors.join(' | '));
}

async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;

  async function run() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (e) {
        results[i] = { __error: e.message || String(e), input: items[i] };
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(run());
  await Promise.all(workers);
  return results;
}

function discoveryConfig(depth) {
  if (depth >= 500) {
    return { blocks: 14, txPages: 2, candidateBudget: 160, concurrency: 6 };
  }
  if (depth >= 300) {
    return { blocks: 10, txPages: 2, candidateBudget: 110, concurrency: 5 };
  }
  return { blocks: 6, txPages: 1, candidateBudget: 70, concurrency: 4 };
}

async function getTipHeight() {
  const result = await esploraText('/blocks/tip/height', 10000);
  const height = Number(result.text);
  if (!Number.isFinite(height) || height < 1) throw new Error('Invalid Bitcoin tip height.');
  return { height: Math.floor(height), provider: result.provider.name };
}

async function getHistoricalBlockTransactions(height, txPages) {
  const hashResult = await esploraText('/block-height/' + height, 10000);
  const hash = String(hashResult.text || '').trim();
  if (!/^[0-9a-f]{64}$/i.test(hash)) throw new Error('Invalid block hash for height ' + height);

  const pages = [];
  for (let page = 0; page < txPages; page++) {
    const startIndex = page * 25;
    const result = await esploraJson('/block/' + hash + '/txs/' + startIndex, 14000);
    const txs = Array.isArray(result.data) ? result.data : [];
    pages.push(...txs);
    if (txs.length < 25) break;
  }

  return {
    height,
    hash,
    provider: hashResult.provider.name,
    transactions: pages
  };
}

function collectOutputCandidates(blocks, budget) {
  const map = new Map();

  for (const block of blocks) {
    if (!block || block.__error || !Array.isArray(block.transactions)) continue;

    for (const tx of block.transactions) {
      const outputs = tx && Array.isArray(tx.vout) ? tx.vout : [];
      for (const out of outputs) {
        const address = out && out.scriptpubkey_address;
        const value = Number(out && out.value);
        if (!address || !Number.isFinite(value) || value <= 0) continue;
        if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,90}$/i.test(address)) continue;

        const current = map.get(address) || {
          address,
          historicalOutputSats: 0,
          sampledHeights: []
        };
        current.historicalOutputSats += value;
        if (!current.sampledHeights.includes(block.height)) current.sampledHeights.push(block.height);
        map.set(address, current);
      }
    }
  }

  return [...map.values()]
    .sort((a, b) => b.historicalOutputSats - a.historicalOutputSats)
    .slice(0, budget);
}

async function addressBalanceSnapshot(candidate) {
  const encoded = encodeURIComponent(candidate.address);
  const result = await esploraJson('/address/' + encoded, 11000);
  const info = result.data || {};
  const chain = info.chain_stats || {};
  const mempool = info.mempool_stats || {};

  const funded = Number(chain.funded_txo_sum || 0);
  const spent = Number(chain.spent_txo_sum || 0);
  const memFunded = Number(mempool.funded_txo_sum || 0);
  const memSpent = Number(mempool.spent_txo_sum || 0);

  return {
    ...candidate,
    balance: (funded - spent + memFunded - memSpent) / 1e8,
    received: funded / 1e8,
    spent: spent / 1e8,
    unconfirmed: (memFunded - memSpent) / 1e8,
    txCount: Number(chain.tx_count || 0) + Number(mempool.tx_count || 0),
    provider: result.provider.name
  };
}

async function addLatestActivity(candidate) {
  const encoded = encodeURIComponent(candidate.address);
  const result = await esploraJson('/address/' + encoded + '/txs', 12000);
  const txs = Array.isArray(result.data) ? result.data : [];
  let latest = null;

  for (const tx of txs) {
    const timestamp = tx && tx.status && tx.status.confirmed
      ? Number(tx.status.block_time || 0)
      : 0;
    if (timestamp) {
      latest = new Date(timestamp * 1000);
      break;
    }
  }

  return {
    ...candidate,
    lastActivity: latest ? latest.toISOString() : null,
    dormantYears: latest ? yearsAgo(latest) : null,
    verificationProvider: result.provider.name,
    explorerUrl: result.provider.explorer + encoded
  };
}

async function discoverFromPublicChain({ years, minBalance, limit, depth, cursor }) {
  const config = discoveryConfig(depth);
  const tip = await getTipHeight();

  const blocksPerYear = 365.2425 * 144;
  const ageBlocks = Math.max(1, Math.floor(years * blocksPerYear));
  const pageStride = 1008; // about one week
  const cursorOffset = cursor * config.blocks * pageStride;
  const baseHeight = Math.max(1, tip.height - ageBlocks - cursorOffset);

  const heights = [];
  for (let i = 0; i < config.blocks; i++) {
    const h = Math.max(1, baseHeight - i * pageStride);
    heights.push(h);
  }

  const blockResults = await mapLimit(
    heights,
    3,
    (height) => getHistoricalBlockTransactions(height, config.txPages)
  );

  const goodBlocks = blockResults.filter((x) => x && !x.__error);
  const blockErrors = blockResults
    .filter((x) => x && x.__error)
    .map((x) => x.__error);

  if (!goodBlocks.length) {
    throw new Error('Could not read any historical Bitcoin blocks. ' + blockErrors.join(' | '));
  }

  const candidates = collectOutputCandidates(goodBlocks, config.candidateBudget);
  if (!candidates.length) {
    return {
      ok: true,
      source: 'Bitcoin blockchain via Esplora',
      tipHeight: tip.height,
      blocksRequested: heights.length,
      blocksRead: goodBlocks.length,
      checked: 0,
      fundedChecked: 0,
      cursor,
      nextCursor: cursor + 1,
      results: [],
      nearMatches: [],
      providerErrors: blockErrors,
      message: 'Historical blocks were read successfully, but no standard Bitcoin address outputs were found in this slice.'
    };
  }

  const snapshotsRaw = await mapLimit(
    candidates,
    config.concurrency,
    addressBalanceSnapshot
  );
  const snapshots = snapshotsRaw.filter((x) => x && !x.__error);
  const snapshotErrors = snapshotsRaw
    .filter((x) => x && x.__error)
    .map((x) => x.__error);

  const funded = snapshots
    .filter((x) => Number.isFinite(x.balance) && x.balance >= minBalance)
    .sort((a, b) => b.balance - a.balance);

  const activityBudget = Math.min(
    funded.length,
    Math.max(limit * 6, depth >= 500 ? 40 : depth >= 300 ? 30 : 20)
  );

  const detailedRaw = await mapLimit(
    funded.slice(0, activityBudget),
    Math.min(config.concurrency, 4),
    addLatestActivity
  );
  const detailed = detailedRaw.filter((x) => x && !x.__error);
  const activityErrors = detailedRaw
    .filter((x) => x && x.__error)
    .map((x) => x.__error);

  const exact = detailed
    .filter((x) => x.dormantYears != null && x.dormantYears >= years)
    .sort((a, b) => (b.dormantYears || 0) - (a.dormantYears || 0) || b.balance - a.balance)
    .slice(0, limit);

  const exactAddresses = new Set(exact.map((x) => x.address));
  const nearMatches = detailed
    .filter((x) => !exactAddresses.has(x.address) && x.dormantYears != null)
    .sort((a, b) => (b.dormantYears || 0) - (a.dormantYears || 0) || b.balance - a.balance)
    .slice(0, Math.min(limit, 5));

  return {
    ok: true,
    source: 'Bitcoin blockchain via Blockstream/mempool Esplora',
    tipHeight: tip.height,
    targetHeight: baseHeight,
    blocksRequested: heights.length,
    blocksRead: goodBlocks.length,
    checked: snapshots.length,
    fundedChecked: funded.length,
    activityChecked: detailed.length,
    cursor,
    nextCursor: cursor + 1,
    results: exact,
    nearMatches,
    providerErrors: [...blockErrors, ...snapshotErrors, ...activityErrors].slice(0, 12),
    message: exact.length
      ? 'Search completed with matching dormant funded addresses.'
      : 'Search completed. No exact match in this blockchain slice; near matches are included when available.'
  };
}

app.get('/api/wallets/health', async (req, res) => {
  const checks = {
    backend: { ok: true, detail: 'Render backend online' },
    blockstream: { ok: false, detail: '' },
    mempool: { ok: false, detail: '' }
  };

  const tests = await Promise.allSettled(
    ESPLORA_PROVIDERS.map(async (provider) => {
      const { text } = await fetchWithTimeout(
        provider.base + '/blocks/tip/height',
        { accept: 'text/plain' },
        10000
      );
      const height = Number(text);
      if (!Number.isFinite(height)) throw new Error('Invalid block height');
      return { name: provider.name, height: Math.floor(height) };
    })
  );

  tests.forEach((result, i) => {
    const key = i === 0 ? 'blockstream' : 'mempool';
    if (result.status === 'fulfilled') {
      checks[key] = {
        ok: true,
        detail: 'height ' + result.value.height
      };
    } else {
      checks[key] = {
        ok: false,
        detail: result.reason.message || String(result.reason)
      };
    }
  });

  res.json({
    ok: true,
    version: '10.0',
    checks,
    usable: checks.blockstream.ok || checks.mempool.ok
  });
});

app.get('/api/wallets/discover', async (req, res) => {
  const years = Math.min(20, Math.max(1, Number(req.query.years || 10)));
  const minBalance = Math.min(1000000, Math.max(0, Number(req.query.min || 0.01)));
  const limit = Math.min(10, Math.max(1, Math.floor(Number(req.query.limit || 5))));
  const depth = [200, 300, 500].includes(Number(req.query.depth)) ? Number(req.query.depth) : 200;
  const cursor = Math.max(0, Math.floor(Number(req.query.cursor || 0)));

  try {
    const data = await discoverFromPublicChain({ years, minBalance, limit, depth, cursor });
    res.json(data);
  } catch (e) {
    console.error('wallet discovery error:', e.message);
    res.status(502).json({
      error: 'Bitcoin discovery providers are temporarily unavailable.',
      detail: e.message || String(e)
    });
  }
});


function isLikelyBitcoinAddress(address) {
  return /^(bc1)[0-9a-z]{20,90}$/i.test(address) ||
         /^[13][a-km-zA-HJ-NP-Z1-9]{25,62}$/.test(address);
}

function normalizeEsploraAddress(address, info, txs, providerName, explorerBase) {
  const chain = info?.chain_stats || {};
  const mempool = info?.mempool_stats || {};
  const funded = Number(chain.funded_txo_sum || 0);
  const spent = Number(chain.spent_txo_sum || 0);
  const memFunded = Number(mempool.funded_txo_sum || 0);
  const memSpent = Number(mempool.spent_txo_sum || 0);

  let latest = null;
  if (Array.isArray(txs)) {
    for (const tx of txs) {
      const t = tx?.status?.confirmed ? Number(tx?.status?.block_time || 0) : 0;
      if (t) {
        latest = new Date(t * 1000);
        break;
      }
    }
  }

  return {
    ok: true,
    address,
    chain: 'bitcoin',
    chainName: 'Bitcoin',
    symbol: 'BTC',
    balance: (funded - spent + memFunded - memSpent) / 1e8,
    received: funded / 1e8,
    spent: spent / 1e8,
    unconfirmed: (memFunded - memSpent) / 1e8,
    txCount: Number(chain.tx_count || 0) + Number(mempool.tx_count || 0),
    lastActivity: latest ? latest.toISOString() : null,
    dormantYears: latest ? yearsAgo(latest) : null,
    providers: [providerName],
    explorerUrl: explorerBase + encodeURIComponent(address)
  };
}

async function lookupBitcoinEsplora(address, base, providerName, explorerBase) {
  const encoded = encodeURIComponent(address);
  const [infoResult, txResult] = await Promise.all([
    fetchWithTimeout(base + '/address/' + encoded, { accept: 'application/json' }, 12000),
    fetchWithTimeout(base + '/address/' + encoded + '/txs', { accept: 'application/json' }, 12000)
  ]);

  return normalizeEsploraAddress(
    address,
    JSON.parse(infoResult.text),
    JSON.parse(txResult.text),
    providerName,
    explorerBase
  );
}

async function lookupBitcoinBlockCypher(address) {
  const encoded = encodeURIComponent(address);
  const { text } = await fetchWithTimeout(
    'https://api.blockcypher.com/v1/btc/main/addrs/' + encoded + '?limit=50',
    { accept: 'application/json' },
    12000
  );
  const data = JSON.parse(text);

  let latest = null;
  for (const ref of [...(data.txrefs || []), ...(data.unconfirmed_txrefs || [])]) {
    if (!ref?.confirmed) continue;
    const d = new Date(ref.confirmed);
    if (!Number.isNaN(d.getTime()) && (!latest || d > latest)) latest = d;
  }

  return {
    ok: true,
    address,
    chain: 'bitcoin',
    chainName: 'Bitcoin',
    symbol: 'BTC',
    balance: Number(data.final_balance ?? data.balance ?? 0) / 1e8,
    received: Number(data.total_received || 0) / 1e8,
    spent: Number(data.total_sent || 0) / 1e8,
    unconfirmed: Number(data.unconfirmed_balance || 0) / 1e8,
    txCount: Number(data.final_n_tx ?? data.n_tx ?? 0),
    lastActivity: latest ? latest.toISOString() : null,
    dormantYears: latest ? yearsAgo(latest) : null,
    providers: ['BlockCypher fallback'],
    explorerUrl: 'https://live.blockcypher.com/btc/address/' + encoded + '/'
  };
}

app.get('/api/wallets/address/:address', async (req, res) => {
  const address = String(req.params.address || '').trim();
  const chain = String(req.query.chain || 'bitcoin').trim().toLowerCase();

  if (chain !== 'bitcoin') {
    return res.status(400).json({
      error: 'This reliable lookup endpoint currently supports Bitcoin only.'
    });
  }

  if (!isLikelyBitcoinAddress(address)) {
    return res.status(400).json({
      error: 'Enter a full valid-looking Bitcoin address, not a ticker or abbreviation.'
    });
  }

  const errors = [];

  const providers = [
    async () => lookupBitcoinEsplora(
      address,
      'https://blockstream.info/api',
      'Blockstream',
      'https://blockstream.info/address/'
    ),
    async () => lookupBitcoinEsplora(
      address,
      'https://mempool.space/api',
      'mempool.space',
      'https://mempool.space/address/'
    ),
    async () => lookupBitcoinBlockCypher(address)
  ];

  for (const provider of providers) {
    try {
      const result = await provider();
      result.providerErrors = errors;
      result.partial = errors.length > 0;
      return res.json(result);
    } catch (e) {
      errors.push(e.message || String(e));
    }
  }

  return res.status(502).json({
    error: 'All Bitcoin data providers are temporarily unavailable.',
    providerErrors: errors
  });
});

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Crypto Claim Research backend listening on port ${PORT}`);
  console.log(`Model: ${OPENAI_MODEL}`);
});
