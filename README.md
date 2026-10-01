# MTQC — Medical Document Translation & QC (judge demo)

An English-first medical-document **excerpt-review** demo: inspect recorded, rights-cleared diagram translations side by side, or extract a short passage from a PDF/image in the browser and request an **AI draft followed by a separate AI critique** in one of 18 target languages through NVIDIA Nemotron on Nebius Token Factory. It does not output a fully translated or structure-preserved textbook/PDF. The review UI keeps model suggestions, narrow deterministic rules, and unassessed categories distinct. The app is not a clinical translation service. A model response, OCR output, or automated QC warning never substitutes for clinician and native-speaker review.

- [Live judge demo](https://mtqc-nebius-2026-hyunstudio.azurewebsites.net/) (public Azure for Students Free F1 host; live calls have a durable 100-attempt ceiling)
- [Current professional 1080p demo](https://youtu.be/FE4t_vn89X8) (2:19; one genuine, bounded two-stage Arabic request, synthetic two-column PDF, captions, explicit limitations, and obscured third-party logos)
- [Public source](https://github.com/HyunStudio/MTQC-Medical-Translation-QC) (this scoped web demo only)
- [Submitted Devpost project](https://devpost.com/software/mtqc-medical-textbook-translation-quality-control) (Nebius × NVIDIA Global AI Hackathon)

## Quick start

Requires the .NET 10 SDK and Node.js 24 LTS (with npm). From the exported web-demo repository root, build the local PDF/OCR workers **before the first app run**:

```powershell
Push-Location "src/web_demo_client"
npm ci
npm run build
Pop-Location
dotnet run --project "src/web_demo/MedicalQcWebDemo.csproj"
```

Without the client build, recorded cases still open, but PDF/OCR worker URLs return 404. The generated workers are deliberately excluded from the source repository. Repeat the client build after changing its dependencies; do not configure an API key merely to use recorded cases or local extraction.

Open the local address printed by ASP.NET Core. The recorded cases require no account, model key, or provider charge. The Servier Medical Art visual-system specimen has an English source and 18 saved, editable draft slides (19 displayed languages). The Müller et al. comparison covers only the Figure 1 title, caption, and four labels in Korean, Spanish, and Arabic; it is **not** a complete translation of the two-column article.

The Document workbench can accept a user-selected PDF (up to two pages) or image (up to 10 MiB), extract selectable text or perform English OCR in the **browser**, and show an editable excerpt beside the draft. The file is not uploaded. Only the excerpt that the user submits for live translation is sent to the server and onward to Nebius. Do not enter patient-identifiable or other restricted data without appropriate authorization and privacy review. The local PDF.js/Tesseract assets are built from pinned npm packages; there is no runtime CDN dependency.

The public Servier slide specimens were visually refitted in native PowerPoint after a cross-language audit. The eye illustration and connector endpoints remain editable, while label clouds and title clearance changed to stop clipping and arbitrary word breaks. The published decks and previews remove original master logos and retain text attribution and the CC BY link. This visual repair does not constitute a terminology review.

## Reading-order review

PDF text layers retain fragment coordinates. The workbench proposes one- or two-column reading order and shows numbered lines over the original page. Choose across-row order for tables or left-then-right order for columns, inspect the overlay, and use **Replace excerpt with this order** to apply it. Previewing another order preserves manual edits; applying it resets source approval. Full-width text separates column bands. This is a geometric heuristic, not a learned layout model: irregular figures, rotated text, and complex tables still require correction. Every page without a text layer receives local OCR, including scanned pages inside otherwise searchable PDFs.

Numeric QC compares complete numeric tokens and occurrence counts, so `2` versus `20`, lost repeated values, added values, and lost minus signs produce findings. Arabic digits and unambiguous comma decimals are normalized for value comparison; exact-format differences remain visible for review. Numeric counts do not prove that each value remains attached to the correct structure or unit.

The [2026-09-30 corpus evaluation](docs/web-demo/CORPUS_EVALUATION_20260930.md) adds real two-column medical pages, mixed-width figures, dense/rotated tables, scans and three anatomy charts. Its [provenance and reproduction instructions](docs/web-demo/CORPUS_SOURCES.md) identify reusable sources. Narrow journal gutters and centered footers have dedicated regressions. OCR now uses automatic page segmentation rather than a single text block. Searchable PDFs with embedded images display an explicit warning that image labels are not included in the text layer; enter any required labels manually. These changes do not imply full-page transcription or table-cell reconstruction.

The [complex medical image pilot](docs/web-demo/COMPLEX_MEDICAL_IMAGE_PILOT_20260930.md) tests a separately licensed two-column neuroanatomy paper, multi-panel figures and dense anatomy labels. It records a corrected split-glyph reading-order case and the remaining figure OCR misses, with an actual source-review screenshot. A Johns Hopkins Biomedical Engineering coauthor appears on the paper; MTQC has no institutional affiliation or endorsement from Johns Hopkins.

## Enable live inference deliberately

Live requests are disabled by default. A server operator may set `NEBIUS_API_KEY` and `DEMO_LIVE_ENABLED=true` in the **server process environment**, then restart. Never place the key in a browser bundle, source file, published ZIP, or screenshot. The default model is `nvidia/Nemotron-3_5-Lightning`; `DEMO_NEBIUS_MODEL` can override its ID. An enabled status means only that a key is configured; it does not prove provider credit, entitlement, quality, or uptime.

The Document workbench supports an English source excerpt to each of these 18 targets: Korean, Spanish, Arabic, Simplified Chinese, Traditional Chinese, Japanese, French, German, Italian, Portuguese, Russian, Hindi, Indonesian, Dutch, Polish, Thai, Turkish, and Vietnamese. It sends at most 3,000 Unicode code points, with a 64 KiB request-body cap. A separate recorded-case button translates only the fixed Müller caption to Korean, Spanish, or Arabic. A document request atomically reserves **two provider attempts** before sending: one translation and one separate critique. A failed critique leaves a labeled incomplete draft, never a passed review. Requests time out after 20 seconds per call, are not automatically retried, and share a default three-attempt/client/hour and 20-attempt/global/hour in-process budget with single upstream concurrency. `DEMO_LIVE_PER_CLIENT_LIMIT` can be explicitly set from 1 to 20 for a controlled local 18-language smoke run; invalid values fall back to three. For a public host, set both `DEMO_LIVE_TOTAL_ATTEMPTS` (1–1,000) and an absolute `DEMO_LIVE_LEDGER_PATH` on persistent storage; the server reserves attempts before calling Nebius, survives app restarts, and fails closed if the ledger is unreadable. Missing or invalid paired settings disable live mode. The hourly counters still reset on process restart; neither mechanism is a **monetary hard cap**. Apply a provider-side budget and deployment monitoring before enabling a public instance.

The progress bar is a time-derived **estimate**, not model telemetry or a promised ETA. It remains below 100% while waiting and reaches 100% only after both provider stages and rules complete. Errors/cancellation do not claim completion. Draft outputs display per-stage model/token metadata, unverified AI review suggestions, and scoped rule coverage including `not assessed`. The numeric, directional, narrow Korean `femoral vein`, and Spanish/Arabic negation-marker checks catch some discrepancies but cannot establish medical correctness or correct semantic scope. The terminology check was added after a real hosted model call substituted `대정맥` for `femoral vein`; it is only a review prompt, not a general terminology validator. Arabic uses right-to-left presentation. No content is silently marked medically approved.

## Build, verify, release

Pending document requests lock the submit button. **Cancel request** aborts the browser request and discards late results; it does not guarantee that the provider incurred no usage. Selecting another source, editing text, or changing language also invalidates a pending draft. Scanned PDF pages are rendered at scale 3 (~216 dpi) for local OCR, with a 12-million-pixel per-page bound; searchable pages retain scale 1.25. Larger pages are rejected before canvas allocation. This improves some observed captions but is not complete diagram transcription.

Automatic image OCR insertion resets source approval. Approval of an empty input never approves text that arrives later; reviewers must inspect the recovered text and approve it explicitly.

The corpus runner now permits only individually documented missing anchors/order edges in `src/web_demo_browser_tests/corpus.allowed-failures.json`, not whole-case exemptions. Any new failure, empty extraction or unannotated case fails. Output-line fragment IDs are checked for missing, duplicate and foreign identities, independently of input/output counts. These are engineering retention checks, not semantic or clinical validation.

```powershell
cd "src/web_demo_client"
npm ci
npm run build
cd ../..
dotnet run --project "src/web_demo_tests/MedicalQcWebDemoTests.csproj"
node --test src/web_demo_evaluation/*.test.mjs
cd "src/web_demo_browser_tests"
npm ci
npm test
cd ../..
& "scripts/web_demo_release.ps1" -SelfCheck
& "scripts/web_demo_release.ps1"
```

Browser tests require Chrome; set `CHROME_PATH` if it is not installed at a usual path. They test actual local PDF extraction/OCR and intercepted model responses; they make **no billable provider call**. The release script validates the specimen hash manifest, publishes a fresh app, checks local workers over HTTP, scans a source-only export for obvious secrets and private-machine paths, then creates separate judge-build and source archives with SHA-256 hashes. The scoped public export contains `.github/workflows/mtqc.yml` for Windows/Linux clean-clone verification. Run the release script after any source or dependency change.

The [bounded paired review evaluation](docs/web-demo/REVIEW_EVALUATION_20261001.md) reports the actual negative pilot: the second model call added no localized detection on three controlled numeric/direction seeds, and a two-seed negation development retest also found no additional localized detection. It increased review-suggestion volume. These results are why model findings are explicitly labeled **unverified suggestions** and human inspection remains mandatory. They are not an 18-language benchmark or a medical-quality claim.

The optional `scripts/smoke_18_languages.ps1` launches only a loopback server, makes one short real request per target with no automatic retry, and records per-call token usage and an estimated cost under a configurable script limit. This spends provider credit and requires a User-scope key. The estimate uses public model rates, not an account billing ledger. A successful API response is only runtime evidence; it is **not** a multilingual medical-quality benchmark.

## Rights and scope

[RIGHTS.md](docs/web-demo/RIGHTS.md) inventories the recorded Servier and Müller source permissions, modifications, and unreviewed status. [THIRD_PARTY_NOTICES.md](docs/web-demo/THIRD_PARTY_NOTICES.md) lists local PDF/OCR dependencies. Users retain responsibility for the rights and privacy of anything they select in the Document workbench. The browser demo is not the older Windows Word/PDF processing engine; the two should not be represented as the same runtime capability. No Harrison textbook page, patient record, private manuscript, or secret belongs in the public release.
