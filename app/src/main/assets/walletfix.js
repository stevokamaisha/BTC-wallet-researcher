(function () {
  'use strict';
  if (window.__stableV12Loaded) return;
  window.__stableV12Loaded = true;

  const q = (id) => document.getElementById(id);
  const BACKEND = 'https://crypto-claim-research-backend.onrender.com';
  const PUZZLE101_ADDRESS = '1QKBaU6WAeycb3DbKbLBkX7vJiaS8r42Xo';
  const PUZZLE101_RANGE_SIZE = Math.pow(2, 139);
  const esc = (value) => String(value == null ? '' : value)
    .replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));

  const h1 = document.querySelector('header h1');
  if (h1) h1.innerHTML = 'Crypto Claim & Wallet Researcher <span class="tiny muted">v12.0</span>';

  const sub = document.querySelector('header .sub');
  if (sub) sub.textContent = 'Bitcoin research + on-device Bitcoin Puzzle #140 Pollard Kangaroo engine';

  const research = q('research');
  const discoverModeBtn = q('discoverModeBtn');
  const lookupModeBtn = q('lookupModeBtn');
  const discoverPanel = q('discoverPanel');
  const lookupPanel = q('lookupPanel');
  const chainSelect = q('researchChain');
  const addressInput = q('researchAddress');
  const analyzeBtn = q('analyzeBtn');
  const clearBtn = q('clearResearch');

  if (research) {
    const firstCard = research.querySelector('.card');
    const notice = firstCard && firstCard.querySelector('.notice');
    if (notice) {
      notice.innerHTML =
        '<strong>Discover</strong> scans historical Bitcoin blocks directly through public blockchain APIs, then verifies which sampled addresses are still funded and how long they have been inactive. ' +
        '<strong>Lookup</strong> researches a public address you already know. Dormant third-party wallets are research only, never automatically claimable.';
    }

    const row = firstCard && firstCard.querySelector('.row');
    if (row && !q('v10DeepSearchBtn')) {
      const deep = document.createElement('button');
      deep.id = 'v10DeepSearchBtn';
      deep.className = 'btn secondary';
      deep.textContent = 'Claim opportunities';
      row.appendChild(deep);
      deep.onclick = () => {
        if (typeof showScreen === 'function') showScreen('claimable');
      };
    }
  }

  if (discoverModeBtn) discoverModeBtn.textContent = 'Discover wallets';
  if (lookupModeBtn) lookupModeBtn.textContent = 'Lookup known wallet';

  if (discoverPanel) {
    discoverPanel.innerHTML = `
      <h2>Direct Bitcoin discovery</h2>
      <div class="notice warn">
        This scans public historical Bitcoin blocks directly through Blockstream/mempool Esplora, then checks current balances and last activity.
        It does not use Blockchair or BitInfoCharts. Results are blockchain research only; inactivity does not transfer ownership.
      </div>

      <div class="label">Blockchain</div>
      <select id="v10DiscoverChain">
        <option value="bitcoin">Bitcoin — direct chain scan</option>
      </select>

      <div class="row">
        <div>
          <div class="label">Dormant for at least</div>
          <select id="v10Years">
            <option value="5">5+ years</option>
            <option value="10" selected>10+ years</option>
            <option value="15">15+ years</option>
          </select>
        </div>
        <div>
          <div class="label">Minimum current balance</div>
          <input id="v10Min" class="field" type="number" min="0" step="0.00000001" value="0.01" />
        </div>
      </div>

      <div class="row">
        <div>
          <div class="label">Maximum results</div>
          <select id="v10Limit">
            <option value="3">3</option>
            <option value="5" selected>5</option>
            <option value="8">8</option>
          </select>
        </div>
        <div>
          <div class="label">Search depth</div>
          <select id="v10Depth">
            <option value="200" selected>Standard</option>
            <option value="300">Deep</option>
            <option value="500">Maximum</option>
          </select>
        </div>
      </div>

      <div class="row" style="margin-top:10px">
        <button id="v10Discover" class="btn">Scan Bitcoin chain</button>
        <button id="v10Next" class="btn secondary">Scan next period</button>
      </div>

      <div class="row" style="margin-top:8px">
        <button id="v10Health" class="btn secondary">Test blockchain sources</button>
        <button id="v10Reset" class="btn secondary">Reset scan</button>
      </div>

      <div id="v10Msg" class="notice hidden" style="margin-top:10px"></div>
      <div id="v10Stats" class="notice hidden" style="margin-top:10px"></div>
      <div id="v10Results" style="margin-top:10px"></div>
    `;
  }

  if (lookupPanel) {
    const existing = lookupPanel.querySelector('.notice');
    if (existing) {
      existing.textContent =
        'Enter a full public Bitcoin address. Lookup uses the research server with Blockstream first, then independent fallbacks. Blockchair is not used.';
    }
    lookupPanel.classList.add('hidden');
  }

  if (chainSelect) {
    chainSelect.innerHTML =
      '<option value="auto">Auto detect Bitcoin</option>' +
      '<option value="bitcoin">Bitcoin</option>';
    chainSelect.value = 'bitcoin';
  }

  if (addressInput) {
    addressInput.placeholder = 'Full Bitcoin address: bc1…, 1…, or 3…';
  }

  function showDiscover() {
    if (discoverPanel) discoverPanel.classList.remove('hidden');
    if (lookupPanel) lookupPanel.classList.add('hidden');
    if (discoverModeBtn) discoverModeBtn.className = 'btn';
    if (lookupModeBtn) lookupModeBtn.className = 'btn secondary';
    const result = q('researchResult');
    if (result) result.classList.add('hidden');
  }

  function showLookup() {
    if (discoverPanel) discoverPanel.classList.add('hidden');
    if (lookupPanel) lookupPanel.classList.remove('hidden');
    if (discoverModeBtn) discoverModeBtn.className = 'btn secondary';
    if (lookupModeBtn) lookupModeBtn.className = 'btn';
  }

  if (discoverModeBtn) discoverModeBtn.onclick = showDiscover;
  if (lookupModeBtn) lookupModeBtn.onclick = showLookup;

  function setNotice(id, text, kind) {
    const el = q(id);
    if (!el) return;
    el.className = 'notice ' + (kind || '');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function hide(id) {
    const el = q(id);
    if (el) el.classList.add('hidden');
  }

  function isBitcoinAddress(value) {
    const a = String(value || '').trim();
    return /^(bc1)[0-9a-z]{20,90}$/i.test(a) ||
           /^[13][a-km-zA-HJ-NP-Z1-9]{25,62}$/.test(a);
  }

  async function backendGet(path, timeoutMs) {
    if (!window.V4Net || !window.V4Net.request) {
      throw new Error('Research-server bridge is unavailable. Install the v10 APK.');
    }
    return window.V4Net.request(
      'GET',
      BACKEND + path,
      null,
      '',
      timeoutMs || 125000
    );
  }

  function formatBtc(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Unknown';
    return n.toLocaleString(undefined, { maximumFractionDigits: 8 }) + ' BTC';
  }

  function formatDate(value) {
    if (!value) return 'Unknown';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString();
  }

  function savePublicRow(row) {
    if (typeof getSaved !== 'function' || typeof putSaved !== 'function') return;
    const saved = getSaved();
    const item = {
      address: row.address,
      chain: 'bitcoin',
      chainName: 'Bitcoin',
      symbol: 'BTC',
      balance: Number(row.balance || 0),
      received: row.received == null ? null : Number(row.received),
      spent: row.spent == null ? null : Number(row.spent),
      unconfirmed: row.unconfirmed == null ? null : Number(row.unconfirmed),
      txCount: Number(row.txCount || 0),
      lastActivity: row.lastActivity || null,
      dormantYears: row.dormantYears == null ? null : Number(row.dormantYears),
      providers: [row.verificationProvider || row.provider || 'Direct Bitcoin discovery'],
      checkedAt: Date.now()
    };

    const index = saved.findIndex((x) =>
      (x.chain || 'bitcoin') === 'bitcoin' && x.address === item.address
    );

    if (index >= 0) saved[index] = item;
    else saved.unshift(item);

    putSaved(saved);
    if (typeof renderSaved === 'function') renderSaved();
    setNotice('v10Stats', 'Saved public address locally.', 'success');
  }

  function resultCard(row, label) {
    const dormant = row.dormantYears == null
      ? 'Unknown'
      : Number(row.dormantYears).toFixed(1) + ' years';
    const explorer = row.explorerUrl ||
      ('https://blockstream.info/address/' + encodeURIComponent(row.address));

    return `
      <div class="wallet">
        <div class="coinHead">
          <strong>${esc(label)}</strong>
          <span class="pill">${esc(formatBtc(row.balance))}</span>
        </div>
        <div class="addrline" style="margin-top:8px">
          <div class="mono tiny">${esc(row.address)}</div>
          <button class="copy" data-v10-copy="${esc(row.address)}">Copy</button>
        </div>
        <div class="kv"><span>Last activity</span><strong>${esc(formatDate(row.lastActivity))}</strong></div>
        <div class="kv"><span>Dormant</span><strong>${esc(dormant)}</strong></div>
        <div class="kv"><span>Transactions</span><strong>${esc(row.txCount == null ? 'Unknown' : row.txCount)}</strong></div>
        <div class="kv"><span>Verification</span><strong>${esc(row.verificationProvider || row.provider || 'Esplora')}</strong></div>
        <div class="notice warn" style="margin-top:8px">
          Public blockchain research only. A dormant address remains controlled by whoever holds its valid keys.
        </div>
        <div class="row" style="margin-top:8px">
          <button class="btn secondary smallbtn" data-v10-open="${esc(explorer)}">Explorer</button>
          <button class="btn secondary smallbtn" data-v10-save="${esc(row.address)}">Save</button>
          <button class="btn secondary smallbtn" data-v10-ai="${esc(row.address)}">AI research</button>
        </div>
      </div>
    `;
  }

  function bindResultButtons(allRows) {
    const box = q('v10Results');
    if (!box) return;

    box.querySelectorAll('[data-v10-copy]').forEach((button) => {
      button.onclick = () => {
        if (typeof copyText === 'function') copyText(button.dataset.v10Copy);
      };
    });

    box.querySelectorAll('[data-v10-open]').forEach((button) => {
      button.onclick = () => {
        if (typeof openExternal === 'function') openExternal(button.dataset.v10Open);
      };
    });

    box.querySelectorAll('[data-v10-save]').forEach((button) => {
      button.onclick = () => {
        const row = allRows.find((x) => x.address === button.dataset.v10Save);
        if (row) savePublicRow(row);
      };
    });

    box.querySelectorAll('[data-v10-ai]').forEach((button) => {
      button.onclick = () => {
        if (typeof buildAiFromText === 'function') {
          buildAiFromText(
            'Research this public Bitcoin address: ' + button.dataset.v10Ai +
            '. Explain only publicly documented transaction history, labels and current activity. ' +
            'Do not infer that dormancy means abandonment or permission to access funds.'
          );
        }
        if (typeof showScreen === 'function') showScreen('ai');
      };
    });
  }

  function renderDiscovery(data) {
    const exact = Array.isArray(data.results) ? data.results : [];
    const near = Array.isArray(data.nearMatches) ? data.nearMatches : [];
    const box = q('v10Results');
    if (!box) return;

    let html = '';

    if (exact.length) {
      html += '<h2>Matching funded public addresses</h2>';
      html += exact.map((row, i) =>
        resultCard(row, 'Match #' + (i + 1))
      ).join('');
    } else {
      html += '<div class="notice">No exact address matched the selected balance + dormancy filters in this blockchain slice.</div>';
    }

    if (near.length) {
      html += '<h2 style="margin-top:14px">Closest funded results</h2>';
      html += '<div class="notice">These are funded addresses found during the scan that did not meet the full dormancy threshold. They are shown so you can see the scan is returning real blockchain data.</div>';
      html += near.map((row, i) =>
        resultCard(row, 'Near match #' + (i + 1))
      ).join('');
    }

    if (!exact.length && !near.length) {
      html += '<div class="notice">This slice contained no currently funded candidates above your minimum. Use <strong>Scan next period</strong> to inspect a different historical slice.</div>';
    }

    box.innerHTML = html;
    bindResultButtons([...exact, ...near]);
  }

  let cursor = 0;
  let activeTimer = null;

  async function discover(reset) {
    if (reset) cursor = 0;

    const years = Math.max(1, Number(q('v10Years').value || 10));
    const min = Math.max(0, Number(q('v10Min').value || 0.01));
    const limit = Math.max(1, Number(q('v10Limit').value || 5));
    const depth = Number(q('v10Depth').value || 200);

    q('v10Discover').disabled = true;
    q('v10Next').disabled = true;
    q('v10Results').innerHTML = '';
    hide('v10Stats');

    const started = Date.now();
    setNotice('v10Msg', 'Scanning historical Bitcoin blocks directly… 0s');

    if (activeTimer) clearInterval(activeTimer);
    activeTimer = setInterval(() => {
      const seconds = Math.floor((Date.now() - started) / 1000);
      setNotice(
        'v10Msg',
        'Scanning historical blocks, checking current balances and verifying activity… ' + seconds + 's'
      );
    }, 1000);

    try {
      const path =
        '/api/wallets/discover?years=' + encodeURIComponent(years) +
        '&min=' + encodeURIComponent(min) +
        '&limit=' + encodeURIComponent(limit) +
        '&depth=' + encodeURIComponent(depth) +
        '&cursor=' + encodeURIComponent(cursor);

      const data = await backendGet(path, 125000);
      cursor = Number.isFinite(Number(data.nextCursor)) ? Number(data.nextCursor) : cursor + 1;

      renderDiscovery(data);

      const exact = Array.isArray(data.results) ? data.results.length : 0;
      setNotice(
        'v10Msg',
        exact
          ? 'Direct blockchain scan completed. Found ' + exact + ' exact match' + (exact === 1 ? '' : 'es') + '.'
          : 'Direct blockchain scan completed successfully. No exact match in this slice.',
        exact ? 'success' : ''
      );

      const statText =
        'Blocks read: ' + Number(data.blocksRead || 0) + '/' + Number(data.blocksRequested || 0) +
        ' · public addresses checked: ' + Number(data.checked || 0) +
        ' · funded above minimum: ' + Number(data.fundedChecked || 0) +
        ' · activity histories checked: ' + Number(data.activityChecked || 0) +
        (data.targetHeight ? ' · starting block height: ' + data.targetHeight : '');

      setNotice('v10Stats', statText, 'success');

      if (Array.isArray(data.providerErrors) && data.providerErrors.length) {
        const brief = data.providerErrors.slice(0, 3).join(' | ');
        setNotice('v10Stats', statText + ' · fallback notes: ' + brief, 'success');
      }
    } catch (e) {
      setNotice(
        'v10Msg',
        'Direct blockchain discovery failed: ' + (e && e.message ? e.message : String(e)),
        'error'
      );
    } finally {
      if (activeTimer) {
        clearInterval(activeTimer);
        activeTimer = null;
      }
      q('v10Discover').disabled = false;
      q('v10Next').disabled = false;
    }
  }

  async function testSources() {
    setNotice('v10Stats', 'Testing the research backend and both Esplora sources…');
    try {
      const data = await backendGet('/api/wallets/health', 45000);
      const checks = data.checks || {};
      const parts = Object.keys(checks).map((key) => {
        const item = checks[key] || {};
        return key + ': ' + (item.ok ? 'OK' : 'FAILED') + (item.detail ? ' (' + item.detail + ')' : '');
      });
      setNotice('v10Stats', parts.join(' · '), data.usable ? 'success' : 'error');
    } catch (e) {
      setNotice('v10Stats', 'Research server test failed: ' + (e.message || String(e)), 'error');
    }
  }

  async function backendLookup(address) {
    return backendGet(
      '/api/wallets/address/' + encodeURIComponent(address) + '?chain=bitcoin',
      45000
    );
  }

  function lookupMsg(text, kind) {
    if (typeof setMsg === 'function') {
      setMsg('researchMsg', text, kind || '');
      return;
    }
    const el = q('researchMsg');
    if (!el) return;
    el.className = 'notice ' + (kind || '');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  async function analyzeV10() {
    const address = String(addressInput ? addressInput.value : '').trim();
    const resultEl = q('researchResult');
    if (resultEl) resultEl.classList.add('hidden');

    if (!address) {
      lookupMsg('Enter a full Bitcoin wallet address.', 'error');
      return;
    }

    if (!isBitcoinAddress(address)) {
      lookupMsg('That is not a full Bitcoin address. Paste an address beginning with bc1, 1, or 3.', 'error');
      return;
    }

    if (analyzeBtn) analyzeBtn.disabled = true;
    lookupMsg('Checking the Bitcoin blockchain through the research server…');

    try {
      const data = await backendLookup(address);
      const result = {
        address: data.address,
        chain: 'bitcoin',
        chainName: 'Bitcoin',
        symbol: 'BTC',
        balance: Number(data.balance || 0),
        received: data.received == null ? null : Number(data.received),
        spent: data.spent == null ? null : Number(data.spent),
        unconfirmed: data.unconfirmed == null ? null : Number(data.unconfirmed),
        txCount: Number(data.txCount || 0),
        lastActivity: data.lastActivity ? new Date(data.lastActivity) : null,
        dormantYears: data.dormantYears == null ? null : Number(data.dormantYears),
        providers: Array.isArray(data.providers) ? data.providers : ['Research server'],
        tokenCount: null,
        explorerUrl: data.explorerUrl ||
          ('https://blockstream.info/address/' + encodeURIComponent(address))
      };

      if (typeof renderResearch === 'function') renderResearch(result);

      if (address === PUZZLE101_ADDRESS && resultEl) {
        resultEl.insertAdjacentHTML('beforeend', `
          <div class="notice success" style="margin-top:12px">
            <strong>Recognized: Bitcoin Puzzle #140.</strong><br>
            This address is the dedicated target of the local Puzzle #140 solver in this app.
            <button id="p101LookupOpen" class="btn" style="width:100%;margin-top:10px">Open Puzzle #140 solver</button>
          </div>
        `);
        const puzzleButton = q('p101LookupOpen');
        if (puzzleButton) puzzleButton.onclick = () => {
          if (typeof showScreen === 'function') showScreen('puzzle101');
          refreshPuzzle101State();
        };
      }

      const fallbacks = Array.isArray(data.providerErrors) ? data.providerErrors.length : 0;
      lookupMsg(
        fallbacks
          ? 'Lookup completed. A primary source failed, but fallback succeeded.'
          : 'Lookup completed successfully.',
        'success'
      );
    } catch (e) {
      lookupMsg('Wallet lookup failed: ' + (e && e.message ? e.message : String(e)), 'error');
    } finally {
      if (analyzeBtn) analyzeBtn.disabled = false;
    }
  }

  if (q('v10Discover')) q('v10Discover').onclick = () => discover(true);
  if (q('v10Next')) q('v10Next').onclick = () => discover(false);
  if (q('v10Health')) q('v10Health').onclick = testSources;
  if (q('v10Reset')) {
    q('v10Reset').onclick = () => {
      cursor = 0;
      q('v10Results').innerHTML = '';
      hide('v10Msg');
      setNotice('v10Stats', 'Scan position reset. The next scan starts around the selected dormancy age.');
    };
  }

  if (analyzeBtn) analyzeBtn.onclick = analyzeV10;

  if (clearBtn) {
    clearBtn.onclick = () => {
      if (addressInput) addressInput.value = '';
      const result = q('researchResult');
      if (result) result.classList.add('hidden');
      const message = q('researchMsg');
      if (message) message.classList.add('hidden');
    };
  }


  // Dedicated Bitcoin Puzzle #140 interface. The target and published range are fixed.
  let puzzle101LastFound = '';

  function formatPuzzleCount(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return String(value || 0);
    return Math.round(n).toLocaleString();
  }

  function formatPuzzleSpeed(value) {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 keys/s';
    if (n >= 1000000) return (n / 1000000).toFixed(2) + ' M keys/s';
    if (n >= 1000) return (n / 1000).toFixed(2) + ' K keys/s';
    return n.toFixed(0) + ' keys/s';
  }

  function formatPuzzleCoverage(fraction) {
    const pct = Number(fraction || 0) * 100;
    if (!Number.isFinite(pct) || pct <= 0) return '0%';
    if (pct < 0.000001) return pct.toExponential(3) + '%';
    return pct.toFixed(8) + '%';
  }

  function formatPuzzleEta(speed) {
    const n = Number(speed || 0);
    if (!Number.isFinite(n) || n <= 0) return 'Start the solver to measure';
    const years = PUZZLE101_RANGE_SIZE / n / (365.2425 * 86400);
    if (!Number.isFinite(years)) return 'Unknown';
    if (years >= 1000000) {
      const exponent = Math.floor(Math.log10(years));
      const mantissa = years / Math.pow(10, exponent);
      return mantissa.toFixed(2) + ' × 10^' + exponent +
        ' years for the full range at current phone speed';
    }
    return years.toLocaleString(undefined, {maximumFractionDigits: 1}) +
      ' years for the full range at current phone speed';
  }

  function renderPuzzle101State(state) {
    state = state || {};
    if (state.privateKeyHex) puzzle101LastFound = state.privateKeyHex;

    const status = q('p101Status');
    const current = q('p101Current');
    const speed = q('p101Speed');
    const session = q('p101Session');
    const total = q('p101Total');
    const workers = q('p101Workers');
    const coverage = q('p101Coverage');
    const eta = q('p101Eta');
    const found = q('p101Found');

    if (status) {
      status.className = 'notice ' + (state.error ? 'error' : state.running ? 'success' : '');
      const neverStarted = !state.running &&
        Number(state.totalChecked || 0) === 0 &&
        Number(state.sessionChecked || 0) === 0 &&
        (!state.currentHex || state.currentHex.endsWith('80000000000000000000000000000000000'));
      status.textContent = state.error
        ? 'Solver error: ' + state.error
        : state.running
          ? 'Puzzle #140 solver is running on this phone.'
          : neverStarted
            ? 'Solver ready. Tap Start / resume to begin.'
            : 'Solver stopped. Your checkpoint is kept on this device.';
    }

    if (current) current.textContent = state.currentHex || '80000000000000000000000000000000000';
    if (speed) speed.textContent = formatPuzzleSpeed(state.keysPerSecond);
    if (session) session.textContent = formatPuzzleCount(state.sessionChecked);
    if (total) total.textContent = formatPuzzleCount(state.totalChecked);
    if (workers) workers.textContent = String(state.workerCount || 0);
    if (coverage) coverage.textContent = formatPuzzleCoverage(state.fractionChecked);
    if (eta) eta.textContent = formatPuzzleEta(state.keysPerSecond);

    if (q('p101Start')) q('p101Start').disabled = !!state.running;
    if (q('p101Stop')) q('p101Stop').disabled = !state.running;
    if (q('p101Random')) q('p101Random').disabled = !!state.running;
    if (q('p101Reset')) q('p101Reset').disabled = !!state.running;

    if (found) {
      if (puzzle101LastFound) {
        found.classList.remove('hidden');
        found.innerHTML =
          '<strong>MATCH FOUND.</strong>' +
          '<div class="tiny" style="margin-top:6px">The missing multiplier is:</div>' +
          '<div class="mono" style="margin-top:6px"><strong>x = 0x' + esc(puzzle101LastFound) + '</strong></div>' +
          '<div class="tiny muted" style="margin-top:6px">This is the Puzzle #140 private key, kept locally on this device.</div>' +
          '<button id="p101CopyFound" class="btn" style="width:100%;margin-top:10px">Copy x</button>';
        const copyFound = q('p101CopyFound');
        if (copyFound) copyFound.onclick = () => {
          if (typeof copyText === 'function') copyText(puzzle101LastFound);
        };
      } else {
        found.classList.add('hidden');
      }
    }
  }

  function refreshPuzzle101State() {
    try {
      if (!window.Android || !Android.puzzle101State) {
        renderPuzzle101State({error:'Native Puzzle #140 engine is unavailable. Install the v12 APK.'});
        return;
      }
      const raw = Android.puzzle101State();
      renderPuzzle101State(JSON.parse(raw || '{}'));
    } catch (e) {
      renderPuzzle101State({error:e && e.message ? e.message : String(e)});
    }
  }

  const nav = document.querySelector('header nav');
  if (nav && !q('puzzle101Nav')) {
    const button = document.createElement('button');
    button.id = 'puzzle101Nav';
    button.dataset.screen = 'puzzle101';
    button.textContent = 'Puzzle #140';
    const second = nav.children.length > 1 ? nav.children[1] : null;
    if (second) nav.insertBefore(button, second);
    else nav.appendChild(button);
    button.onclick = () => {
      if (typeof showScreen === 'function') showScreen('puzzle101');
      refreshPuzzle101State();
    };
  }

  const main = document.querySelector('main');
  if (main && !q('puzzle101')) {
    const section = document.createElement('section');
    section.id = 'puzzle101';
    section.className = 'screen';
    section.innerHTML = `
      <div class="card">
        <h2>Bitcoin Puzzle #140 — local solver</h2>
        <div class="notice success">
          This engine is fixed to the publicly published Bitcoin Puzzle #140 only. It cannot be pointed at another wallet.
        </div>

        <div class="label">Target address</div>
        <div class="wallet">
          <div class="mono">1QKBaU6WAeycb3DbKbLBkX7vJiaS8r42Xo</div>
          <div class="label">Published public key</div>
          <div class="mono tiny">031f6a332d3c5c4f2de2378c012f429cd109ba07d69690c6c701b6bb87860d6640</div>
          <div class="kv"><span>Published reward address balance</span><strong>≈14 BTC</strong></div>
          <div class="kv"><span>Private-key interval</span><strong>140-bit puzzle</strong></div>
        </div>

        <div class="label">Mathematical target</div>
        <div class="notice">
          <div><strong>Find x</strong> such that:</div>
          <div class="mono tiny" style="margin-top:6px">2^100 ≤ x &lt; 2^101</div>
          <div class="mono tiny" style="margin-top:6px">x × G = Q, where Q is the published Puzzle #140 public key</div>
          <div class="tiny muted" style="margin-top:6px">G is the fixed secp256k1 generator. The public key Q is known; the unknown is x.</div>
        </div>

        <div class="label">Published range</div>
        <div class="notice">
          <div class="tiny muted">Start</div>
          <div class="mono">80000000000000000000000000000000000</div>
          <div class="tiny muted" style="margin-top:8px">End</div>
          <div class="mono">fffffffffffffffffffffffffffffffffff</div>
        </div>

        <div id="p101Status" class="notice" style="margin-top:10px">Loading local solver…</div>

        <div class="wallet">
          <div class="kv"><span>Speed</span><strong id="p101Speed">0 keys/s</strong></div>
          <div class="kv"><span>Checked this run</span><strong id="p101Session">0</strong></div>
          <div class="kv"><span>Total checked on this device</span><strong id="p101Total">0</strong></div>
          <div class="kv"><span>Parallel CPU workers</span><strong id="p101Workers">0</strong></div>
          <div class="kv"><span>Range covered</span><strong id="p101Coverage">0%</strong></div>
          <div class="label">Safe resume x</div>
          <div id="p101Current" class="mono tiny">80000000000000000000000000000000000</div>
          <div class="label">Full-range estimate</div>
          <div id="p101Eta" class="tiny muted">Start the solver to measure</div>
        </div>

        <div class="row">
          <button id="p101Start" class="btn">Start / resume</button>
          <button id="p101Stop" class="btn secondary">Stop</button>
        </div>
        <div class="row" style="margin-top:8px">
          <button id="p101Random" class="btn secondary">New random shard</button>
          <button id="p101Reset" class="btn secondary">Reset to range start</button>
        </div>
        <div class="row" style="margin-top:8px">
          <button id="p101Test" class="btn secondary">Self-test solver</button>
          <button id="p101Explorer" class="btn secondary">Open target explorer</button>
        </div>

        <div id="p101Found" class="notice success hidden" style="margin-top:10px"></div>

        <div class="notice warn" style="margin-top:10px">
          v12.0 uses the published Puzzle #140 public key with a Pollard Kangaroo search engine. This is mathematically different from ordinary address brute force and targets the interval discrete-log problem. It still requires enormous computation, and a phone is mainly useful for testing and benchmarking.
        </div>
      </div>
    `;
    main.appendChild(section);

    q('p101Start').onclick = () => {
      try {
        const el = q('p101Status');
        if (el) {
          el.className = 'notice';
          el.textContent = 'Starting Puzzle #140 solver…';
        }
        q('p101Start').disabled = true;
        Android.puzzle101Start();
        setTimeout(refreshPuzzle101State, 120);
      } catch (e) {
        renderPuzzle101State({error:e.message || String(e)});
      }
    };
    q('p101Stop').onclick = () => {
      try { Android.puzzle101Stop(); refreshPuzzle101State(); }
      catch (e) { renderPuzzle101State({error:e.message || String(e)}); }
    };
    q('p101Random').onclick = () => {
      try {
        Android.puzzle101NewShard();
        puzzle101LastFound = '';
        refreshPuzzle101State();
      } catch (e) { renderPuzzle101State({error:e.message || String(e)}); }
    };
    q('p101Reset').onclick = () => {
      try {
        Android.puzzle101Reset();
        puzzle101LastFound = '';
        refreshPuzzle101State();
      } catch (e) { renderPuzzle101State({error:e.message || String(e)}); }
    };
    q('p101Test').onclick = () => {
      try {
        const ok = Android.puzzle101SelfTest();
        const el = q('p101Status');
        if (el) {
          el.className = 'notice ' + (ok ? 'success' : 'error');
          el.textContent = ok
            ? 'Self-test passed: secp256k1 + compressed public key + HASH160 engine is working.'
            : 'Self-test failed. Do not run the solver on this build.';
        }
      } catch (e) {
        renderPuzzle101State({error:e.message || String(e)});
      }
    };
    q('p101Explorer').onclick = () => {
      if (typeof openExternal === 'function') {
        openExternal('https://blockstream.info/address/' + PUZZLE101_ADDRESS);
      }
    };
  }

  window.Puzzle101Native = {
    _update: function (state) {
      renderPuzzle101State(state || {});
    }
  };

  setInterval(() => {
    const section = q('puzzle101');
    if (section && section.classList.contains('active')) refreshPuzzle101State();
  }, 1500);

  refreshPuzzle101State();

  showDiscover();
})();