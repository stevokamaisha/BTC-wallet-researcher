(function () {
  'use strict';
  if (window.__walletDiscoveryV5Loaded) return;
  window.__walletDiscoveryV5Loaded = true;

  const $v5 = (id) => document.getElementById(id);
  const PROVIDERS = [
    { name: 'Blockstream', base: 'https://blockstream.info/api' },
    { name: 'mempool.space', base: 'https://mempool.space/api' }
  ];

  const title = document.querySelector('header h1');
  if (title) title.innerHTML = 'Crypto Claim & Wallet Researcher <span class="tiny muted">v5</span>';

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
      const id = 'v5_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        const p = window.NativeNet.pending.get(id);
        if (p) {
          window.NativeNet.pending.delete(id);
          reject(new Error('Timed out'));
        }
      }, timeoutMs || 12000);

      window.NativeNet.pending.set(id, { resolve, reject, timer });
      Android.getJson(url, id);
    });
  }

  function firstSuccess(requests) {
    return new Promise((resolve, reject) => {
      let remaining = requests.length;
      const errors = [];
      let settled = false;

      requests.forEach((fn, i) => {
        Promise.resolve()
          .then(fn)
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

  function providerGet(path, timeoutMs) {
    return firstSuccess(PROVIDERS.map((p) => async () => {
      const data = await nativeGet(p.base + path, timeoutMs || 12000);
      return { data, provider: p };
    }));
  }

  function providerGetPreferred(provider, path, timeoutMs) {
    const order = [provider].concat(PROVIDERS.filter((p) => p.base !== provider.base));
    return firstSuccess(order.map((p) => async () => {
      const data = await nativeGet(p.base + path, timeoutMs || 12000);
      return { data, provider: p };
    }));
  }

  function v5Notice(text, kind) {
    if (typeof setMsg === 'function') {
      setMsg('discoverMsg', text, kind || '');
      return;
    }
    const el = $v5('discoverMsg');
    if (!el) return;
    el.className = 'notice ' + (kind || '');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  function updateProviderLine(text, kind) {
    const el = $v5('v5ProviderStatus');
    if (!el) return;
    el.className = 'notice ' + (kind || '');
    el.textContent = text;
    el.classList.remove('hidden');
  }

  const discoverPanel = $v5('discoverPanel');
  if (discoverPanel && !$v5('v5NetworkTest')) {
    const controls = document.createElement('div');
    controls.className = 'row';
    controls.style.marginTop = '8px';
    controls.innerHTML =
      '<button id="v5NetworkTest" class="btn secondary">Test data providers</button>' +
      '<button id="v5ResetNetwork" class="btn secondary">Reset scan</button>';
    discoverPanel.appendChild(controls);

    const status = document.createElement('div');
    status.id = 'v5ProviderStatus';
    status.className = 'notice hidden';
    status.style.marginTop = '8px';
    discoverPanel.appendChild(status);
  }

  async function testOneProvider(p) {
    const started = Date.now();
    try {
      const value = await nativeGet(p.base + '/blocks/tip/height', 9000);
      const height = Number(value);
      if (!Number.isFinite(height) || height < 1) throw new Error('Invalid block height');
      return { ok: true, name: p.name, ms: Date.now() - started, height };
    } catch (e) {
      return { ok: false, name: p.name, ms: Date.now() - started, error: e.message || String(e) };
    }
  }

  async function networkTest() {
    updateProviderLine('Testing Blockstream and mempool.space…');
    const results = await Promise.all(PROVIDERS.map(testOneProvider));
    const text = results.map((r) =>
      r.ok
        ? r.name + ': OK (' + r.ms + ' ms, height ' + r.height + ')'
        : r.name + ': FAILED (' + r.error + ')'
    ).join(' · ');
    const good = results.filter((r) => r.ok).length;
    updateProviderLine(text, good ? 'success' : 'error');
    return results;
  }

  async function getTipHeight() {
    const r = await providerGet('/blocks/tip/height', 10000);
    const height = Number(r.data);
    if (!Number.isFinite(height) || height < 1) throw new Error(r.provider.name + ' returned an invalid tip height.');
    return { height: Math.floor(height), provider: r.provider };
  }

  async function getHistoricalBlock(years, sampleOffset) {
    const tip = await getTipHeight();
    const blocksPerYear = 365.2425 * 144;
    const weeksBack = Math.max(0, Number(sampleOffset) || 0);
    const targetHeight = Math.max(1, Math.floor(tip.height - years * blocksPerYear - weeksBack * 7 * 144));

    const hashResult = await providerGetPreferred(
      tip.provider,
      '/block-height/' + targetHeight,
      10000
    );
    const hash = String(hashResult.data || '').trim();
    if (!/^[0-9a-f]{64}$/i.test(hash)) {
      throw new Error(hashResult.provider.name + ' returned an invalid block hash.');
    }

    const blockResult = await providerGetPreferred(
      hashResult.provider,
      '/block/' + encodeURIComponent(hash),
      10000
    );
    const block = blockResult.data;
    if (!block || typeof block !== 'object') {
      throw new Error(blockResult.provider.name + ' returned invalid block details.');
    }

    return {
      hash,
      height: Number(block.height || targetHeight),
      timestamp: Number(block.timestamp || 0),
      provider: blockResult.provider
    };
  }

  async function getBlockTransactions(block) {
    const result = await providerGetPreferred(
      block.provider,
      '/block/' + encodeURIComponent(block.hash) + '/txs/0',
      12000
    );
    const txs = Array.isArray(result.data) ? result.data : [];
    if (!txs.length) throw new Error(result.provider.name + ' returned no transactions for the sampled block.');
    return txs;
  }

  function collectCandidates(txs, wanted) {
    const seen = new Set();
    const out = [];

    for (const tx of txs) {
      const outputs = tx && Array.isArray(tx.vout) ? tx.vout : [];
      for (const v of outputs) {
        const a = v && v.scriptpubkey_address;
        if (!a || seen.has(a)) continue;
        if (!/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{20,}$/i.test(a)) continue;
        seen.add(a);
        out.push(a);
        if (out.length >= wanted) return out;
      }
    }
    return out;
  }

  async function currentAddressStats(address) {
    const result = await providerGet(
      '/address/' + encodeURIComponent(address),
      10000
    );
    const d = result.data || {};
    const c = d.chain_stats || {};
    const m = d.mempool_stats || {};
    const funded = Number(c.funded_txo_sum || 0);
    const spent = Number(c.spent_txo_sum || 0);
    const memFunded = Number(m.funded_txo_sum || 0);
    const memSpent = Number(m.spent_txo_sum || 0);

    return {
      address,
      balance: (funded - spent + memFunded - memSpent) / 1e8,
      confirmedBalance: (funded - spent) / 1e8,
      received: funded / 1e8,
      spent: spent / 1e8,
      unconfirmed: (memFunded - memSpent) / 1e8,
      txCount: Number(c.tx_count || 0) + Number(m.tx_count || 0),
      provider: result.provider
    };
  }

  async function addLatestActivity(summary) {
    const result = await providerGetPreferred(
      summary.provider,
      '/address/' + encodeURIComponent(summary.address) + '/txs',
      10000
    );
    const txs = Array.isArray(result.data) ? result.data : [];
    let last = null;
    for (const tx of txs) {
      if (tx && tx.status && tx.status.confirmed && tx.status.block_time) {
        last = Number(tx.status.block_time);
        break;
      }
    }

    const dormantYears = last
      ? (Date.now() / 1000 - last) / (365.2425 * 86400)
      : null;

    return {
      address: summary.address,
      chain: 'bitcoin',
      chainName: 'Bitcoin',
      symbol: 'BTC',
      balance: summary.balance,
      received: summary.received,
      spent: summary.spent,
      unconfirmed: summary.unconfirmed,
      txCount: summary.txCount,
      lastActivity: last ? new Date(last * 1000) : null,
      dormantYears,
      providers: [result.provider.name],
      explorerUrl: result.provider.base.indexOf('mempool') >= 0
        ? 'https://mempool.space/address/' + encodeURIComponent(summary.address)
        : 'https://blockstream.info/address/' + encodeURIComponent(summary.address)
    };
  }

  async function mapLimit(items, limit, worker, progress) {
    const results = new Array(items.length);
    let next = 0;

    async function run() {
      while (true) {
        const i = next++;
        if (i >= items.length) return;
        try {
          results[i] = await worker(items[i], i);
        } catch (e) {
          results[i] = { __error: e };
        }
        if (progress) progress(i + 1, items.length);
      }
    }

    const workers = [];
    const count = Math.min(limit, items.length);
    for (let i = 0; i < count; i++) workers.push(run());
    await Promise.all(workers);
    return results;
  }

  let v5SampleOffset = 0;

  async function discoverWalletsV5(reset) {
    if (reset) v5SampleOffset = 0;

    const years = Math.max(1, Number($v5('discoverYears').value || 10));
    const min = Math.max(0, Number($v5('discoverMin').value || 0));
    const maxResults = Math.max(1, Number($v5('discoverLimit').value || 5));
    const sampleSize = Math.max(6, Number($v5('discoverSample').value || 18));

    const resultsBox = $v5('discoverResults');
    if (resultsBox) resultsBox.innerHTML = '';

    try {
      v5Notice('Connecting to multiple Bitcoin data providers…');

      const block = await getHistoricalBlock(years, v5SampleOffset);
      v5Notice(
        'Historical block ' + block.height + ' found via ' + block.provider.name +
        '. Sampling public outputs…'
      );

      const txs = await getBlockTransactions(block);
      const candidates = collectCandidates(txs, sampleSize);
      if (!candidates.length) {
        throw new Error('No standard Bitcoin addresses were found in this block sample.');
      }

      v5Notice('Checking current balances for ' + candidates.length + ' public addresses…');
      const summaries = await mapLimit(candidates, 4, currentAddressStats, (done, total) => {
        v5Notice('Checking balances: ' + done + '/' + total + '…');
      });

      const funded = summaries
        .filter((x) => x && !x.__error && Number.isFinite(x.balance) && x.balance >= min);

      if (!funded.length) {
        if (typeof renderDiscoveredWallets === 'function') {
          renderDiscoveredWallets([], {
            date: block.timestamp ? new Date(block.timestamp * 1000).toLocaleDateString() : 'Approx. ' + years + ' years ago',
            height: block.height
          });
        }
        v5Notice('Finished. No addresses in this sample currently meet the ' + min + ' BTC minimum.');
        return;
      }

      v5Notice('Checking latest activity for ' + funded.length + ' funded address(es)…');
      const detailed = await mapLimit(funded, 3, addLatestActivity, (done, total) => {
        v5Notice('Checking last activity: ' + done + '/' + total + '…');
      });

      const matches = detailed
        .filter((x) => x && !x.__error && x.dormantYears != null && x.dormantYears >= years)
        .slice(0, maxResults);

      const meta = {
        date: block.timestamp
          ? new Date(block.timestamp * 1000).toLocaleDateString()
          : 'Approx. ' + years + ' years ago',
        height: block.height
      };

      if (typeof renderDiscoveredWallets === 'function') {
        renderDiscoveredWallets(matches, meta);
      }

      v5Notice(
        matches.length
          ? 'Finished. Found ' + matches.length + ' matching public wallet(s).'
          : 'Finished. No matching dormant funded wallets in this sample. Try Scan another sample.',
        matches.length ? 'success' : ''
      );
    } catch (e) {
      v5Notice(
        'Discovery failed: ' + (e && e.message ? e.message : String(e)) +
        '. Tap Test data providers to see which service your phone can reach.',
        'error'
      );
    }
  }

  const discoverBtn = $v5('discoverBtn');
  if (discoverBtn) discoverBtn.onclick = () => discoverWalletsV5(true);

  const anotherBtn = $v5('discoverAnotherBtn');
  if (anotherBtn) {
    anotherBtn.onclick = () => {
      v5SampleOffset += 1;
      discoverWalletsV5(false);
    };
  }

  const testBtn = $v5('v5NetworkTest');
  if (testBtn) testBtn.onclick = networkTest;

  const resetBtn = $v5('v5ResetNetwork');
  if (resetBtn) {
    resetBtn.onclick = () => {
      v5SampleOffset = 0;
      const box = $v5('discoverResults');
      if (box) box.innerHTML = '';
      updateProviderLine('Scan offset reset. The next discovery starts from the selected dormancy period.');
    };
  }
})();