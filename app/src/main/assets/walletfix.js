(function () {
  'use strict';
  if (window.__walletDiscoveryV6Loaded) return;
  window.__walletDiscoveryV6Loaded = true;

  const $v6 = (id) => document.getElementById(id);
  const BLOCKCHAIR = 'https://api.blockchair.com/bitcoin';
  const BLOCKSTREAM = 'https://blockstream.info/api';
  const MEMPOOL = 'https://mempool.space/api';
  const OFFSET_LADDER = [0, 500, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000];

  const title = document.querySelector('header h1');
  if (title) title.innerHTML = 'Crypto Claim & Wallet Researcher <span class="tiny muted">v6</span>';

  if (window.NativeNet && window.NativeNet.pending) {
    window.NativeNet._resolve = function (id, ok, status, body) {
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (p.timer) clearTimeout(p.timer);

      if (!ok) {
        let msg = body || ('HTTP ' + status);
        try {
          const j = JSON.parse(body);
          msg = j.error || j.message || msg;
        } catch (_) {}
        p.reject(new Error((status ? 'HTTP ' + status + ': ' : '') + msg));
        return;
      }

      try {
        p.resolve(JSON.parse(body));
      } catch (_) {
        p.resolve(String(body || '').trim());
      }
    };
  }

  function nativeGet(url, timeoutMs) {
    return new Promise((resolve, reject) => {
      if (!window.Android || !Android.getJson || !window.NativeNet || !window.NativeNet.pending) {
        reject(new Error('Native network bridge unavailable. Install the newest APK.'));
        return;
      }

      const id = 'v6_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        if (window.NativeNet.pending.has(id)) {
          window.NativeNet.pending.delete(id);
          reject(new Error('Timed out'));
        }
      }, timeoutMs || 12000);

      window.NativeNet.pending.set(id, { resolve, reject, timer });
      Android.getJson(url, id);
    });
  }

  function firstSuccess(tasks) {
    return new Promise((resolve, reject) => {
      let remaining = tasks.length;
      let settled = false;
      const errors = [];

      tasks.forEach((task, i) => {
        Promise.resolve()
          .then(task)
          .then((value) => {
            if (settled) return;
            settled = true;
            resolve(value);
          })
          .catch((err) => {
            errors[i] = err && err.message ? err.message : String(err);
            remaining -= 1;
            if (!settled && remaining === 0) {
              reject(new Error(errors.filter(Boolean).join(' | ') || 'All providers failed'));
            }
          });
      });
    });
  }

  function notice(text, kind) {
    if (typeof setMsg === 'function') {
      setMsg('discoverMsg', text, kind || '');
      return;
    }
    const el = $v6('discoverMsg');
    if (!el) return;
    el.className = 'notice ' + (kind || '');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function statusLine(text, kind) {
    const el = $v6('v6ProviderStatus');
    if (!el) return;
    el.className = 'notice ' + (kind || '');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function parseDate(value) {
    if (!value) return null;
    const d = new Date(String(value).replace(' ', 'T') + (String(value).includes('Z') ? '' : 'Z'));
    if (!Number.isNaN(d.getTime())) return d;
    const d2 = new Date(value);
    return Number.isNaN(d2.getTime()) ? null : d2;
  }

  function maxDate(a, b) {
    if (!a) return b || null;
    if (!b) return a || null;
    return a > b ? a : b;
  }

  function btcFromSats(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n / 1e8 : null;
  }

  function indexRows(payload) {
    const data = payload && Array.isArray(payload.data) ? payload.data : [];
    const out = [];

    for (const row of data) {
      let address = null;
      let balance = null;

      if (Array.isArray(row)) {
        address = row[0];
        balance = row[1];
      } else if (row && typeof row === 'object') {
        address = row.address || row[0] || row.addr;
        balance = row.balance != null ? row.balance : row[1];
      }

      if (typeof address !== 'string' || !address) continue;
      const bal = Number(balance);
      if (!Number.isFinite(bal)) continue;
      out.push({ address, balanceSats: bal });
    }

    return out;
  }

  function parseDashboardEntry(address, entry) {
    if (!entry || typeof entry !== 'object') return null;
    const info = entry.address || entry;
    const balanceSats = Number(info.balance);
    if (!Number.isFinite(balanceSats) || balanceSats <= 0) return null;

    const lastReceive = parseDate(info.last_seen_receiving);
    const lastSpend = parseDate(info.last_seen_spending);
    const last = maxDate(lastReceive, lastSpend);

    return {
      address,
      chain: 'bitcoin',
      chainName: 'Bitcoin',
      symbol: 'BTC',
      balance: balanceSats / 1e8,
      received: btcFromSats(info.received),
      spent: btcFromSats(info.spent),
      unconfirmed: null,
      txCount: Number(info.transaction_count || 0),
      lastActivity: last,
      dormantYears: last ? (Date.now() - last.getTime()) / (365.2425 * 86400000) : null,
      providers: ['Blockchair index'],
      explorerUrl: 'https://blockchair.com/bitcoin/address/' + encodeURIComponent(address)
    };
  }

  function chunks(array, size) {
    const out = [];
    for (let i = 0; i < array.length; i += size) out.push(array.slice(i, i + size));
    return out;
  }

  async function fetchIndexedCandidates(minBtc, limit, offset) {
    const minSats = Math.max(1, Math.floor(minBtc * 1e8));
    const url = BLOCKCHAIR + '/addresses?q=balance(' + minSats + '..)&limit=' + limit + '&offset=' + offset;
    const payload = await nativeGet(url, 15000);
    const rows = indexRows(payload);
    if (!rows.length) throw new Error('Blockchair returned no funded-address rows for this page.');
    return rows;
  }

  async function fetchBulkDashboard(addresses) {
    const joined = addresses.map(encodeURIComponent).join(',');
    const url = BLOCKCHAIR + '/dashboards/addresses/' + joined + '?limit=0';
    const payload = await nativeGet(url, 18000);
    if (!payload || !payload.data || typeof payload.data !== 'object') {
      throw new Error('Blockchair returned an invalid address-dashboard response.');
    }
    return payload.data;
  }

  async function verifyLatestActivityWithEsplora(row) {
    const encoded = encodeURIComponent(row.address);
    const result = await firstSuccess([
      async () => ({ provider: 'Blockstream', data: await nativeGet(BLOCKSTREAM + '/address/' + encoded + '/txs', 10000), base: 'https://blockstream.info/address/' }),
      async () => ({ provider: 'mempool.space', data: await nativeGet(MEMPOOL + '/address/' + encoded + '/txs', 10000), base: 'https://mempool.space/address/' })
    ]);

    let latest = null;
    const txs = Array.isArray(result.data) ? result.data : [];
    for (const tx of txs) {
      const t = tx && tx.status && tx.status.confirmed ? Number(tx.status.block_time) : 0;
      if (t) {
        latest = new Date(t * 1000);
        break;
      }
    }

    return {
      ...row,
      lastActivity: latest || row.lastActivity,
      dormantYears: latest ? (Date.now() - latest.getTime()) / (365.2425 * 86400000) : row.dormantYears,
      providers: row.providers.concat(result.provider + ' verification'),
      explorerUrl: result.base + encoded
    };
  }

  async function mapLimit(items, limit, worker, onProgress) {
    const results = new Array(items.length);
    let next = 0;
    let finished = 0;

    async function run() {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        try {
          results[i] = await worker(items[i], i);
        } catch (e) {
          results[i] = { __error: e };
        }
        finished += 1;
        if (onProgress) onProgress(finished, items.length);
      }
    }

    const workers = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(run());
    await Promise.all(workers);
    return results;
  }

  let scanPage = 0;

  async function discoverIndexed(reset) {
    if (reset) scanPage = 0;

    const years = Math.max(1, Number($v6('discoverYears').value || 10));
    const minBtc = Math.max(0, Number($v6('discoverMin').value || 0));
    const maxResults = Math.max(1, Number($v6('discoverLimit').value || 5));
    const requestedSample = Math.max(6, Number($v6('discoverSample').value || 18));
    const candidateLimit = Math.min(50, Math.max(20, requestedSample * 2));

    const resultBox = $v6('discoverResults');
    if (resultBox) resultBox.innerHTML = '';

    const offsets = [
      OFFSET_LADDER[scanPage % OFFSET_LADDER.length],
      OFFSET_LADDER[(scanPage + 1) % OFFSET_LADDER.length]
    ];

    const unique = new Map();

    try {
      notice('Querying the funded-address index instead of random historical blocks…');

      for (let page = 0; page < offsets.length; page++) {
        const offset = offsets[page];
        notice('Loading funded address candidates · index offset ' + offset + '…');

        const rows = await fetchIndexedCandidates(minBtc, candidateLimit, offset);
        for (const row of rows) unique.set(row.address, row);
      }

      const candidates = Array.from(unique.values());
      if (!candidates.length) throw new Error('No funded addresses were returned by the indexed provider.');

      notice('Loaded ' + candidates.length + ' funded candidates. Checking last activity in bulk…');

      const allEntries = {};
      const batches = chunks(candidates.map((x) => x.address), 12);
      let batchesDone = 0;

      for (const batch of batches) {
        const data = await fetchBulkDashboard(batch);
        Object.assign(allEntries, data);
        batchesDone += 1;
        notice('Checking indexed activity data: batch ' + batchesDone + '/' + batches.length + '…');
      }

      const parsed = [];
      for (const c of candidates) {
        const entry = allEntries[c.address] || allEntries[c.address.toLowerCase()];
        const row = parseDashboardEntry(c.address, entry);
        if (row) parsed.push(row);
      }

      let matches = parsed
        .filter((x) => x.balance != null && x.balance >= minBtc && x.dormantYears != null && x.dormantYears >= years)
        .sort((a, b) => (b.balance || 0) - (a.balance || 0));

      const needsVerification = matches.slice(0, Math.max(maxResults * 2, 8));
      if (needsVerification.length) {
        notice('Verifying the best ' + needsVerification.length + ' candidate(s) against an independent blockchain source…');
        const verified = await mapLimit(needsVerification, 3, verifyLatestActivityWithEsplora, (done, total) => {
          notice('Independent verification: ' + done + '/' + total + '…');
        });

        matches = verified
          .filter((x) => x && !x.__error && x.balance >= minBtc && x.dormantYears != null && x.dormantYears >= years)
          .sort((a, b) => (b.balance || 0) - (a.balance || 0));
      }

      const finalRows = matches.slice(0, maxResults);
      const meta = {
        date: 'Indexed funded-address search',
        height: 'offsets ' + offsets.join(' + ')
      };

      if (typeof renderDiscoveredWallets === 'function') renderDiscoveredWallets(finalRows, meta);

      if (finalRows.length) {
        notice(
          'Finished. Checked ' + candidates.length + ' funded candidates and found ' + finalRows.length +
          ' address(es) matching the dormancy filter.',
          'success'
        );
      } else {
        notice(
          'Finished. Checked ' + candidates.length + ' funded candidates. None matched ' + years +
          '+ years of inactivity in these indexed pages. Tap Scan another sample to move deeper into the funded-address index.'
        );
      }
    } catch (e) {
      let msg = e && e.message ? e.message : String(e);
      if (/HTTP 430/.test(msg)) {
        msg = 'Blockchair temporarily rate-limited this device. Wait a little, then try again. No random-block fallback was used.';
      }
      notice('Indexed discovery failed: ' + msg, 'error');
    }
  }

  async function testProviders() {
    statusLine('Testing indexed search and blockchain verification providers…');

    const tests = await Promise.all([
      (async () => {
        const start = Date.now();
        try {
          const payload = await nativeGet(BLOCKCHAIR + '/addresses?limit=1', 12000);
          const ok = indexRows(payload).length > 0;
          if (!ok) throw new Error('No indexed row returned');
          return 'Blockchair index: OK (' + (Date.now() - start) + ' ms)';
        } catch (e) {
          return 'Blockchair index: FAILED (' + (e.message || e) + ')';
        }
      })(),
      (async () => {
        const start = Date.now();
        try {
          const height = Number(await nativeGet(BLOCKSTREAM + '/blocks/tip/height', 9000));
          if (!Number.isFinite(height)) throw new Error('Invalid height');
          return 'Blockstream: OK (' + (Date.now() - start) + ' ms, height ' + height + ')';
        } catch (e) {
          return 'Blockstream: FAILED (' + (e.message || e) + ')';
        }
      })()
    ]);

    const success = tests.some((x) => x.includes('Blockchair index: OK'));
    statusLine(tests.join(' · '), success ? 'success' : 'error');
  }

  const panel = $v6('discoverPanel');
  if (panel) {
    const oldStatus = $v6('v5ProviderStatus');
    if (oldStatus) oldStatus.remove();
    const oldTest = $v6('v5NetworkTest');
    if (oldTest) oldTest.textContent = 'Test indexed providers';

    if (!$v6('v6ProviderStatus')) {
      const status = document.createElement('div');
      status.id = 'v6ProviderStatus';
      status.className = 'notice hidden';
      status.style.marginTop = '8px';
      panel.appendChild(status);
    }

    const intro = panel.querySelector('.notice.warn');
    if (intro) {
      intro.innerHTML = 'Discovery now starts from a funded-address index, then checks actual activity history. Results are public-chain research only; dormant does not mean abandoned or claimable.';
    }
  }

  const discoverBtn = $v6('discoverBtn');
  if (discoverBtn) discoverBtn.onclick = () => discoverIndexed(true);

  const anotherBtn = $v6('discoverAnotherBtn');
  if (anotherBtn) {
    anotherBtn.onclick = () => {
      scanPage += 2;
      discoverIndexed(false);
    };
  }

  const testBtn = $v6('v5NetworkTest');
  if (testBtn) testBtn.onclick = testProviders;

  const resetBtn = $v6('v5ResetNetwork');
  if (resetBtn) {
    resetBtn.onclick = () => {
      scanPage = 0;
      const box = $v6('discoverResults');
      if (box) box.innerHTML = '';
      statusLine('Indexed scan position reset to the first funded-address pages.');
    };
  }
})();