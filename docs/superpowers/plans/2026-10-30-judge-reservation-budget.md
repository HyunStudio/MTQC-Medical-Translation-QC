# Judge reservation budget implementation plan

> Use executing-plans inline, followed by one fresh source review. The human explicitly directs autonomous completion and judge testing without per-call operator intervention; no further design interview is needed for local implementation. Deployment and real spending remain separately gated.

**Goal:** Permit repeated valid draft calls within an explicitly operator-authorized financial exposure envelope, without fabricating settled charges or provider credit facts.

**Architecture:** Add an opt-in `reserved-budget-v1` admission policy and `operator-budget` accounting category. This is authorized expenditure, not an assertion of cash/promo balance. No provider expiry is invented: a separate operator access-end timestamp bounds service. Keep the existing policy as default, existing real-balance expiry/freshness checks unchanged, and all existing records intact. A normal valid response under the new policy retains its FULL monetary reservation and pending-billing status, but no longer blocks the next call. Active/orphaned, unknown-cost, failed and legacy unresolved entries still block globally. Actual receipt import remains available, never automated from token estimates.

**Constraints:** New authorized envelope >0 and <=USD5; existing dailyUSD0.50/runUSD0.15 caps, pinned model/rates, durable locks, attempt limits and no retry unchanged. Authorization start must be real and not future; end must be after start and at most93days later. These are operator authorization facts, not a 24h credit-balance snapshot. Explicit proof id, tax, and private persistent ledger required. All legacy/promo balance fields must be absent for the new policy; no ambiguous fallback.

**Scope:** Existing .NET options/parser/ledger and finite fake-provider regression tests, plus an operator guide. No browser feature, cloud change, paid request, public push or ZIP rebuild. Base local c541fcdc. Existing r5 remains submitted and immutable.

## Tasks

- [x] Add finite tests covering parser/negative configuration, repeated calls across restart, retained full reserves/unsettled amounts, exhausted envelope/day/run, old unresolved entries, unknown/failed outcome blocking, expiry and cross-instance ownership. Corrected tests compiled and gave missing-feature RED1/7; initial test setup compile failure retained.
- [x] Implement only the new opt-in contract; record policy with each reservation. Old entries default to settled policy; no retroactive conversion.
- [x] New GREEN7/7 and affected31/31. Independent review then found two Important financial-state issues; tests reproduced both (7/9, then strengthened prior-day0/1). Fixes retain all historical commitments/prior cash hold and validate exact full new-policy reserves. Final affected33/33, unchanged old assertions. All failures retained.
- [ ] One independent read-only source review, fix substantive findings, record exact branch/patch and prepare operator/deployment instructions. No activation claim.

**Review focus:** Cross-policy legacy holds, persisted policy tampering, rollover/restart financial envelopes, requests completing after operator end, and daily/run versus cumulative accounting. No safe software bound is represented as a provider-enforced billing hard cap.

**Approaches considered:** Per-call manual actual settlement defeats unattended judging; inventing a provider billing API or expiry is unacceptable. Explicit full-reservation accumulation meets the stated testing goal while keeping amounts held and costs distinguishable. Changing the default policy or silently reclassifying existing holds is excluded.

## Execution / final review

One fresh source reviewer identified two Important issues; both fixed in one RED/GREEN pass. Review does not attest external financial facts or activation. Deferred minor: direct new-policy KST rollover, expiry between reserve/start and reverse-policy-switch boundaries remain inspection-only; do not claim executed coverage.

Ruling: widen final verification to the server suite once because the source review changed shared monetary validation and the options contract. This is a changed-code regression check, not repetition of old immutable evidence. Browser/Word/PDF/OCR/client suites and r5 ZIP are unchanged and are not rerun/rebuilt. Cost if wrong: unrelated frontend interactions remain outside this candidate's new evidence.

Ruling: count all historical commitments and PriorCashHoldUsd in the operator total rather than grant a fresh allowance on switching policy. This is conservative and may offer fewer calls; it preserves the existing financial history.

External facts, configured persistent storage, actual authorization, provider access and clinical acceptance remain outside source review and unproven until separate authorized checks. No coherent privileged ledger forgery protection is claimed; malformed new-policy reserve validation is enforced.
