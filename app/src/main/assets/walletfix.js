(function () {
  'use strict';
  if (window.__walletDiscoveryV7Loaded) return;
  window.__walletDiscoveryV7Loaded = true;

  const $v7 = (id) => document.getElementById(id);
  const BACKEND = 'https://crypto-claim-research-backend.onrender.com';

  const title = document.querySelector('header h1');
  if (title) title.innerHTML = 'Crypto Claim & Wallet Researcher <span class="tiny muted">v7</span>';

  function setNotice(text, kind) {
    if (typeof setMsg === 'function') {
      setMsg('discoverMsg', text, kind || '');
      return;
    }
    const el = $v7('discoverMsg');
    if (!el) return;
    el.className = 'notice ' + (kind || '');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function setProviderStatus(text, kind) {
    const el = $v7('v7ProviderStatus');
    if (!el) return;
    el.className = 'notice ' + (kind || '');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/[&<>"']/g, (m) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
  }

  function fmtBalance(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'Unknown';
    return n.toLocaleString(undefined, { maximumFractionDigits: 8 }) + ' BTC';
  }

  function fmtDate(value) {
    if (!value) return 'Unknown';
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? 'Unknown' : d.toLocaleString();
  }

  function backendGet(path, timeoutMs) {
    if (!window.V4Net || !window.V4Net.request) {
      return Promise.reject(new Error('Backend network bridge unavailable. Install the newest APK.'));
    }
    return window.V4Net.request('GET', BACKEND + path, null, '', timeoutMs || 125000);
  }

  const panel = $v7('discoverPanel');
  if (panel) {
    const warning = panel.querySelector('.notice.warn');
    if (warning) {
      warning.innerHTML =
        'Discovery is now performed on the server with cached public-data sources and automatic fallbacks. ' +
        'The phone no longer calls Blockchair or mempool.space directly. Dormant wallets are research results only and are not automatically claimable.';
    }

    const sample = $v7('discoverSample');
    if (sample) {
      const label = sample.parentElement && sample.parentElement.querySelector('.label');
      if (label) label.textContent = 'Search depth';
      sample.innerHTML =
        '<option value="200" selected>Standard · up to 200 ranked addresses</option>' +
        '<option value="300">Deep · up to 300 ranked addresses</option>' +
        '<option value="500">Maximum · up to 500 ranked addresses</option>';
    }

    const another = $v7('discoverAnotherBtn');
    if (another) another.textContent = 'Next ranked pages';

    const controls = document.createElement('div');
    controls.className = 'row';
    controls.style.marginTop = '10px';
    controls.innerHTML =
      '<button id="v7NetworkTest" class="btn secondary">Test research server</button>' +
      '<button id="v7Reset" class="btn secondary">Reset search</button>';
    panel.appendChild(controls);

    const status = document.createElement('div');
    status.id = 'v7ProviderStatus';
    status.className = 'notice hidden';
    status.style.marginTop = '8px';
    panel.appendChild(status);
  }

  let cursor = 0;

  function renderResults(data) {
    const box = $v7('discoverResults');
    if (!box) return;

    const rows = Array.isArray(data.results) ? data.results : [];
    if (!rows.length) {
      box.innerHTML =
        '<div class="notice">' +
        'No addresses in this ranked slice matched the filters. This is a completed search, not a network failure. ' +
        'Tap <strong>Next ranked pages</strong> to continue through a different part of the public address ranking.' +
        '</div>';
      return;
    }

    box.innerHTML =
      '<div class="tiny muted" style="margin-bottom:8px">' +
      'Candidate source: ' + esc(data.source || 'public index') +
      ' · candidates checked: ' + esc(data.checked == null ? 'unknown' : data.checked) +
      '</div>' +
      rows.map((row, i) => {
        const verified = row.verified
          ? '<span class="pill">Verified · ' + esc(row.verificationSource || 'independent source') + '</span>'
          : '<span class="pill">Indexed source only</span>';

        const rank = row.rank ? '<span class="pill">Rank #' + esc(row.rank) + '</span>' : '';
        const txCount = row.txCount == null ? 'Unknown' : esc(row.txCount);
        const dormant = row.dormantYears == null ? 'Unknown' : Number(row.dormantYears).toFixed(1) + ' years';
        const url = row.explorerUrl || ('https://blockstream.info/address/' + encodeURIComponent(row.address));

        return '<div class="wallet">' +
          '<div class="coinHead"><strong>#' + (i + 1) + ' Bitcoin public address</strong><span class="pill">' + esc(fmtBalance(row.balance)) + '</span></div>' +
          '<div style="margin-top:6px">' + verified + ' ' + rank + '</div>' +
          '<div class="addrline" style="margin-top:8px"><div class="mono tiny">' + esc(row.address) + '</div><button class="copy" data-v7-copy="' + esc(row.address) + '">Copy</button></div>' +
          '<div class="kv"><span>Last activity</span><strong>' + esc(fmtDate(row.lastActivity)) + '</strong></div>' +
          '<div class="kv"><span>Dormant</span><strong>' + esc(dormant) + '</strong></div>' +
          '<div class="kv"><span>Transactions</span><strong>' + txCount + '</strong></div>' +
          '<div class="notice warn" style="margin-top:8px">Inactivity does not make a third-party wallet abandoned or available to claim.</div>' +
          '<div class="row" style="margin-top:8px">' +
            '<button class="btn secondary smallbtn" data-v7-open="' + esc(url) + '">Explorer</button>' +
            '<button class="btn secondary smallbtn" data-v7-save="' + esc(row.address) + '">Save</button>' +
            '<button class="btn secondary smallbtn" data-v7-ai="' + esc(row.address) + '">AI research</button>' +
          '</div>' +
        '</div>';
      }).join('');

    box.querySelectorAll('[data-v7-copy]').forEach((b) => {
      b.onclick = () => {
        if (typeof copyText === 'function') copyText(b.dataset.v7Copy);
      };
    });

    box.querySelectorAll('[data-v7-open]').forEach((b) => {
      b.onclick = () => {
        if (typeof openExternal === 'function') openExternal(b.dataset.v7Open);
      };
    });

    box.querySelectorAll('[data-v7-save]').forEach((b) => {
      b.onclick = () => {
        const row = rows.find((x) => x.address === b.dataset.v7Save);
        if (!row || typeof getSaved !== 'function' || typeof putSaved !== 'function') return;
        const saved = getSaved();
        const item = {
          address: row.address,
          chain: 'bitcoin',
          chainName: 'Bitcoin',
          symbol: 'BTC',
          balance: row.balance,
          txCount: row.txCount,
          lastActivity: row.lastActivity,
          dormantYears: row.dormantYears,
          providers: [row.source || data.source || 'server-side public index'],
          checkedAt: Date.now()
        };
        const idx = saved.findIndex((x) => x.address === item.address && (x.chain || 'bitcoin') === 'bitcoin');
        if (idx >= 0) saved[idx] = item;
        else saved.unshift(item);
        putSaved(saved);
        if (typeof renderSaved === 'function') renderSaved();
        setProviderStatus('Saved public address locally on this device.', 'success');
      };
    });

    box.querySelectorAll('[data-v7-ai]').forEach((b) => {
      b.onclick = () => {
        if (typeof buildAiFromText === 'function') {
          buildAiFromText(
            'Research this public Bitcoin address: ' + b.dataset.v7Ai +
            '. Explain its documented transaction history, public labels and current activity. ' +
            'Do not assume dormancy means abandonment or permission to access funds.'
          );
        }
        if (typeof showScreen === 'function') showScreen('ai');
      };
    });
  }

  async function discover(reset) {
    if (reset) cursor = 0;

    const years = Math.max(1, Number($v7('discoverYears').value || 10));
    const min = Math.max(0, Number($v7('discoverMin').value || 0.01));
    const limit = Math.max(1, Number($v7('discoverLimit').value || 5));
    const depth = Math.max(200, Number($v7('discoverSample').value || 200));

    const box = $v7('discoverResults');
    if (box) box.innerHTML = '';

    setNotice('Sending one resilient search request to the research server…');

    try {
      const path =
        '/api/wallets/discover?years=' + encodeURIComponent(years) +
        '&min=' + encodeURIComponent(min) +
        '&limit=' + encodeURIComponent(limit) +
        '&depth=' + encodeURIComponent(depth) +
        '&cursor=' + encodeURIComponent(cursor);

      const data = await backendGet(path, 125000);
      cursor = Number.isFinite(Number(data.nextCursor)) ? Number(data.nextCursor) : cursor;

      renderResults(data);

      const count = Array.isArray(data.results) ? data.results.length : 0;
      if (count) {
        setNotice(
          'Search completed. Found ' + count + ' matching public address' + (count === 1 ? '' : 'es') +
          ' from ' + (data.source || 'the server-side public index') + '.',
          'success'
        );
      } else {
        setNotice(
          data.message || 'Search completed successfully, but this slice had no addresses matching the selected filters.'
        );
      }

      if (Array.isArray(data.sourceErrors) && data.sourceErrors.length) {
        setProviderStatus(
          'Fallback mode was used. One upstream source had a problem, but the search service stayed online: ' +
          data.sourceErrors.join(' | '),
          data.results && data.results.length ? 'success' : ''
        );
      } else {
        setProviderStatus('Server-side source chain completed without an upstream error.', 'success');
      }
    } catch (e) {
      setNotice(
        'The research server itself could not be reached: ' + (e.message || String(e)) +
        '. This is now the only network dependency on the phone.',
        'error'
      );
    }
  }

  async function testServer() {
    setProviderStatus('Waking and testing the research server…');
    try {
      const data = await backendGet('/api/wallets/health', 125000);
      const c = data.checks || {};
      const parts = [];
      if (c.backend) parts.push('Backend: ' + (c.backend.ok ? 'OK' : 'FAILED') + ' (' + (c.backend.detail || '') + ')');
      if (c.bitinfocharts) parts.push('Candidate index: ' + (c.bitinfocharts.ok ? 'OK' : 'fallback ready') + ' (' + (c.bitinfocharts.detail || '') + ')');
      if (c.blockstream) parts.push('Blockchain verification: ' + (c.blockstream.ok ? 'OK' : 'fallback mode') + ' (' + (c.blockstream.detail || '') + ')');
      setProviderStatus(parts.join(' · '), data.usable ? 'success' : '');
    } catch (e) {
      setProviderStatus('Research backend unavailable: ' + (e.message || String(e)), 'error');
    }
  }

  const discoverBtn = $v7('discoverBtn');
  if (discoverBtn) discoverBtn.onclick = () => discover(true);

  const anotherBtn = $v7('discoverAnotherBtn');
  if (anotherBtn) anotherBtn.onclick = () => discover(false);

  const testBtn = $v7('v7NetworkTest');
  if (testBtn) testBtn.onclick = testServer;

  const resetBtn = $v7('v7Reset');
  if (resetBtn) {
    resetBtn.onclick = () => {
      cursor = 0;
      const box = $v7('discoverResults');
      if (box) box.innerHTML = '';
      setProviderStatus('Search position reset. The next search starts from the first ranked pages.');
    };
  }
})();