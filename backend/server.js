import express from 'express';
import { load } from 'cheerio';

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
    version: '7.0',
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


const WALLET_PAGE_CACHE_MS = 10 * 60 * 1000;
const walletPageCache = new Map();

async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Accept': options.accept || 'text/html,application/json,text/plain,*/*',
        'User-Agent': 'CryptoClaimWalletResearcher/7.0 (+public blockchain research)',
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

function parseUtcDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const normalized = raw.replace(/\s+UTC$/i, ' UTC');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function yearsAgo(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return (Date.now() - date.getTime()) / (365.2425 * 86400000);
}

function newerDate(a, b) {
  if (!a) return b || null;
  if (!b) return a || null;
  return a > b ? a : b;
}

function bitInfoUrl(page) {
  return page <= 1
    ? 'https://bitinfocharts.com/top-100-richest-bitcoin-addresses.html'
    : 'https://bitinfocharts.com/top-100-richest-bitcoin-addresses-' + page + '.html';
}

function parseBitInfoRows(html, page) {
  const $ = load(html);
  const rows = [];

  $('tr').each((_, tr) => {
    const cells = $(tr).find('td');
    if (cells.length < 6) return;

    const rank = Number.parseInt($(cells[0]).text().trim(), 10);
    if (!Number.isFinite(rank)) return;

    const addressLink = $(cells[1]).find('a[href*="/bitcoin/address/"]').first();
    const address = addressLink.text().trim();
    if (!address || !/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,}$/i.test(address)) return;

    const balanceText = $(cells[2]).text().replace(/,/g, '');
    const balanceMatch = balanceText.match(/([0-9]+(?:\.[0-9]+)?)\s*BTC/i);
    const balance = balanceMatch ? Number(balanceMatch[1]) : NaN;
    if (!Number.isFinite(balance)) return;

    const firstIn = parseUtcDate($(cells[4]).text());
    const lastIn = parseUtcDate($(cells[5]).text());
    const firstOut = cells.length > 7 ? parseUtcDate($(cells[7]).text()) : null;
    const lastOut = cells.length > 8 ? parseUtcDate($(cells[8]).text()) : null;
    const lastActivity = newerDate(lastIn, lastOut);

    rows.push({
      address,
      balance,
      rank,
      firstIn: firstIn ? firstIn.toISOString() : null,
      firstOut: firstOut ? firstOut.toISOString() : null,
      lastActivity: lastActivity ? lastActivity.toISOString() : null,
      dormantYears: lastActivity ? yearsAgo(lastActivity) : null,
      txCount: null,
      source: 'BitInfoCharts',
      sourcePage: page,
      verified: false
    });
  });

  return rows;
}

async function getBitInfoPage(page) {
  const key = 'bitinfo:' + page;
  const cached = walletPageCache.get(key);
  if (cached && Date.now() - cached.time < WALLET_PAGE_CACHE_MS) return cached.rows;

  const { text } = await fetchWithTimeout(bitInfoUrl(page), {}, 16000);
  const rows = parseBitInfoRows(text, page);
  if (rows.length < 20) throw new Error('BitInfoCharts page ' + page + ' returned too few address rows.');

  walletPageCache.set(key, { time: Date.now(), rows });
  return rows;
}

async function verifyEsploraAddress(row) {
  const address = encodeURIComponent(row.address);
  const providers = [
    { name: 'Blockstream', base: 'https://blockstream.info/api', explorer: 'https://blockstream.info/address/' },
    { name: 'mempool.space', base: 'https://mempool.space/api', explorer: 'https://mempool.space/address/' }
  ];

  for (const provider of providers) {
    try {
      const [infoResult, txResult] = await Promise.all([
        fetchWithTimeout(provider.base + '/address/' + address, { accept: 'application/json' }, 12000),
        fetchWithTimeout(provider.base + '/address/' + address + '/txs', { accept: 'application/json' }, 12000)
      ]);

      const info = JSON.parse(infoResult.text);
      const txs = JSON.parse(txResult.text);
      const chain = info.chain_stats || {};
      const mempool = info.mempool_stats || {};
      const balance = (
        Number(chain.funded_txo_sum || 0) -
        Number(chain.spent_txo_sum || 0) +
        Number(mempool.funded_txo_sum || 0) -
        Number(mempool.spent_txo_sum || 0)
      ) / 1e8;

      let lastActivity = null;
      if (Array.isArray(txs)) {
        for (const tx of txs) {
          const timestamp = tx && tx.status && tx.status.confirmed
            ? Number(tx.status.block_time || 0)
            : 0;
          if (timestamp) {
            lastActivity = new Date(timestamp * 1000);
            break;
          }
        }
      }

      return {
        ...row,
        balance,
        txCount: Number(chain.tx_count || 0) + Number(mempool.tx_count || 0),
        lastActivity: lastActivity ? lastActivity.toISOString() : row.lastActivity,
        dormantYears: lastActivity ? yearsAgo(lastActivity) : row.dormantYears,
        verified: true,
        verificationSource: provider.name,
        explorerUrl: provider.explorer + address
      };
    } catch (e) {
      // Try the next independent provider.
    }
  }

  return {
    ...row,
    verified: false,
    verificationSource: null,
    explorerUrl: 'https://bitinfocharts.com/bitcoin/address/' + address
  };
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
        results[i] = { ...items[i], verified: false, verificationError: e.message };
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(run());
  await Promise.all(workers);
  return results;
}

async function blockchairFallback(minBalance, years, limit, offset) {
  const minSats = Math.max(1, Math.floor(minBalance * 1e8));
  const url = 'https://api.blockchair.com/bitcoin/addresses?q=balance(' + minSats + '..)&limit=100&offset=' + offset;
  const { text } = await fetchWithTimeout(url, { accept: 'application/json' }, 16000);
  const payload = JSON.parse(text);
  const raw = Array.isArray(payload.data) ? payload.data : [];
  const addresses = [];

  for (const item of raw) {
    const address = Array.isArray(item) ? item[0] : item && item.address;
    const balanceSats = Number(Array.isArray(item) ? item[1] : item && item.balance);
    if (typeof address === 'string' && Number.isFinite(balanceSats)) {
      addresses.push({ address, balance: balanceSats / 1e8 });
    }
  }

  const candidateAddresses = addresses.slice(0, 30);
  const verified = await mapLimit(candidateAddresses, 4, async (row) => {
    const out = await verifyEsploraAddress({
      ...row,
      rank: null,
      lastActivity: null,
      dormantYears: null,
      txCount: null,
      source: 'Blockchair index',
      verified: false
    });
    return out;
  });

  return verified
    .filter((x) => x.balance >= minBalance && x.dormantYears != null && x.dormantYears >= years)
    .sort((a, b) => (b.dormantYears || 0) - (a.dormantYears || 0) || b.balance - a.balance)
    .slice(0, limit);
}

async function discoverWalletsResilient({ years, minBalance, limit, depth, cursor }) {
  const pageCount = depth >= 500 ? 5 : depth >= 300 ? 3 : 2;
  const startPage = (cursor % 5) + 1;
  const pages = [];
  for (let i = 0; i < pageCount; i++) pages.push(((startPage - 1 + i) % 5) + 1);

  const pageResults = await Promise.allSettled(pages.map((page) => getBitInfoPage(page)));
  const rows = [];
  const sourceErrors = [];

  pageResults.forEach((result, i) => {
    if (result.status === 'fulfilled') rows.push(...result.value);
    else sourceErrors.push('BitInfoCharts page ' + pages[i] + ': ' + result.reason.message);
  });

  const unique = new Map();
  for (const row of rows) unique.set(row.address, row);
  const candidates = [...unique.values()];

  let matches = candidates
    .filter((x) => x.balance >= minBalance && x.dormantYears != null && x.dormantYears >= years)
    .sort((a, b) => (b.dormantYears || 0) - (a.dormantYears || 0) || b.balance - a.balance);

  const verifyPool = matches.slice(0, Math.max(limit * 3, 12));
  if (verifyPool.length) {
    const verified = await mapLimit(verifyPool, 4, verifyEsploraAddress);
    matches = verified
      .filter((x) => x.balance >= minBalance && x.dormantYears != null && x.dormantYears >= years)
      .sort((a, b) => (b.dormantYears || 0) - (a.dormantYears || 0) || b.balance - a.balance);
  }

  if (!matches.length && candidates.length === 0) {
    try {
      matches = await blockchairFallback(minBalance, years, limit, cursor * 100);
    } catch (e) {
      sourceErrors.push('Blockchair fallback: ' + e.message);
    }
  }

  return {
    ok: true,
    partial: sourceErrors.length > 0,
    source: candidates.length ? 'BitInfoCharts rich list + Esplora verification' : 'Blockchair fallback + Esplora verification',
    checked: candidates.length,
    pages,
    cursor,
    nextCursor: (cursor + pageCount) % 5,
    results: matches.slice(0, limit),
    sourceErrors
  };
}

app.get('/api/wallets/health', async (req, res) => {
  const checks = {
    backend: { ok: true, detail: 'Render backend online' },
    bitinfocharts: { ok: false, detail: '' },
    blockstream: { ok: false, detail: '' }
  };

  const [bitinfo, blockstream] = await Promise.allSettled([
    getBitInfoPage(1),
    fetchWithTimeout('https://blockstream.info/api/blocks/tip/height', { accept: 'text/plain' }, 10000)
  ]);

  if (bitinfo.status === 'fulfilled') {
    checks.bitinfocharts = { ok: true, detail: bitinfo.value.length + ' ranked addresses cached' };
  } else {
    checks.bitinfocharts = { ok: false, detail: bitinfo.reason.message };
  }

  if (blockstream.status === 'fulfilled') {
    checks.blockstream = { ok: true, detail: 'height ' + blockstream.value.text.trim() };
  } else {
    checks.blockstream = { ok: false, detail: blockstream.reason.message };
  }

  res.json({
    ok: true,
    version: '7.0',
    checks,
    usable: checks.bitinfocharts.ok || checks.blockstream.ok
  });
});

app.get('/api/wallets/discover', async (req, res) => {
  const years = Math.min(20, Math.max(1, Number(req.query.years || 10)));
  const minBalance = Math.min(1000000, Math.max(0, Number(req.query.min || 0.01)));
  const limit = Math.min(10, Math.max(1, Math.floor(Number(req.query.limit || 5))));
  const depth = [200, 300, 500].includes(Number(req.query.depth)) ? Number(req.query.depth) : 200;
  const cursor = Math.max(0, Math.floor(Number(req.query.cursor || 0)));

  try {
    const data = await discoverWalletsResilient({ years, minBalance, limit, depth, cursor });
    res.json(data);
  } catch (e) {
    console.error('wallet discovery error:', e.message);
    res.json({
      ok: true,
      partial: true,
      source: 'No candidate source completed',
      checked: 0,
      pages: [],
      cursor,
      nextCursor: cursor,
      results: [],
      sourceErrors: [e.message],
      message: 'The research service stayed online, but its upstream public data sources were temporarily unavailable.'
    });
  }
});

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Crypto Claim Research backend listening on port ${PORT}`);
  console.log(`Model: ${OPENAI_MODEL}`);
});
