# Crypto Claim & Wallet Researcher v2

HarmonyOS 3 / Android-compatible research application.

## Public research features

- Multi-source Bitcoin wallet lookup with automatic fallback between mempool.space and Blockstream Esplora.
- Public address lookup for Ethereum, Litecoin, Dogecoin, Bitcoin Cash, Dash and Zcash through Blockchair.
- Full addresses are displayed without shortening.
- Saved public-wallet research and dormancy filters.
- Mineable / unissued crypto scanner using CoinPaprika market and supply data.
- Research prompts for official airdrops, protocol rewards, public bounties/puzzles, mining and incentive programs.
- AI handoff via Android's share sheet. Only public research text is shared.

## Recovery features

- BIP39 seed phrase derivation (standard BIP44/BIP49/BIP84 receive paths).
- WIF private-key verification.
- Exact target-address verification in Claim mode.
- Recovery and Claim require an authorization acknowledgement.

## Security model

Seed phrases, WIF private keys and recovery passphrases are processed locally in the WebView and are not sent through the research network bridge. The Android native network bridge only permits HTTPS GET requests to an allow-list of public research providers.

The app does **not** treat dormant third-party wallets as abandoned or claimable and does not brute-force arbitrary private keys.

## Important supply note

"Potential remaining issuance" is calculated from a market-data provider's reported maximum and circulating supply. It is a research indicator, not a promise that the difference is immediately mineable or free to claim. Some networks have no fixed maximum supply.

## Build

GitHub Actions builds the debug APK on every push to `main` or when manually triggered.
