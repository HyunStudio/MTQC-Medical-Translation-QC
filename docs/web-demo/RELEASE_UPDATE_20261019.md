# October 19, 2026 release update

MTQC remains a research excerpt-review prototype. Recorded examples and browser-local extraction work without a model call. Live translation is held until the operator verifies billing bucket, remaining balance, tax and per-call attribution. A configured API key alone is insufficient.

## Product changes since the October 7 public build

- Durable monetary reservations: USD0.50 daily and USD0.15 per run, alongside existing attempt/concurrency limits. Trial experiments are capped at USD1, cash experiments at USD5, with USD20 reserved for judging. Successful usage remains pending billing with the full reservation held; the next paid dispatch, including experimental critique, is blocked until a real billing receipt is reconciled locally. These application guards are not provider-side monetary caps. No actual full-demo invoiced cost or measured affordable-run count is available.
- Live-availability state refreshes after completion, rejection, failure or cancellation. Stale responses cannot overwrite newer state. Saved examples remain available when live service is held.
- Bounded numeric/unit/negative-marker checks: explicit micro-unit aliases, adjectival 150-mg/150 mg equivalence, Spanish contrastive phrases excluded from negative markers, Arabic conjunction prefixes, and a constrained Korean frequency alias. Negation marker presence is not clause-level semantic verification.
- Case recovery and request-generation races are guarded. Selected literal ASCII identifiers are compared within explicit boundaries; unsupported forms remain unassessed. German direction-term cognates no longer generate the earlier leftover-English warning.
- Review identity includes language and rule/app labels. Text SHA-256 export is separately opt-in and off by default; hashes can identify short texts. Audit metadata is not proof of clinical review.
- Translation responses require explicit stop completion. Rejected responses preserve observed usage and held reservations. Invalid critique token counts follow a sanitized error path. No automatic provider retry or model substitution was added.

## Evidence and denominators

The source-bound local server suite passed 133/133 with zero build warnings/errors. The latest two regression groups first failed and then passed: five completion-rejection forms and six numeric-usage forms. Earlier UI work separately passed four new Chrome checks and eight related checks; these counts are not added to 133. Release export/CI and deployment checks are recorded separately.

Eighteen distinct source papers have been collected across successive pilots, below the planned 20-40. These are source/excerpt materials, not eighteen complete translated papers. Controlled drafts and injected errors were assistant-authored, with no new paid-model evaluation or independent medical/native-speaker truth.

| Dated controlled study | Error warnings | Unassessed errors | Assessed misses | Clean drafts with any warning | Runtime failures |
| --- | --- | --- | --- | --- | --- |
| Additional ten-paper study, 60 clean + 60 error cases | 49/60 before and after | 11/60 | 0 | 2/60 to 1/60 | 0/120 in each arm |
| Five-institution study, 30 clean + 39 error cases | 26/39 before and after | 11/39 | 2 | 4/30 to 3/30 | 0/69 in each arm |

The five-institution sources include Johns Hopkins, MIT, CU Anschutz, Cleveland Clinic and Stanford affiliated authors. Affiliation is not institutional validation or endorsement. The error categories include numeric changes, unit swaps, negative-marker removal/addition, number-unit binding swaps and direction changes. Denominators from separate studies are not pooled. Frozen final cases were consumed once per arm and were not retuned or replayed for this release.

A separate fresh 36-case synthetic software-contract follow-up improved development checks 14/24 to 24/24 and final checks 6/12 to 12/12, runtime failures zero. It is not a clinical accuracy estimate. The earlier paper misses and warnings remain historical results; the later synthetic gains must not be presented as a rerun of those paper cases.

## Remaining limits

General clause meaning, citation-number versus decimal ambiguity, some scientific-notation/frequency combinations, unsupported unit/direction forms, complex PDF semantics and image-internal labels still need review. Original-source human review remains 0/15; independent original-language truth and direct external reviewer acceptance are incomplete. The separate modifier design is not enabled by this release.

No new paid inference was used for this release preparation. Actual full-demo billed cost remains unmeasured. Neither software tests nor saved examples establish clinical safety, multilingual medical accuracy, arbitrary structure recovery or full r16 completion.

The existing approximately 2:19 demo video retains genuine earlier Arabic inference footage. Its evidence card is the historical October 4 snapshot (69 server / 34 browser), not the current test count or proof of currently enabled live billing.
