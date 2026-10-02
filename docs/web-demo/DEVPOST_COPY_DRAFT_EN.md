# Devpost submission copy — published reference

Target: Nebius x NVIDIA Global AI Hackathon, Best Apps and Agents. Submitted 2026-09-29 at https://devpost.com/software/mtqc-medical-textbook-translation-quality-control. This file preserves planning copy; the live Devpost page is the authoritative published version.

## Project name

MTQC — Medical Document Translation & QC

## Elevator pitch

Review-first medical document translation: 18-language live excerpts, visual comparison, and evidence-linked QC via Nemotron.

## Problem and audience

Medical diagrams and complex documents carry meaning in labels, figure relationships, layout, and source context. A fluent-looking translation can still change an anatomical direction, a number, or a visual relationship. Translators, researchers, and medical editors need to inspect the source and draft together, find the exact evidence behind a QC warning, and know which checks have **not** been performed.

## What the project does

The English-first browser workbench lets a reviewer select a rights-cleared specimen and target language, compare source and target images at full size, inspect aligned strings and evidence-linked QC findings, open an editable PowerPoint where available, and switch between light and dark themes. The Document workbench accepts a small English PDF (up to two pages) or image (up to 10 MiB), extracts text or runs English OCR locally in the browser, and asks the user to correct and approve the excerpt before sending it. The selected file is not uploaded. The reviewer can request a live draft in any of 18 target languages. One NVIDIA Nemotron call drafts the translation; a separate call critiques that exact draft. The interface keeps both stages' model/token provenance, exact quoted evidence, deterministic rule findings, categories not assessed, and human inspection acknowledgment separate. The progress bar is explicitly a time-derived estimate, not model telemetry or an ETA; only a successful two-stage response and rule pass reaches 100%.

The saved Servier Medical Art visual-system specimen has an English source and 18 draft target slides (19 displayed languages total). A separate Müller et al. Figure 1 specimen demonstrates a three-language comparison for its title, caption, and four labels. The two-column article itself is **not** translated.

This browser workbench does not reconstruct a fully translated textbook or PDF. A 2026-10-02 native PowerPoint visual audit corrected clipped titles and mid-word label breaks across the recorded Servier slides. The public decks and previews remove the original master logos while retaining plain-text Servier/CC BY attribution. The anatomical illustration and connector endpoints remain; some title and label geometry changed.

The recorded specimens load without credentials or model charges. They are labeled AI drafts, and layout/coverage checks are separated from still-pending clinician and native-speaker review. This is an educational demonstration, not clinical advice or certified translation.

For a genuine runtime model path, a user-approved excerpt can be translated from English into Korean, Spanish, Arabic, Simplified or Traditional Chinese, Japanese, French, German, Italian, Portuguese, Russian, Hindi, Indonesian, Dutch, Polish, Thai, Turkish, or Vietnamese with `nvidia/Nemotron-3_5-Lightning` through Nebius Token Factory. The fixed Müller Figure 1 caption remains a separate three-language live example. The API key remains server-side. The document route atomically reserves two provider attempts against a persistent public-host ledger, bounds source and output length, times out after 20 seconds per model call, and applies per-client/hourly limits. If the critique fails, the translation is labeled incomplete rather than passed. Numeric, direction, selected terminology, and selected negation signals are narrow review prompts; unsupported categories explicitly remain unassessed. Neither a model suggestion nor a clean rule result is medical approval.

## How it was built

- ASP.NET Core/.NET 10 serves the browser workbench and fixed specimen assets; local PDF.js and Tesseract.js workers process selected files in the browser.
- A server-side Token Factory adapter makes sequential NVIDIA Nemotron translation and critique calls only when live mode and a provider key are configured; recorded review is available without them.
- A metadata-only audit export records stage provenance, rule coverage, and human inspection without exporting the source or translated text.
- Fixture hashes, explicit rights/provenance notes, automated .NET checks, and browser regression checks make the displayed results auditable.
- A new 2026-09-29 short real-inference smoke used all 18 targets once each: 18 successful API responses, 2,307 input and 501 output tokens. At the listed Lightning rates, the token-cost estimate for those calls is USD 0.00025866, not an account billing observation. Several outputs triggered conservative number-format or residual English directional-term warnings. Earlier Korean and Arabic checks also found a directional substitution, an untranslated term, and number punctuation changes. These are bounded observations, not a translation-quality benchmark.

## What changed during this hackathon

An older Windows Word/PDF translation-and-QC engine existed before the August 26, 2026 submission period. The hackathon work added the judge-facing English browser workbench, source/target visual comparison, documented licensed specimens, evidence-linked QC, responsive light/dark and RTL presentation, local PDF/image extraction, the 18-target runtime Nebius/NVIDIA excerpt adapter, safety bounds, and tests. We do not represent the older core engine or the recorded translations as newly created for this event.

