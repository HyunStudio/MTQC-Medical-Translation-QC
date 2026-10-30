# Hosted judge access — October 30, 2026

> Historical activation record at7f9b0f27. The current runtime and v2 operating policy, including the later failed and successful paper tests, are documented in [release r7](RELEASE_R7_20261030.md). The v1 limits and outcomes below retain their original scope.

The existing [public app](https://mtqc-nebius-2026-hyunstudio.azurewebsites.net/) now has live short-excerpt drafting enabled under an explicitly owner-authorized expenditure policy. Judges need no account, API key or payment. This deployment supersedes the previous OFF state; it does not change the immutable r5 archive.

## Exact software and verification

- Deployed source/runtime: `7f9b0f27c4149cb32dda5e4f6e7ac280ed8206b6`. Both served application/core DLL hashes matched the reviewed runtime.
- Server tests: 150/150, including 33 money guards. Windows and Ubuntu [clean-clone CI](https://github.com/HyunStudio/MTQC-Medical-Translation-QC/actions/runs/41029603359) passed. Counts are software tests, not clinical accuracy.
- Two different real `nvidia/Nemotron-3_5-Lightning` requests succeeded: synthetic English diagram text to Korean through the hosted document API (165 input / 27 output tokens), then the rights-cleared Müller Figure 1 caption to Spanish through the visible browser control (173 input / 87 output tokens).
- No critique, retry or operator settlement occurred between tests. The existing attempt counter advanced 7 to 9; both full USD0.06334656 reservations remained pending billing. Availability stayed true. Estimated usage cost was USD0.00004764 at pinned rates; actual settled charges are unconfirmed, not zero and not asserted to equal that estimate.

Independent source review found two financial-state defects in the initial candidate. Both were reproduced and fixed before final tests: the cumulative envelope includes historical commitments/prior cash hold, and reduced reservations fail closed. Original failures remain retained; the final fixes were verified by tests, not a claimed second independent review. Direct new-policy rollover, expiry between reserve/start and reverse-policy switching remain source-inspected boundaries rather than executed new tests.

## Judge's shortest test route

1. Open the app. Select **Arterial–venous anatomy · Figure 1**, then Korean, Spanish or Arabic.
2. In **Live model excerpt**, click **Translate fixed excerpt**. Inspect the unreviewed draft and model/token metadata. Only the caption is drafted, not the paper; a repeated fixed example may return a cached model result.
3. For a different excerpt, use **Try a document** with a rights-cleared non-sensitive English PDF of up to two pages or PNG/JPEG up to 10 MiB. Verify intended source regions and the derived preview, select a target, confirm review/rights, then click **Translate and review excerpt**. Leave critique unchecked for the one-call default. Only approved text is sent; extraction/OCR runs in the browser.
4. Compare with the source. Supported target selection does not establish every-language medical accuracy. Do not enter patient data.

## Operating limits

The deployed `reserved-budget-v1` policy retains full reservations while allowing the next successful call within an owner-authorized USD5 total envelope, USD0.50/day and USD0.15/run. Historical committed spending and the prior cash hold count. Three requests/client/hour, the global hourly limit, single upstream concurrency and the existing 100 lifetime attempts remain.

At current tax1 maximum reservations, no more than seven one-call requests fit a KST day, fewer after other use. This is budgeted access, not unlimited use or a provider billing hard cap. Active/orphaned, failed, unknown-cost, corrupt or unresolved legacy charges block globally. No automatic retry, top-up, reset or invented receipt is used.

The owner-selected service end is **December 31, 2026 at 23:59 KST**, not a promotional-credit expiry claim. The accounting category is authorized expenditure, not a fabricated cash/trial/promo balance. The [policy guide](JUDGE-RESERVATION-BUDGET-20261030.md) records the prospective contract; this deployment note supplies the observed activation outcome. Local source builds remain OFF by default.

## Preserved scope

`MTQC-final-review-20261030-r5.zip` remains frozen, SHA-256 `7f35530e7391c3c4fe6e5ba0e57dbf584b5dcdbc721893c8855ba33e1e2dfb9c`, source/docs `7efaaf20`, runtime `d65e86e`. Current deployed code is the explicit public follow-up `7f9b0f27`; this operations note is a later documentation-only addition.

The 2:49 video predates activation and separates historical inference from local evidence. No new hosted full-paper reconstruction, scanned-math, OCR or Word validation is claimed. Clinical expert review remains 0/15. Two runtime requests do not prove continuous uptime, all-language quality, clinical clearance or organizer eligibility.
