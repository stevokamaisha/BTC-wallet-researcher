# BTC Wallet Researcher

A phone-focused Bitcoin research and ownership-verification app intended for Android-compatible HarmonyOS 3 devices such as the Huawei Mate 20 Pro.

## Included

- Research a full Bitcoin address using public mempool.space data.
- Display confirmed balance, unconfirmed change, total received/spent, transaction count, last activity, and dormancy estimate.
- Save public addresses locally and filter by dormancy / minimum BTC.
- Local WIF verification and address derivation.
- Local BIP39-style seed derivation with optional passphrase.
- Derives standard Bitcoin receiving paths for BIP44, BIP49, and BIP84.
- Claim / ownership verification by matching a supplied credential against an exact target address.
- No secret material is intentionally stored in localStorage.

## Important limitations

- This version does **not** brute-force arbitrary private keys.
- It does not crack `wallet.dat` or BIP38-encrypted keys on the phone.
- Seed word count is checked, but this dependency-free build does not include the 2048-word BIP39 checksum dictionary. Exact address matching is the stronger verification step when recovering a known wallet.
- Seed claim verification checks the first 20 receiving addresses in the standard BIP44/BIP49/BIP84 account-0 external chain.
- Blockchain research needs internet access.

## Build an APK with Android Studio

1. Install Android Studio on a computer.
2. Open the `BTCWalletResearcher` folder.
3. Allow Gradle to sync and download the Android SDK/dependencies.
4. Choose **Build > Build Bundle(s) / APK(s) > Build APK(s)**.
5. Android Studio will produce a debug APK under `app/build/outputs/apk/debug/`.

## Install on HarmonyOS 3

Copy the APK to the phone, open it from **Files / Downloads**, and approve installation from that source if HarmonyOS asks. Exact wording varies by HarmonyOS security settings.

## Security

Use recovery features only for wallets you own or where the owner has explicitly authorized recovery. Keep seed phrases and private keys offline whenever possible.
