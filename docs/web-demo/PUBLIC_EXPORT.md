# Public export boundary and operator checklist

The private monorepo is not the publication target. `scripts/web_demo_release.ps1` builds a distinct public-source ZIP containing only the web-demo app, client dependency lock/build script, app/browser tests, release script, and the judge-facing README, rights, notices, and code license. `bin/`, `obj/`, `node_modules/`, generated OCR/PDF workers, local output, user credentials, manuscripts, and unrelated Windows-engine source are excluded. The judge-build ZIP separately contains compiled app files, local workers, fixtures, and rights/third-party notices.

Before publishing:

1. Confirm ownership and the web-demo code license. Servier/Müller CC BY material and third-party PDF/OCR packages retain their own terms; the code license does not relicense them.
2. Run the release self-check and full build; inspect every exported ZIP entry and its SHA-256. Independently scan for keys, private paths, patient data, and unrelated project files. A regex scan alone cannot prove absence of secrets.
3. Extract the source ZIP into a clean location and run the documented client build and both regression suites. Extract the judge build and verify HTTP access to `/api/cases` and the local worker assets with live mode disabled.
4. Publish to the exact user-approved public repository and release/test-build destination; clone the public version anonymously and repeat the startup check. Use a server-side Nebius key only on a managed host with `DEMO_LIVE_TOTAL_ATTEMPTS` and `DEMO_LIVE_LEDGER_PATH` on persistent storage, a provider-level spending cap where available, network/uptime monitoring, and a plan for the judging period. The local lifetime attempt ledger is a fail-closed credit guard, not a provider billing cap.
5. The final brand-cleared, authentic 18-second video is public at https://youtu.be/-TZlAbJm_7E (independently identified through YouTube oEmbed). Link the public repo, demo/test build, video, and English summary in Devpost. Verify the final submitted page itself.

This document records the intended boundary only. It does **not** assert that public export, deployment, or Devpost submission has happened; only the YouTube upload is complete.
