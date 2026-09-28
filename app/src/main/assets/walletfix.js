(function () {
  'use strict';
  if (window.__stableV9Loaded) return;
  window.__stableV9Loaded = true;

  const q = (id) => document.getElementById(id);
  const BACKEND = 'https://crypto-claim-research-backend.onrender.com';

  const h1 = document.querySelector('header h1');
  if (h1) h1.innerHTML = 'Crypto Claim & Wallet Researcher <span class="tiny muted">v9</span>';

  const sub = document.querySelector('header .sub');
  if (sub) sub.textContent = 'Reliable public Bitcoin lookup + verified claim-opportunity research + local recovery';

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
        '<strong>Wallet Lookup</strong> checks a public Bitcoin address through our research server. ' +
        'The server tries independent blockchain providers in order; Blockchair is not used. ' +
        'For crypto that may legitimately be earned or claimed, use <strong>Deep Search</strong>.';
    }
  }

  if (discoverModeBtn) {
    discoverModeBtn.textContent = 'Lookup wallet';
    discoverModeBtn.className = 'btn';
  }

  if (lookupModeBtn) {
    lookupModeBtn.textContent = 'Open Deep Search';
    lookupModeBtn.className = 'btn secondary';
  }

  if (discoverPanel) {
    discoverPanel.innerHTML =
      '<h2>Wallet research</h2>' +
      '<div class="notice">' +
        '<strong>Lookup wallet</strong> researches a public Bitcoin address you already know. ' +
        'For legitimate airdrops, protocol rewards, public bounties/puzzles, mining and incentive programs, use <strong>Deep Search</strong>.' +
      '</div>';
  }

  if (lookupPanel) {
    lookupPanel.classList.remove('hidden');
    const existing = lookupPanel.querySelector('.notice');
    if (existing) {
      existing.textContent =
        'Enter a full public Bitcoin address. Invalid text such as BTC is rejected before any network request. ' +
        'Lookup goes through the research server with Blockstream, mempool.space and BlockCypher fallback.';
    }
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

  function showLookup() {
    if (discoverPanel) discoverPanel.classList.add('hidden');
    if (lookupPanel) lookupPanel.classList.remove('hidden');
  }

  function openClaimable() {
    if (typeof showScreen === 'function') {
      showScreen('claimable');
      return;
    }
    const nav = document.querySelector('nav button[data-screen="claimable"]');
    if (nav) nav.click();
  }

  if (discoverModeBtn) discoverModeBtn.onclick = showLookup;
  if (lookupModeBtn) lookupModeBtn.onclick = openClaimable;

  function isBitcoinAddress(value) {
    const a = String(value || '').trim();
    return /^(bc1)[0-9a-z]{20,90}$/i.test(a) ||
           /^[13][a-km-zA-HJ-NP-Z1-9]{25,62}$/.test(a);
  }

  function msg(text, kind) {
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

  function hideResult() {
    const el = q('researchResult');
    if (el) el.classList.add('hidden');
  }

  async function backendLookup(address) {
    if (!window.V4Net || !window.V4Net.request) {
      throw new Error('Research-server bridge is unavailable. Install the v9 APK.');
    }
    return window.V4Net.request(
      'GET',
      BACKEND + '/api/wallets/address/' + encodeURIComponent(address) + '?chain=bitcoin',
      null,
      '',
      45000
    );
  }

  async function analyzeV9() {
    const address = String(addressInput ? addressInput.value : '').trim();
    hideResult();

    if (!address) {
      msg('Enter a full Bitcoin wallet address.', 'error');
      return;
    }

    if (!isBitcoinAddress(address)) {
      msg('That is not a full Bitcoin address. Paste an address beginning with bc1, 1, or 3.', 'error');
      return;
    }

    if (analyzeBtn) analyzeBtn.disabled = true;
    msg('Checking the Bitcoin blockchain through the research server…');

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
        explorerUrl: data.explorerUrl || ('https://blockstream.info/address/' + encodeURIComponent(address))
      };

      if (typeof renderResearch === 'function') {
        renderResearch(result);
      }

      const fallbacks = Array.isArray(data.providerErrors) ? data.providerErrors.length : 0;
      msg(
        fallbacks
          ? 'Lookup completed. A primary provider failed, but fallback succeeded.'
          : 'Lookup completed successfully.',
        'success'
      );
    } catch (e) {
      msg(
        'Wallet lookup failed: ' + (e && e.message ? e.message : String(e)) +
        '. The app did not fall back to Blockchair.',
        'error'
      );
    } finally {
      if (analyzeBtn) analyzeBtn.disabled = false;
    }
  }

  if (analyzeBtn) analyzeBtn.onclick = analyzeV9;

  if (clearBtn) {
    clearBtn.onclick = () => {
      if (addressInput) addressInput.value = '';
      hideResult();
      const m = q('researchMsg');
      if (m) m.classList.add('hidden');
    };
  }

  showLookup();
})();