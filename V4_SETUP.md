# Crypto Claim & Wallet Researcher v4 — setup

This update keeps the existing v3 wallet/recovery code and replaces the Claimable screen at runtime with a Deep Search screen.

## What v4 adds

- Background public-web research using the OpenAI Responses API + web_search.
- Quick, Deep and Maximum search depth.
- Search jobs keep running on the backend even if the APK is closed; the app can resume the last job.
- Source collection and clickable source links.
- Explicit classification of active, expired, unverified and suspicious opportunities.
- Safety rules that never treat a dormant third-party wallet as claimable and never send seed phrases/private keys to the research backend.
- The OpenAI API key stays only on the backend.

## Deploy the backend on Render

1. Create an OpenAI API key from your OpenAI API account. Never put it in the APK or GitHub.
2. Deploy this repository on Render using render.yaml.
3. Add the secret environment variables OPENAI_API_KEY and APP_ACCESS_TOKEN in Render.
4. Copy the Render HTTPS service URL.
5. In the APK, open Deep Search, enter the backend URL and the same APP_ACCESS_TOKEN, then tap Save & test connection.

The default model is gpt-5.6-luna. OPENAI_MODEL can be changed on the backend without rebuilding the APK.

## Build/install APK

The existing GitHub Actions Android workflow can remain unchanged. After the v4 files are committed, wait for the green build, download the debug APK artifact, uninstall the previous debug build if Android reports a signature mismatch, then install the new APK.

## Security

- Never paste an OpenAI API key into the APK.
- Never commit .env files or secrets to GitHub.
- Recovery seed phrases, WIF keys and recovery passwords remain local and are not included in Deep Search requests.
- The Deep Search backend is intended for public research only.
