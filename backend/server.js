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
    version: '4.0',
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

app.use((req, res) => res.status(404).json({ error: 'Not found.' }));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Crypto Claim Research backend listening on port ${PORT}`);
  console.log(`Model: ${OPENAI_MODEL}`);
});
