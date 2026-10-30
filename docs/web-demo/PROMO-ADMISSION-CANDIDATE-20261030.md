# Promotional-credit admission candidate — not activated

This local candidate is separate from the immutable r5 release and the deployed application. It fixes one representation mismatch: an AI Builder promotional grant is neither a cash balance nor the legacy trial bucket. It does not enable live calls or establish continuous judge access.

## Operator prerequisites

Before deployment or activation, obtain explicit owner approval and verify the exact remaining promotional balance, expiry, applicable tax/rates, account/project and model entitlement. A rounded total account balance or the original USD25 grant is not proof of the current unspent promotional amount. Do not invent an expiry or fill in unknown cash/trial balances. No actual account expiry has been established for this candidate.

The candidate uses the existing server-process configuration, API-key handling, attempt ledger and monetary ledger. Keep `DEMO_LIVE_ENABLED=false` until the separate activation gates are satisfied. Never put a key in the browser, repository or submission archive.

Required monetary fields for the new path:

| Server variable | Meaning |
| --- | --- |
| `DEMO_LIVE_BILLING_BUCKET` | Exactly `promo` |
| `DEMO_LIVE_PROMO_REMAINING_USD` | Verified exact remaining promotional USD, at most 25 |
| `DEMO_LIVE_PROMO_EXPIRES_UTC` | Verified expiry timestamp with explicit UTC offset |
| `DEMO_LIVE_BILLING_EVIDENCE` | Private operator evidence identifier; not a secret or document contents |
| `DEMO_LIVE_BILLING_VERIFIED_UTC` | Actual verification time, at most 24 hours old and not in the future |
| `DEMO_LIVE_TAX_MULTIPLIER` | Verified multiplier in the existing allowed range 1–2 |
| `DEMO_LIVE_COST_LEDGER_PATH` | Absolute path on persistent private storage; reuse the existing monetary ledger |

`DEMO_LIVE_TRIAL_REMAINING_USD` and `DEMO_LIVE_CASH_REMAINING_USD` must be absent in promo mode. Conversely, promo fields must be absent for the legacy trial/cash modes. Legacy funding rules are unchanged. Rates and model remain pinned to the existing Lightning contract; this patch does not enable other models.

## Limits and operations that remain mandatory

- The existing USD0.50 daily and USD0.15 run ceilings remain. Promo commitments additionally cannot exceed the lesser of USD5 and the verified promotional balance minus a protected USD20. These are application admission rules, not a provider-side billing hard cap.
- All unresolved charges in the same ledger block new dispatches across buckets. A successful draft leaves the full reservation pending actual billing; an optional sibling critique cannot proceed while that charge is unresolved.
- Only an explicit, matching actual-charge receipt imported through the existing offline `--reconcile-live-cost` command can release that hold. Token estimates, rounded/monthly billing totals and test receipts are insufficient evidence. Do not manufacture zero-cost receipts.
- Evidence expires after 24 hours; promotional expiry is checked at admission as well. Configuration is captured at process start, so a genuinely reverified snapshot requires an approved configuration reload/restart. Do not merely advance the timestamp or schedule invented renewals.
- Historical commitments are retained. A refreshed remaining-balance snapshot can conservatively count historical spending again. Do not clear, rotate or reset the ledger to restore capacity. Other account users can also consume the grant; the application cannot guarantee their spending.
- The monetary ledger retains version 2 and its existing prior cash hold. The candidate accepts existing legacy entries and new promo entries. Older r5 binaries reject promo entries and fail closed; rollback does not mean live mode can resume. Keep the original ledger intact and disable live mode during any approved rollback.

Outcome recording and offline settlement remain possible after admission evidence or promo credit expires, so an already-started charge is not lost. They do not permit a subsequent paid request.

## What this proves

Seven new finite offline tests use explicit synthetic proof and a fake HTTP handler. They cover separate funding, missing/expired/stale/mixed proof, expiry during a request, protected/daily/run/cumulative budgets and actual-receipt identity rules. The affected money-guard group reports 24/24 passing, including the 17 unchanged legacy tests. The original missing-feature failures are retained separately.

These checks establish software behavior only. No real provider call, cloud change, public push, Devpost save or r5 archive rebuild is part of this candidate. Without a reliable per-call actual-charge source or an available operator plus genuine daily evidence renewal, unattended continuous live judging remains NOT READY.
