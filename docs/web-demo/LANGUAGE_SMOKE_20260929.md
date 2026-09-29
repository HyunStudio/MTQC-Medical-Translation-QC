# Short real-inference smoke - 18 target languages

Date: 2026-09-29. Source: an original synthetic sentence, `The proximal artery measures 2.5 mm. The distal vein measures 1.8 mm.` Each target received exactly one call via the local browser-demo backend and `nvidia/Nemotron-3_5-Lightning` on Nebius Token Factory. The API returned `ok` and model/token metadata for all 18 targets. No automatic retry was used.

| Targets | Result |
| --- | --- |
| Korean, Spanish, Arabic, Simplified Chinese, Traditional Chinese, Japanese | 6/6 runtime successes |
| French, German, Italian, Portuguese, Russian, Hindi | 6/6 runtime successes |
| Indonesian, Dutch, Polish, Thai, Turkish, Vietnamese | 6/6 runtime successes |

Total: 2,307 input tokens, 501 output tokens. At [Nebius's listed Lightning rates](https://nebius.com/services/token-factory/models/nvidia-nemotron-models-inference) of $0.06 per million input and $0.24 per million output tokens, the run's token-cost estimate is **USD 0.00025866**. This is not the provider billing ledger and excludes any unrelated account activity. The script's new-call estimate guard was set at USD 0.05; it did not approach the user's USD 1 work limit. The local detailed report is kept under ignored `output/smoke-18-20260929-130834/report.json` rather than published as a medical-quality data set.

The initial QC output identified nine exact numeric-format changes, mostly decimal dot-to-comma conversions. It also flagged `proximal`/`distal` in Spanish and Portuguese as untranslated English, although those spellings are legitimate medical cognates. A test reproduced this false positive; the rule now exempts Spanish, Portuguese, and French cognates while retaining human-review warnings for other relevant targets. This correction did not require another paid call.

These calls establish that the 18 configured routes reach the intended model and return draft text. They **do not** establish medical correctness, idiomatic translation, reading-order robustness, population generalization, clinician approval, or a patient-safe product. All drafts remain `AI_DRAFT_UNREVIEWED`.
