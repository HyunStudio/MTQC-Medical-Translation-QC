# Devpost copy — draft, not submitted

Target: Nebius x NVIDIA Global AI Hackathon, Best Apps and Agents. Last checked 2026-09-29 against https://nebiusglobalaihackathon.devpost.com/rules. Replace every `[PENDING ...]` field and recheck the live submission form before posting. A public YouTube video now exists; this draft does not assert that public app access or an open-source release exists.

## Project name

Medical Translation QC — Evidence Workbench

## Elevator pitch

A medical-document review workbench that puts original visuals, editable translated specimens, provenance, and scoped quality-control evidence side by side—with an optional, bounded live NVIDIA Nemotron excerpt through Nebius Token Factory.

## Problem and audience

Medical diagrams and complex documents carry meaning in labels, figure relationships, layout, and source context. A fluent-looking translation can still change an anatomical direction, a number, or a visual relationship. Translators, researchers, and medical editors need to inspect the source and draft together, find the exact evidence behind a QC warning, and know which checks have **not** been performed.

## What the project does

The English-first browser workbench lets a reviewer select a rights-cleared specimen and target language, compare source and target images at full size, inspect aligned strings and evidence-linked QC findings, open an editable PowerPoint where available, and switch between light and dark themes. A new Document workbench accepts a small English PDF (up to two pages) or image (up to 10 MiB), extracts text or runs English OCR locally in the browser, and asks the user to correct and approve the excerpt before sending it. The selected file is not uploaded. The reviewer can request a live draft in any of 18 target languages, inspect returned model/token metadata and scoped QC warnings, and compare source and draft. The progress bar is explicitly a time-derived estimate, not model telemetry or an ETA; only a successful response reaches 100%.

The saved Servier Medical Art visual-system specimen has an English source and 18 draft target slides (19 displayed languages total). A separate Müller et al. Figure 1 specimen demonstrates a three-language comparison for its title, caption, and four labels. The two-column article itself is **not** translated.

The recorded specimens load without credentials or model charges. They are labeled AI drafts, and layout/coverage checks are separated from still-pending clinician and native-speaker review. This is an educational demonstration, not clinical advice or certified translation.

For a genuine runtime model path, a user-approved excerpt can be translated from English into Korean, Spanish, Arabic, Simplified or Traditional Chinese, Japanese, French, German, Italian, Portuguese, Russian, Hindi, Indonesian, Dutch, Polish, Thai, Turkish, or Vietnamese with `nvidia/Nemotron-3_5-Lightning` through Nebius Token Factory. The fixed Müller Figure 1 caption remains a separate three-language live example. The API key remains server-side. The endpoint bounds source and output length, times out after 20 seconds, and applies in-process request limits. Directional terms and exact numeric formatting are checked after the model response; a warning means human review is needed, not that the output has been automatically repaired or medically approved.

## How it was built

- ASP.NET Core/.NET 10 serves the browser workbench and fixed specimen assets; local PDF.js and Tesseract.js workers process selected files in the browser.
- A server-side Token Factory adapter calls the NVIDIA Nemotron model only when live mode and a provider key are configured; recorded review is available without them.
- Fixture hashes, explicit rights/provenance notes, automated .NET checks, and browser regression checks make the displayed results auditable.
- A new 2026-09-29 short real-inference smoke used all 18 targets once each: 18 successful API responses, 2,307 input and 501 output tokens. At the listed Lightning rates, the token-cost estimate for those calls is USD 0.00025866, not an account billing observation. Several outputs triggered conservative number-format or residual English directional-term warnings. Earlier Korean and Arabic checks also found a directional substitution, an untranslated term, and number punctuation changes. These are bounded observations, not a translation-quality benchmark.

## What changed during this hackathon

An older Windows Word/PDF translation-and-QC engine existed before the August 26, 2026 submission period. The hackathon work added the judge-facing English browser workbench, source/target visual comparison, documented licensed specimens, evidence-linked QC, responsive light/dark and RTL presentation, local PDF/image extraction, the 18-target runtime Nebius/NVIDIA excerpt adapter, safety bounds, and tests. We do not represent the older core engine or the recorded translations as newly created for this event.

## Challenges and lessons

The hardest product boundary was making review evidence useful without turning a recorded specimen into a fake live translation. The workbench labels recorded outputs explicitly and separates them from user-submitted live excerpts. Real Nemotron responses also showed why domain-specific QC matters: directional terminology may drift, English medical phrases may survive in a non-English draft, and number punctuation may change. The system surfaces these as review items rather than silently declaring success.

## Nebius/NVIDIA feedback — first-hand, scoped

The Token Factory API was straightforward to connect to a server-side .NET client and the Lightning model was inexpensive for short excerpt trials at the listed token rates. For a public judge demo, credit visibility and a provider-side monetary cap matter more than an in-process rate limiter, since local counters reset on restart. The UI therefore does not promise that configuration alone guarantees live availability. We would value a simple project-level hard spend limit and a readily queryable remaining-credit endpoint for safe public demos. This feedback reflects short local calls only, not load or uptime testing.

## Testing and limitations

The local .NET and browser regression suites cover recorded specimens, browser-local PDF/OCR, 18-target acceptance, live response handling, and request limits; exact final counts should be inserted only after final release verification. The saved 18-language visual case is separate from the 18 short live Nemotron smoke calls. No independent medical or native-speaker validation has been recorded. The browser demo is not the full Windows document engine and cannot be used for patient care. A public deployment still needs separate uptime, spending, access, license, and secret-exposure checks.

## Required links and submission fields

- Working demo or test build: `[PENDING judge-accessible URL]`
- Public repository with top-level open-source license and setup README: `[PENDING public URL]`
- Public YouTube video under three minutes, showing operation: https://youtu.be/-TZlAbJm_7E (18-second authentic browser OCR and one real Arabic model response using an original synthetic diagram)
- Track: Best Apps and Agents
- Testing instructions: inspect a recorded case without credentials; in the Document workbench, use only a rights-cleared English PDF/image and request a live draft if the host enables credits. `[PENDING exact deployed behavior]`
- Source attributions and modification notices: project `RIGHTS.md` and in-app provenance panel.

Do not paste this draft into Devpost until all placeholders are resolved and the release owner approves public publication.
