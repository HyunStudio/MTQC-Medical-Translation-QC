# Judge budget v2 local candidate plan

> Use superpowers:executing-plans. Local preparation only; the earlier owner-approved unknown-cost blocking policy is not changed in production without informed authorization.

**Goal:** Avoid a completed network failure disabling the entire judge demo while preserving conservative maximum cost accounting.

**Design:** Add explicit opt-in `reserved-budget-v2`. Each dispatched v2 reservation is permanently consumed, even if subsequently genuinely reconciled for less. A finished failed v2 request with either no observed response usage, or valid priced usage, no longer blocks after its OS run owner releases. State and actual billed values stay truthful. Invalid observed usage/model, active/orphaned requests, corrupt state and unaccepted legacy failures still block. V1/default behavior stays intact. An old v1 failure is not silently grandfathered; the separate explicit one-call loss importer is required for the existing MRI failure.

**Alternative considered:** One-call manual acceptance alone cannot provide continuous judge access. Increasing/removing budget limits, retries, invented actual receipts or promo expiry are rejected. All existing USD5 total / USD0.50 KST day / USD0.15 run / fixed model/rates / concurrency / lifetime limits remain.

**Compatibility:** New v2 entries require ledger schema3. Historical tools reject the ledger. The existing accepted-loss schema3 also remains supported; no downgrade.

**Review focus:** mixed v1/v2 history; malformed usage vs a no-response timeout; live lease even after Finish; cancelled unstarted reservations; later smaller billing receipt; cumulative/daily/expiry/lifetime limits; no provider traffic during tests.

- [x] New failing tests for explicit configuration, sequential failures/restart, legacy/active/usage anomalies, irreversible maximum consumption, unchanged limits and version migration.
- [x] Minimal options/ledger implementation; no HTTP administration route or provider timeout/retry changes.
- [x] Focused tests and related money regression; independent source review; Release build.
- [x] Prepare one combined concrete activation proposal. Do not deploy/import/change settings or send another paid request without its authorization.
