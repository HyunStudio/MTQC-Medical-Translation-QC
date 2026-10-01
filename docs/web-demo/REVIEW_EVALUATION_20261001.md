# MTQC bounded review evaluation — 1 October 2026

## Scope and provenance

This is a development evaluation of an educational excerpt-review prototype, not a clinical validation or a claim about full-document accuracy. The case manifest at `evaluation/cases-v1.json` contains three original synthetic English excerpts (Korean, Spanish, Arabic targets), their authorship/license, and frozen SHA-256 hashes. Direct drafts were generated with `nvidia/Nemotron-3_5-Lightning` through Nebius Token Factory. Each paired baseline and enhanced arm received the **same saved draft hash**. The baseline is the same deterministic QC gate used in the enhanced arm; the enhanced arm adds a separate model critique. It is *not* an old-versus-new app comparison.

Gold mutations were generated after freezing direct drafts and kept in a separate local file, never included in the critique request. A true positive requires the seeded category and an overlapping, anchored draft span; a generic warning does not count. `not assessed` remains distinct from `checked`. Non-seeded warnings are counted but not automatically called false positives; only explicitly adjudicated clean categories contribute to false-positive counts. Precision is **not measured** because warnings outside those categories were not adjudicated. The model's self-critique is not ground truth.

## Pilot v1: numeric and direction seeds

Six paired runs: three seeded changes and three unchanged controls across Korean, Spanish, and Arabic. Deterministic-only and deterministic-plus-model both localized **3/3 seeded errors** (direction 1/1, number 2/2). The enhanced arm added no seeded detection. Warning volume rose from **7 to 22**; within narrowly adjudicated clean categories, counted false positives rose from **0 to 3**. Four baseline and fourteen enhanced warnings were outside adjudicated categories. Thus this pilot does **not** demonstrate benefit from the second model call. The apparent 100% seeded recall is only 3/3 controlled examples and must not be generalized.

## Development retest v2: negation seeds

After observing v1, we tightened the critique prompt and created a **non-independent development retest** on the same direct drafts: four paired runs, two negation mutations and two controls in Spanish and Arabic. Neither arm localized a negation seed under the preregistered category-and-span rule (**0/2** each). The enhanced arm returned seven suggestions versus two baseline warnings; precision remained unmeasured. Some suggestions were labeled `other` or lacked a verified evidence span, so we did not credit them as negation detections. This failure motivated a narrow Spanish/Arabic negation-marker presence check and a UI change that labels all model findings as *unverified suggestions*. The rule change was regression-tested **after** this frozen retest and is not retroactively included in its reported counts.

## Cost, limits, and interpretation

The local durable ledger records **18 provider attempts** in total: three direct translations, eleven successful critique responses (ten retained unique run records plus one early success lost before per-run checkpoints were added), and four failed diagnostic critique attempts. No raw account bill was captured, so actual USD spend is **not measured**; tokens/latencies in local run records are not invoices. A hard local ceiling of 20 attempts was used for this evaluation. No patient data, proprietary textbook pages, or third-party PDF figures were sent in these calls. The raw synthetic drafts, gold labels, and model response records remain in ignored `output/evaluation/` rather than the public export.

The supported product claim is a bounded, review-first workflow: visual source/draft comparison, explicit pre-send source approval, sequential translation and critique with model/usage provenance, narrow deterministic checks, `not assessed` labels, and human inspection. It is **not** a medically validated translator, a proven error-reduction system, or a verified 18-language quality benchmark. Expert bilingual/clinical review and larger independent datasets remain required.

Recompute local pilot summaries (where local ignored capture files exist):

```sh
node src/web_demo_evaluation/run.mjs docs/web-demo/evaluation/cases-v1.json output/evaluation/review-runs.json output/evaluation/gold-v1.json output/evaluation/report-v1-new.json
node src/web_demo_evaluation/run.mjs docs/web-demo/evaluation/cases-v1.json output/evaluation/review-runs-v2.json output/evaluation/gold-v2.json output/evaluation/report-v2-new.json
node --test src/web_demo_evaluation/*.test.mjs
```

The report files use create-new semantics to prevent overwriting prior evidence. Source code and the rights-cleared manifest are public; the aggregate counts above are reported with their denominators, while private local run artifacts are not represented as a public benchmark.