## Challenges and lessons

The hardest product boundary was making review evidence useful without turning a recorded specimen into a fake live translation or implying clinical clearance. The workbench labels recorded outputs explicitly and separates them from user-submitted live excerpts. Real Nemotron responses also showed why domain-specific QC matters: directional terminology may drift, English medical phrases may survive in a non-English draft, and number punctuation may change. The separate critique can itself create plausible false alarms, so exact evidence spans, unverified labels, and human review stay visible. A two-column reading-order proposal is inspectable but does not reconstruct tables or figure semantics.

## Nebius/NVIDIA feedback — first-hand, scoped

The Token Factory API was straightforward to connect to a server-side .NET client and the Lightning model was inexpensive for short excerpt trials at the listed token rates. For a public judge demo, credit visibility and a provider-side monetary cap matter more than an in-process rate limiter, since local counters reset on restart. The UI therefore does not promise that configuration alone guarantees live availability. We would value a simple project-level hard spend limit and a readily queryable remaining-credit endpoint for safe public demos. This feedback reflects short local calls only, not load or uptime testing.

## Testing and limitations

The current local milestone has 68/68 .NET server checks, 33/33 browser workflow checks, and 18/18 evaluation/release/video contract checks. The saved 18-language visual case is separate from the older 18 short live Nemotron smoke calls. A new frozen paired pilot used three synthetic source passages across Korean, Spanish, and Arabic, comparing deterministic rules against the same rules plus a second model critique on identical saved drafts. Both arms localized all three controlled numeric/direction seeds; the second call added **zero** localized detections while increasing warning volume from 7 to 22 and producing three narrowly adjudicated false positives. A separate two-seed negation development retest localized zero of two in both arms. This is a negative, small-sample engineering result—not a medical-translation benchmark. No independent medical or native-speaker validation has been recorded. A real hosted Korean call substituted `대정맥` for `femoral vein`; a narrow QC review warning now catches the observed substitution, and the terminology instruction was strengthened. The browser demo is not the full Windows document engine and cannot be used for patient care. The public F1 host requires continued uptime/credit monitoring.

## Required links and submission fields

- Working demo or test build: https://mtqc-nebius-2026-hyunstudio.azurewebsites.net/
- Public repository with top-level Apache-2.0 license and setup README: https://github.com/HyunStudio/MTQC-Medical-Translation-QC
- Public YouTube video under three minutes: https://youtu.be/FE4t_vn89X8 (2:19, 1080p, English narration/burned captions, attributed anatomy comparison with third-party logos obscured, original synthetic two-column PDF review, one genuine Arabic translation and separate critique, narrow QC coverage and the negative pilot result)

The 2026-09-30 intake pilot exercises 22 inputs across twelve distinct medical-paper pages and three anatomy charts. Selected text-layer anchors improved 51/54 to 52/54 and selected order edges 23/26 to 25/26. Higher-resolution scan rendering improves the mixed PDF's selected anchors from 5/9 to 8/9, with a 12-million-pixel page cap and explicit empty-OCR-page warnings. The content gate allows only named known failures and independently checks output fragment identities; gate success does not erase remaining table/OCR shortcomings. Pending translation locks duplicate submit. Cancellation, source changes and withdrawn approval invalidate late or displayed drafts; automatic OCR replacement resets approval. These safeguards cannot refund usage already incurred. Full intake method and remaining failures: https://github.com/HyunStudio/MTQC-Medical-Translation-QC/blob/main/docs/web-demo/CORPUS_EVALUATION_20260930.md . Frozen paired critique-pilot method and raw counts: https://github.com/HyunStudio/MTQC-Medical-Translation-QC/blob/main/docs/web-demo/REVIEW_EVALUATION_20261001.md .

The prior 118.5-second video demonstrated only one Arabic model call and is historical. The new 2:19 video shows the current two-stage review using one genuine browser request that reserved exactly two provider attempts. It is not evidence that the model is medically accurate, that the full 18-language set passed human review, or that public-host credit/entitlement will remain available throughout judging.
- Track: Best Apps and Agents
- Testing instructions: open the demo without credentials; inspect either recorded source/target diagram first. In the Document workbench, select only a rights-cleared English PDF (maximum two pages) or image (maximum 10 MiB), review/correct the browser-extracted English text, choose one of 18 targets, and request a server-side AI draft. Compare the source and draft and inspect the scoped QC warnings; do not enter patient data. Free F1 hosting can cold-start; the live endpoint has per-client, hourly, and 100-attempt lifetime limits.
- Source attributions and modification notices: project `RIGHTS.md` and in-app provenance panel.

The submitted Devpost page was verified in the logged-in UI: it displayed “Project submitted!” and “SUBMITTED TO Nebius x NVIDIA Global AI Hackathon.” A separate unauthenticated HTTP GET returned 200 with the project title, video ID, and public repository link.
