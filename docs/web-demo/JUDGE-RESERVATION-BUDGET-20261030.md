# Repeated judge testing with a reserved expenditure budget

This is a separately reviewed candidate, not an activated r5 feature. The default settlement policy remains unchanged. The opt-in policy addresses a different operating contract: the owner authorizes a bounded expenditure envelope rather than asserting a provider credit balance or importing an actual receipt after each successful call.

## Contract

`reserved-budget-v1` records requests in the `operator-budget` category. That category describes the application's expenditure authorization, NOT a provider cash/trial/promo funding bucket. Actual provider credit expiry and the exact remaining balance can remain unknown; they must not be invented or relabeled. The operator accepts the possible expenditure within the authorized envelope, including any provider billing rather than promotional deductions. This acceptance requires separate explicit authorization before activation.

Every request reserves the maximum input/output cost calculated by the existing pinned model/rates and tax multiplier. Persisted new-policy records must retain that exact maximum; reduced reservations fail closed without rewriting the ledger. A normal successful response with valid usage retains its FULL reservation and `pending-billing` state, with actual billed amount and receipt absent. A later call may then proceed if all cumulative, daily, run and attempt limits still permit it. The reservation is not replaced with a smaller token estimate. Reconciliation is optional for continued successful testing and still requires a real matching receipt if used. The authorized total includes ALL historical committed entries across buckets and the existing prior cash hold, so changing policy or crossing midnight never restores that expenditure allowance.

An active/orphaned call, unknown usage, failed response, malformed ledger or unresolved legacy charge still blocks globally. Changing configuration does not convert a prior settlement-policy hold. Default-mode code reading these new records fails closed for admission; older r5 binaries reject the new accounting category and fail closed. Never discard or reset those records during rollback.

## Explicit server configuration (NOT executed)

- `DEMO_LIVE_ADMISSION_POLICY=reserved-budget-v1`
- `DEMO_LIVE_BILLING_BUCKET=operator-budget`
- `DEMO_LIVE_APPROVED_BUDGET_USD`: owner-approved exposure, greater than zero and at most USD5 for this implementation.
- `DEMO_LIVE_ACCESS_UNTIL_UTC`: operator's service end, after actual authorization time and no more than93days later. The user's requested December31 is an operator service date, not a claim about promotional-credit expiry. Use an explicit UTC offset.
- `DEMO_LIVE_BILLING_VERIFIED_UTC`: actual time of the separate expenditure authorization, never an automatically advanced or invented credit-verification timestamp.
- `DEMO_LIVE_BILLING_EVIDENCE`: private identifier for that owner authorization. Never claim it is a provider billing receipt.
- Existing verified `DEMO_LIVE_TAX_MULTIPLIER`, exact model/rates, persistent absolute `DEMO_LIVE_COST_LEDGER_PATH` and paired lifetime-attempt settings remain required for public operation. Reuse existing ledgers; do not reset counters.
- All legacy trial/cash/promo remaining-balance and promo-expiry variables must be absent, preventing mixed contracts.
- Keep `DEMO_LIVE_ENABLED=false` until owner activation/test approval, reviewed source/runtime deployment, correct account/project/key and current prices/tax have been checked. No secret belongs in public source or ZIP.

The operator service authorization has a fixed end instead of the legacy balance-proof24h refresh. That is an explicit alternate policy, not silently refreshed billing evidence. Legacy trial/cash/promo behavior retains its original24h freshness and actual expiry conditions.

## Limits and practical access

The current USD0.50/day and USD0.15/run limits, at most USD5 total authorized commitments, existing client/hour and global/hour limits, single upstream concurrency, persistent attempts and no automatic retries remain. At the current tax1 maximum reservation (~USD0.06335), this conservatively permits seven one-call requests per KST day and up to78 total without settlement, subject to other limits and previous charges. It is not unlimited use, a guaranteed number of successful translations, or a provider-enforced billing cap. Other account usage and price changes remain operational risks; verify current pricing before activation and monitor the account separately. Top-ups do not reset the application envelope.

No manual action is needed between valid successful calls. Exceptional/uncertain charges deliberately require operator investigation. Provider credit exhaustion may still produce an error; accepting up to USD5 liability does not guarantee that the provider grants model access or that credits survive through judging. No automatic top-up is implemented.

## Deployment completion conditions

1. Separate explicit authorization for this expenditure policy, source/Azure update and bounded real tests; local-code permission alone is insufficient.
2. Reviewed committed source, focused regressions, runtime/package identity and rollback record. Existing r5 remains immutable; any deployed candidate must be disclosed separately with corresponding source and a submission addendum.
3. Preserve persistent monetary/attempt ledgers. Inspect existing unresolved records without printing secrets. Resolve only with genuine evidence; do not waive old holds.
4. Two distinct short non-sensitive real draft requests under the approved test ceiling, no automatic retry/critique. This mode deliberately requires no manual settlement between successful requests; a failed/unknown first result blocks further requests. Confirm reservations and statuses privately after each. Real billed amounts remain unconfirmed unless genuine receipts exist.
5. Update current-access statements only after observed success. Local tests and available status alone are not real model or continuous-uptime evidence. Clinical validation remains0/15.

The nine new finite tests exercise actual services with fake HTTP handlers and synthetic operator authorization, including previous-day legacy spending and reduced-reservation rejection. Existing strict/promo money tests run separately in the affected group; no paid request or cloud setting change is part of them. Direct new-policy KST rollover, expiry between reserve/start and reverse-policy switching remain source-inspected boundaries rather than newly executed test claims.
