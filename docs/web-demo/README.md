# MTQC — Medical Textbook Translation & Quality Control (judge demo)

An English-first medical-document review demo: inspect recorded, rights-cleared diagram translations side by side, or extract a short passage from a PDF/image in the browser and request an **AI draft** in one of 18 target languages through NVIDIA Nemotron on Nebius Token Factory. The app is not a clinical translation service. A model response, OCR output, or automated QC warning never substitutes for clinician and native-speaker review.

- [Live judge demo](https://mtqc-nebius-2026-hyunstudio.azurewebsites.net/) (public Azure for Students Free F1 host; live calls have a durable 100-attempt ceiling)
- [Narrated 18-second live video](https://youtu.be/RN-KqyxnPPg) (local OCR and one real Arabic model call)
- [Public source](https://github.com/HyunStudio/MTQC-Medical-Translation-QC) (this scoped web demo only)

## Quick start

Requires the .NET 10 SDK. From the exported web-demo repository root:

```powershell
dotnet run --project "src/web_demo/MedicalQcWebDemo.csproj"
```

Open the local address printed by ASP.NET Core. The recorded cases require no account, model key, or provider charge. The Servier Medical Art visual-system specimen has an English source and 18 saved, editable draft slides (19 displayed languages). The Müller et al. comparison covers only the Figure 1 title, caption, and four labels in Korean, Spanish, and Arabic; it is **not** a complete translation of the two-column article.

The Document workbench can accept a user-selected PDF (up to two pages) or image (up to 10 MiB), extract selectable text or perform English OCR in the **browser**, and show an editable excerpt beside the draft. The file is not uploaded. Only the excerpt that the user submits for live translation is sent to the server and onward to Nebius. Do not enter patient-identifiable or other restricted data without appropriate authorization and privacy review. The local PDF.js/Tesseract assets are built from pinned npm packages; there is no runtime CDN dependency.

## Enable live inference deliberately

Live requests are disabled by default. A server operator may set `NEBIUS_API_KEY` and `DEMO_LIVE_ENABLED=true` in the **server process environment**, then restart. Never place the key in a browser bundle, source file, published ZIP, or screenshot. The default model is `nvidia/Nemotron-3_5-Lightning`; `DEMO_NEBIUS_MODEL` can override its ID. An enabled status means only that a key is configured; it does not prove provider credit, entitlement, quality, or uptime.

The Document workbench supports an English source excerpt to each of these 18 targets: Korean, Spanish, Arabic, Simplified Chinese, Traditional Chinese, Japanese, French, German, Italian, Portuguese, Russian, Hindi, Indonesian, Dutch, Polish, Thai, Turkish, and Vietnamese. It sends at most 3,000 Unicode code points, with a 64 KiB request-body cap. A separate recorded-case button translates only the fixed Müller caption to Korean, Spanish, or Arabic. Requests time out after 20 seconds, are not automatically retried, and share a default three-attempt/client/hour and 20-attempt/global/hour in-process budget with single upstream concurrency. `DEMO_LIVE_PER_CLIENT_LIMIT` can be explicitly set from 1 to 20 for a controlled local 18-language smoke run; invalid values fall back to three. For a public host, set both `DEMO_LIVE_TOTAL_ATTEMPTS` (1–1,000) and an absolute `DEMO_LIVE_LEDGER_PATH` on persistent storage; the server reserves an attempt before calling Nebius, survives app restarts, and fails closed if the ledger is unreadable. Missing or invalid paired settings disable live mode. The hourly counters still reset on process restart; neither mechanism is a **monetary hard cap**. Apply a provider-side budget and deployment monitoring before enabling a public instance.

The progress bar is a time-derived **estimate**, not model telemetry or a promised ETA. It remains below 100% while waiting and reaches 100% only on a successful response. Errors/cancellation do not claim completion. Draft outputs display returned model/token metadata and scoped QC flags. The numeric, directional, and narrow Korean `femoral vein` checks catch some discrepancies but cannot establish medical correctness. The last check was added after a real hosted model call substituted `대정맥` for `femoral vein`; it is only a review prompt, not a general terminology validator. Arabic uses right-to-left presentation. No content is silently marked medically approved.

## Build, verify, release

```powershell
cd "src/web_demo_client"
npm ci
npm run build
cd ../..
dotnet run --project "src/web_demo_tests/MedicalQcWebDemoTests.csproj"
cd "src/web_demo_browser_tests"
npm ci
npm test
cd ../..
& "scripts/web_demo_release.ps1" -SelfCheck
& "scripts/web_demo_release.ps1"
```

Browser tests require Chrome; set `CHROME_PATH` if it is not installed at a usual Windows location. They test actual local PDF extraction/OCR and intercepted model responses; they make **no billable provider call**. The release script validates the specimen hash manifest, publishes a fresh app, checks local workers over HTTP, scans a source-only export for obvious secrets and private-machine paths, then creates separate judge-build and source archives with SHA-256 hashes. Run it after any source or dependency change.

The optional `scripts/smoke_18_languages.ps1` launches only a loopback server, makes one short real request per target with no automatic retry, and records per-call token usage and an estimated cost under a configurable script limit. This spends provider credit and requires a User-scope key. The estimate uses public model rates, not an account billing ledger. A successful API response is only runtime evidence; it is **not** a multilingual medical-quality benchmark.

## Rights and scope

[RIGHTS.md](RIGHTS.md) inventories the recorded Servier and Müller source permissions, modifications, and unreviewed status. [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) lists local PDF/OCR dependencies. Users retain responsibility for the rights and privacy of anything they select in the Document workbench. The browser demo is not the older Windows Word/PDF processing engine; the two should not be represented as the same runtime capability. No Harrison textbook page, patient record, private manuscript, or secret belongs in the public release.
