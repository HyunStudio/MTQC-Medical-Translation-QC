# Promo admission candidate implementation plan

**Goal:** Represent the observed Builder promotional grant truthfully without changing legacy funding policy or activating any live service.

**Architecture:** Extend only the existing options/admission/ledger contract with an explicit `promo` bucket. Unknown legacy balances remain null in promo mode. Promo requires its own remaining amount and explicit expiry, fresh evidence, the same daily/run caps, a USD20 protected balance and at most USD5 cumulative commitments. All unresolved-charge blocking and actual-receipt rules remain unchanged.

**Tech:** Existing .NET10 server and finite offline fake-provider tests. Work occurs on a separate local branch in the dedicated public-source clone; original project/main and the immutable r5 package remain untouched.

## Cause and completion criteria

The account UI confirms a Builder USD25 credit grant, but r5 accepts only trial/cash. Reclassifying it as cash is prohibited. The account's precise remaining split and expiry remain unconfirmed. This candidate must fail closed without them and must NOT claim judge access ready. No cloud, paid call, push or portal action is authorized by this local repair.

## Scope

- `LiveMoneyOptions.cs`: nullable legacy balances, explicit promo balance/expiry, environment parsing that rejects mixed funding fields; leave legacy conditions unchanged.
- `LiveMoneyLedger.cs`: preserve daily accounting across buckets; promo lifetime commitment cap and protected balance; accept real promo entries/receipts without resetting old state.
- `web_demo_tests/Program.cs`: new positive and negative tests through real public parsing/admission APIs with synthetic evidence and fake provider responses.
- Operator documentation: exact new configuration and remaining approval/expiry/settlement requirements. No ZIP generation.

## Steps

- [x] Add seven focused tests; run new cases against the old implementation and retain the expected missing-promo RED (2/7 pass, 5 expected failures).
- [x] Implement the narrow options/ledger change, preserving historical failures and old assertions.
- [x] Run new tests GREEN (7/7), then the affected money-guard group (24/24) because the shared monetary classes changed. No unrelated Node, browser, Word or release suites rerun.
- [x] Inspect the exact diff and verify evidence bindings; retain the patch as a local unactivated candidate. No public or hosted identity is changed.

## Execution record

The dedicated existing clone is isolated on `fix/promo-admission-20261030`, base `7efaaf20d8b10c78b3707179c5a88086bb965d4e`. The operator requested this bounded fix and preservation of existing safety rules; local monetary-policy relaxation is not authorized. Pre-flight shared interface: nullable options feed only the existing ledger, parser and tests; the legacy path requires both balances before admission. No separate reachable specification exists beyond the human's stated blocker conditions and this cause/completion contract.

Retained logs: `output/qa/mtqc-promo-candidate-20261030/{red,green,affected-money-guards}.log` in the shared delivery workspace. The affected-group log ends `24/24 passed`; the original tool session no longer exists after compaction, so no newly retrieved raw exit code is asserted for that parent. No rerun was performed to obtain a replacement receipt.

Final review: one fresh read-only reviewer dispatched after the affected group passed. Operator documentation is in `docs/web-demo/PROMO-ADMISSION-CANDIDATE-20261030.md`. Review findings and final patch identity are recorded in the delivery QA folder when available.

Final review result: GO for the software candidate, no Critical/Important findings. Minor (deferred): an explicit mixed legacy/promo history regression would strengthen coverage of the currently preserved global daily and unresolved-charge rules. No production behavior changed after GREEN or review. `git diff --check` passed.

Ruling: do not rerun unrelated previously passed suites or rebuild r5 — the human explicitly prohibited repetition without a relevant change. The changed money-guard group and new promo tests cover this monetary-only patch. Cost if wrong: an interaction outside that boundary remains untested; deployment is not authorized or asserted.

Final rulings on declined review scope: real account facts and per-call billing remain external unproven prerequisites; no activation or publication is authorized by this source review. Unchanged ledger persistence/ownership design remains outside this narrow patch and is not newly certified. No new assurance is inferred for those mechanisms.

## Required failure classes

Reject missing/expired promo expiry, stale/future evidence, mixed legacy/promo balances, negative/over-USD25 promo amount, unknown bucket, missing funds above the protected USD20, daily/run overflow and conflicting receipt bucket. A successful response must remain pending billing across a restart until a valid synthetic test receipt is explicitly imported. Old trial/cash tests must retain their exact safety expectations. Expiry must not prevent recording an already-started outcome or offline settlement.
