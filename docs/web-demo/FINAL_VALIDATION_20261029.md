# Final review and repair: October 29, 2026

Completed October 30 (KST). **The bounded technical regression/release checks
passed.** This is not unconditional approval of all hackathon requirements or
clinical validity. Paid inference is still disabled and final Devpost attachment
saving remains unverified.

This review starts from the published/deployed `c29cbcf` product and documentation
commit `3640e43`. It is a new user-requested validation and repair, not a change
to historical results or the immutable r3/r4 judge archives.

## Reproduced defects and corrections

- The document-excerpt endpoint accepted `application/jsonp` as JSON because of
  a prefix check. A real HTTP regression reproduced 503 instead of 415. Parsed,
  exact media-type validation now rejects it; malformed/null/scalar/deep JSON
  remains 400 and a valid request remains 503 when paid admission is disabled.
- A fulfilled loader refusal could install the restored source/draft Word pair
  and report handoff completion. It now requires explicit loader success before
  fallback selection. Rejected/stale loads and later manual selections have
  regression coverage. This test does not launch Word.
- Figure translation sheets accepted unpaired UTF-16 surrogates. They now reject
  these corrupt strings while preserving readable Unicode, exact source binding,
  numeric/unit literals and the existing prohibition on implicit source review.
- The private review helper omitted transitive editor modules, producing 404s
  and a nonfunctional editor. Its explicit, capability-scoped static allowlist
  now supplies the required modules without exposing unrelated files.
- The release producer omitted the shared core/helper and registered JSZip,
  copied the legacy README and could ship core debug symbols/local PDB paths.
  Actual generated archives reproduced all three failure groups. The producer
  now includes the dependencies and current source rights/metadata, excludes
  local secrets/state, and forces a symbol-free Release rebuild. A harmless
  `.env`/key marker verifies archive exclusion; no real key enters the test.

Footnote diagnostics now describe both region and table-cell targets. Old tests
were aligned with the already-approved 128-axis/4096-position table limits,
explicit caption target selection and current local comparison metadata. The
actual outbound model request still has only reviewed text, target language and
the optional critique flag. No source geometry, font, tolerance or clinical
expectation was relaxed. Smoke tests collect failures and clean up each owned
browser context instead of stopping at the first failure.

## Verification scope

The complete server/QC suite passed **134/134**, evaluation tests **18/18**, and
visual fixture checks **6/6**. The actual isolated release producer passed
**3/3** archive checks: project/compile dependency closure; exact registered
assets/current source documentation; CRC and no runtime-state/debug-symbol
artifacts. The release prerequisite check verified all **42** specimen hashes.
npm reported no known vulnerabilities for the pinned client/test dependencies;
NuGet reported no vulnerable package in the web project at inspection time.
These are advisory checks, not a penetration-test certification.

The final whole `npm test` command returned exit 0: **513 passed / 1 skipped**
Node tests, **68/68** browser smoke checks, nine private-editor/download checks
and **4/4** recovery/audit-export checks. One existing
lowered-subscript synthetic test is deliberately skipped because its geometric
grouping has no confirmed source case; it is not silently counted as passing.

Initial failures and intermediate runs remain recorded, including a test-tool
collision where concurrent `npm ci` encountered an in-use native dependency and
left a partial dependency directory. Dependencies were restored; release testing
was moved to a separate source copy before the final whole-browser rerun.

## Release decision boundaries

The exact repair commit `d65e86e703b76a908eb43185e297cdd839772dde` also passed
the full [clean-clone GitHub CI](https://github.com/HyunStudio/MTQC-Medical-Translation-QC/actions/runs/40897352723)
on both **windows-latest and ubuntu-latest**, including the actual release ZIP
checks. These are hosted-runner builds/tests, not the separate Windows installer.

The corrected Azure ZIP received independent exact-artifact GO before one
deployment. The root returned 200, all **56** selected HTTP assets matched their
package hashes, two saved cases remained available, paid status was unavailable
and the native route returned 404. Six desktop/mobile readiness observations
passed with zero page errors, console errors, failed responses or attempted
POSTs. The two hosted screenshots were also inspected for visible layout.
This hosted check did not upload documents or execute OCR, Word or a model call.
See [the exact deployment record](AZURE_DEPLOYMENT_20261030.json).

This validates a bounded research-demo implementation. It does not prove another-PC installer execution, clinical
validity, general two-column PDF reconstruction, arbitrary scanned mathematics
or accepted translated-figure output. Clinical expert review remains **0/15**.
Synthetic provider-response tests are not fresh Nebius inference or billing
telemetry. Paid model calls remain disabled. Devpost attachment/save confirmation
is a separate, still-unverified action. The old r3/r4 archives are preserved;
use a separately prepared current source package for the corrected code.
