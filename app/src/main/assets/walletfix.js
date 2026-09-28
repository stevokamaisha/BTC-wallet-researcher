(function () {
  'use strict';
  if (window.__stableV8Loaded) return;
  window.__stableV8Loaded = true;

  const q = (id) => document.getElementById(id);

  const h1 = document.querySelector('header h1');
  if (h1) h1.innerHTML = 'Crypto Claim & Wallet Researcher <span class="tiny muted">v8</span>';

  const sub = document.querySelector('header .sub');
  if (sub) sub.textContent = 'Public wallet lookup + verified claim-opportunity research + local recovery';

  const research = q('research');
  if (research) {
    const firstCard = research.querySelector('.card');
    if (firstCard) {
      const notice = firstCard.querySelector('.notice');
      if (notice) {
        notice.innerHTML =
          '<strong>Wallet Lookup</strong> researches a public address you already know. ' +
          'For crypto that may legitimately be available to earn or claim, use <strong>Deep Search</strong>. ' +
          'Dormant third-party wallets are not treated as abandoned or claimable.';
      }
    }
  }

  const discoverModeBtn = q('discoverModeBtn');
  const lookupModeBtn = q('lookupModeBtn');
  const discoverPanel = q('discoverPanel');
  const lookupPanel = q('lookupPanel');

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
      '<h2>Wallet discovery changed in v8</h2>' +
      '<div class="notice warn">' +
        'Bulk dormant-wallet discovery has been retired. Public index sites were blocking automated access, ' +
        'and inactivity alone does not establish ownership or permission to access funds.' +
      '</div>' +
      '<div class="notice" style="margin-top:10px">' +
        'Use <strong>Lookup wallet</strong> for a specific public address. ' +
        'Use <strong>Deep Search</strong> for official airdrops, protocol rewards, public bounties/puzzles, mining and incentive programs.' +
      '</div>' +
      '<div class="row" style="margin-top:10px">' +
        '<button id="v8LookupNow" class="btn">Lookup a wallet</button>' +
        '<button id="v8ClaimableNow" class="btn secondary">Find claimable crypto</button>' +
      '</div>';
  }

  if (lookupPanel) {
    lookupPanel.classList.remove('hidden');
    const existing = lookupPanel.querySelector('.notice');
    if (existing) {
      existing.textContent =
        'Enter a public wallet address you already know or are authorized to research. ' +
        'Bitcoin lookup uses live public blockchain data with fallback where available.';
    }
  }

  function showLookup() {
    if (discoverPanel) discoverPanel.classList.add('hidden');
    if (lookupPanel) lookupPanel.classList.remove('hidden');
    if (discoverModeBtn) {
      discoverModeBtn.classList.add('btn');
      discoverModeBtn.classList.remove('secondary');
    }
    if (lookupModeBtn) {
      lookupModeBtn.classList.add('secondary');
    }
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

  const v8LookupNow = q('v8LookupNow');
  const v8ClaimableNow = q('v8ClaimableNow');
  if (v8LookupNow) v8LookupNow.onclick = showLookup;
  if (v8ClaimableNow) v8ClaimableNow.onclick = openClaimable;

  showLookup();
})();