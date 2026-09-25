(function () {
  'use strict';
  if (window.__cryptoResearchV4Loaded) return;
  window.__cryptoResearchV4Loaded = true;

  const q = (id) => document.getElementById(id);
  const esc = (value) => String(value == null ? '' : value)
    .replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  const h1 = document.querySelector('header h1');
  if (h1) h1.innerHTML = 'Crypto Claim & Wallet Researcher <span class="tiny muted">v4</span>';
  const sub = document.querySelector('header .sub');
  if (sub) sub.textContent = 'Deep public-web crypto opportunity research + blockchain verification + local recovery';

  const claimNav = document.querySelector('nav button[data-screen="claimable"]');
  if (claimNav) claimNav.textContent = 'Deep Search';

  const style = document.createElement('style');
  style.textContent = `
    .v4-grid{display:grid;gap:10px}
    .v4-statusline{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .v4-dot{width:9px;height:9px;border-radius:50%;background:#94a3b8;display:inline-block}
    .v4-dot.run{background:#f59e0b;animation:v4pulse 1.1s infinite}
    .v4-dot.ok{background:#22c55e}.v4-dot.bad{background:#ef4444}
    @keyframes v4pulse{0%,100%{opacity:.35}50%{opacity:1}}
    .v4-result{white-space:pre-wrap;line-height:1.55;background:#0d1427;border:1px solid var(--line);border-radius:12px;padding:13px;font-size:12px;overflow-wrap:anywhere}
    .v4-source{display:block;width:100%;text-align:left;margin:7px 0;padding:10px;border-radius:10px;background:#0d1427;color:var(--text);border:1px solid var(--line)}
    .v4-source-title{font-weight:700;display:block}.v4-source-url{font-size:10px;color:var(--muted);overflow-wrap:anywhere}
    .v4-sectiontitle{margin:16px 0 6px;font-size:13px;color:#ffd68a;font-weight:800}
  `;
  document.head.appendChild(style);

  const claimable = q('claimable');
  if (!claimable) return;

  claimable.innerHTML = `
    <div class="card">
      <h2>Deep public-web claim research</h2>
      <div class="notice warn">
        This searches the public indexed web for explicitly legitimate crypto opportunities such as official airdrops, protocol rewards,
        public puzzles/bounties, mining/issuance and incentive programs. A dormant third-party wallet is never treated as claimable.
      </div>

      <div class="label">What should the research engine look for?</div>
      <textarea id="v4Query" placeholder="Example: Find currently active crypto airdrops and public bounties that are open globally. Verify each one against official sources."></textarea>

      <div class="row">
        <div>
          <div class="label">Category</div>
          <select id="v4Category">
            <option value="all">All legitimate claim opportunities</option>
            <option value="airdrop">Official airdrops</option>
            <option value="protocol">Protocol rewards</option>
            <option value="bounty">Public bounties / crypto puzzles</option>
            <option value="mining">Mining / new issuance</option>
            <option value="testnet">Testnet / incentive programs</option>
          </select>
        </div>
        <div>
          <div class="label">Search depth</div>
          <select id="v4Depth">
            <option value="quick">Quick</option>
            <option value="deep" selected>Deep</option>
            <option value="max">Maximum — slower / more API usage</option>
          </select>
        </div>
      </div>

      <div class="row" style="margin-top:10px">
        <button id="v4Search" class="btn">Start deep search</button>
        <button id="v4Resume" class="btn secondary">Resume last search</button>
      </div>

      <div id="v4Status" class="notice hidden" style="margin-top:10px"></div>
    </div>

    <div id="v4ResultsCard" class="card hidden">
      <h2>Research results</h2>
      <div id="v4ResultText" class="v4-result"></div>
      <div id="v4SourcesTitle" class="v4-sectiontitle hidden">Sources checked / cited</div>
      <div id="v4Sources"></div>
      <div class="row" style="margin-top:12px">
        <button id="v4Share" class="btn secondary">Share report</button>
        <button id="v4New" class="btn secondary">New search</button>
      </div>
    </div>

    <div class="card">
      <h2>Deep Search connection</h2>
      <div class="notice">
        The OpenAI API key stays on your backend server and is never stored in this APK. The app only stores your backend URL and a separate app-access token.
      </div>
      <div class="label">Backend HTTPS URL</div>
      <input id="v4Backend" class="field mono" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://your-service.onrender.com" />
      <div class="label">App access token</div>
      <input id="v4Token" class="field mono" type="password" autocomplete="off" placeholder="Your APP_ACCESS_TOKEN — not your OpenAI API key" />
      <div class="row" style="margin-top:10px">
        <button id="v4SaveTest" class="btn secondary">Save & test connection</button>
        <button id="v4Forget" class="btn danger">Forget settings</button>
      </div>
      <div id="v4Connection" class="notice hidden" style="margin-top:10px"></div>
    </div>
  `;

  function setNotice(id, text, kind) {
    const el = q(id);
    if (!el) return;
    el.className = 'notice ' + (kind || '');
    el.textContent = text;
    el.classList.remove('hidden');
  }
  function hide(id) { const el = q(id); if (el) el.classList.add('hidden'); }
  function normalizeBase(raw) { return String(raw || '').trim().replace(/\/+$/, ''); }

  window.V4Net = {
    pending: new Map(),
    request(method, url, body, token, timeoutMs) {
      return new Promise((resolve, reject) => {
        if (!window.Android || !Android.httpRequest) {
          reject(new Error('v4 network bridge unavailable. Install the v4 APK.'));
          return;
        }
        const id = 'v4_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
        const timer = setTimeout(() => {
          if (this.pending.has(id)) {
            this.pending.delete(id);
            reject(new Error('Backend request timed out.'));
          }
        }, timeoutMs || 95000);
        this.pending.set(id, { resolve, reject, timer });
        Android.httpRequest(method, url, body ? JSON.stringify(body) : '', token || '', id);
      });
    },
    _resolve(id, ok, status, body) {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      clearTimeout(p.timer);
      let data = null;
      try { data = body ? JSON.parse(body) : {}; }
      catch (e) { data = { error: body || 'Invalid server response' }; }
      if (!ok) {
        p.reject(new Error((data && (data.error || data.message)) || ('HTTP ' + status)));
        return;
      }
      p.resolve(data);
    }
  };

  const savedBackend = localStorage.getItem('v4BackendUrl') || '';
  const savedToken = localStorage.getItem('v4AppToken') || '';
  q('v4Backend').value = savedBackend;
  q('v4Token').value = savedToken;

  function settings() {
    const base = normalizeBase(q('v4Backend').value);
    const token = q('v4Token').value.trim();
    if (!base || !/^https:\/\//i.test(base)) throw new Error('Enter the HTTPS URL of the backend first.');
    if (!token) throw new Error('Enter your APP_ACCESS_TOKEN first.');
    return { base, token };
  }

  q('v4SaveTest').onclick = async () => {
    try {
      const { base, token } = settings();
      localStorage.setItem('v4BackendUrl', base);
      localStorage.setItem('v4AppToken', token);
      setNotice('v4Connection', 'Testing backend connection…');
      const data = await window.V4Net.request('GET', base + '/health', null, token, 30000);
      setNotice('v4Connection', 'Connected. Backend is ready' + (data.model ? ' · model: ' + data.model : '') + '.', 'success');
    } catch (e) {
      setNotice('v4Connection', e.message, 'error');
    }
  };

  q('v4Forget').onclick = () => {
    localStorage.removeItem('v4BackendUrl');
    localStorage.removeItem('v4AppToken');
    localStorage.removeItem('v4LastJob');
    q('v4Backend').value = '';
    q('v4Token').value = '';
    setNotice('v4Connection', 'Saved backend settings were removed from this device.');
  };

  function friendlyStatus(status, elapsedSec) {
    if (status === 'queued') return 'Queued for deep web research… ' + elapsedSec + 's';
    if (status === 'in_progress') return 'Searching and cross-checking public web sources… ' + elapsedSec + 's';
    return status || 'Working…';
  }

  let pollTimer = null;
  let currentStarted = 0;
  let latestReport = '';

  async function pollJob(id) {
    const { base, token } = settings();
    const data = await window.V4Net.request('GET', base + '/api/search/' + encodeURIComponent(id), null, token, 70000);
    const elapsed = Math.max(0, Math.floor((Date.now() - currentStarted) / 1000));
    if (data.status === 'queued' || data.status === 'in_progress') {
      setNotice('v4Status', friendlyStatus(data.status, elapsed));
      pollTimer = setTimeout(() => pollJob(id).catch(onPollError), 5000);
      return;
    }
    if (data.status !== 'completed') {
      setNotice('v4Status', 'Search ended with status: ' + (data.status || 'failed') + (data.error ? ' · ' + data.error : ''), 'error');
      return;
    }
    renderResult(data);
    setNotice('v4Status', 'Deep search completed. Sources were collected and cross-checked.', 'success');
  }

  function onPollError(e) {
    setNotice('v4Status', 'Could not check the running search: ' + e.message + '. You can tap Resume last search.', 'error');
  }

  function renderResult(data) {
    latestReport = String(data.text || 'Search completed but no text report was returned.');
    q('v4ResultText').textContent = latestReport;
    const sources = Array.isArray(data.sources) ? data.sources : [];
    q('v4Sources').innerHTML = '';
    if (sources.length) {
      q('v4SourcesTitle').classList.remove('hidden');
      sources.slice(0, 80).forEach((s, i) => {
        const button = document.createElement('button');
        button.className = 'v4-source';
        button.innerHTML = '<span class="v4-source-title">' + esc(s.title || ('Source ' + (i + 1))) + '</span>' +
          '<span class="v4-source-url">' + esc(s.url || '') + '</span>';
        button.onclick = () => {
          if (s.url && window.Android && Android.openUrl) Android.openUrl(s.url);
        };
        q('v4Sources').appendChild(button);
      });
    } else {
      q('v4SourcesTitle').classList.add('hidden');
    }
    q('v4ResultsCard').classList.remove('hidden');
  }

  async function startSearch() {
    try {
      if (pollTimer) clearTimeout(pollTimer);
      const { base, token } = settings();
      localStorage.setItem('v4BackendUrl', base);
      localStorage.setItem('v4AppToken', token);
      const query = q('v4Query').value.trim();
      if (!query) throw new Error('Tell the app what you want it to search for.');
      const category = q('v4Category').value;
      const depth = q('v4Depth').value;
      q('v4ResultsCard').classList.add('hidden');
      setNotice('v4Status', 'Starting background web research…');
      const data = await window.V4Net.request('POST', base + '/api/search', { query, category, depth }, token, 70000);
      if (!data.id) throw new Error('Backend did not return a search ID.');
      localStorage.setItem('v4LastJob', data.id);
      currentStarted = Date.now();
      setNotice('v4Status', 'Search started. You can leave the app and resume this job later.');
      await pollJob(data.id);
    } catch (e) {
      setNotice('v4Status', e.message, 'error');
    }
  }

  q('v4Search').onclick = startSearch;
  q('v4Resume').onclick = async () => {
    try {
      if (pollTimer) clearTimeout(pollTimer);
      const id = localStorage.getItem('v4LastJob');
      if (!id) throw new Error('There is no saved search job on this device yet.');
      currentStarted = Date.now();
      setNotice('v4Status', 'Checking the last background search…');
      await pollJob(id);
    } catch (e) {
      setNotice('v4Status', e.message, 'error');
    }
  };

  q('v4Share').onclick = () => {
    if (!latestReport) return;
    if (window.Android && Android.shareText) Android.shareText(latestReport);
  };
  q('v4New').onclick = () => {
    q('v4Query').value = '';
    q('v4ResultsCard').classList.add('hidden');
    hide('v4Status');
  };

  if (!q('v4Query').value) {
    q('v4Query').value = 'Find currently active, explicitly legitimate crypto opportunities that a member of the public can claim, earn, mine, solve or become eligible for. Prioritize official sources and verify that each opportunity is still active.';
  }
})();
