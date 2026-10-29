# October 29 public source update

**October 30 follow-up:** The final-review repair commit `d65e86e` passed full
Windows and Ubuntu CI, was deployed to the existing Azure app with paid calls
disabled, and passed 56 served-asset hash checks plus desktop/mobile readiness.
Read [final validation and remaining limits](FINAL_VALIDATION_20261029.md).
The original publication/deployment history below retains its own scope.

This update publishes the already reviewed current browser/client product
payload and the minimal shared DOCX dependencies. The owner explicitly approved
Apache-2.0 coverage for src/document_core's four files and
src/status_dashboard/SiblingTempPath.cs. The full root Apache-2.0 license and
third-party/scientific notices are preserved. The private full Windows engine,
installer, manuscripts, internal logs and credentials are excluded.

The older public README is available in Git history at commit
45d320a0d211e60ce682109df98f77e7dbdc92b2. Historical studies, limits and failures
remain historical; their counts are not new accuracy or medical-quality claims.

## Functional boundaries

The latest video is https://youtu.be/954tVuF-6Qw (2:49). It identifies historical
Nemotron inference separately from later local development. Following source
publication, the existing Azure host was updated on October 29 from commit
`c29cbcf01f7fc275909b33b03b3178aa35b5d49a`. The root returned HTTP 200, and nine
selected assets returned HTTP 200 with hashes matching the reviewed package. The
recorded-case endpoint returned two cases, live status was unavailable and the
local native endpoint returned 404. This GET-only check did not execute browser
OCR, document processing, Word or a model request. See
[deployment evidence](AZURE_DEPLOYMENT_20261029.json). Paid calls remain disabled.
The default source-only quick start explicitly disables
paid and local native routes. Word and the older registered desktop CLI are
separate optional dependencies and are not included in this repository update.

Bounded later work includes multi-table topology, compound-vector/raster figure
correspondence, caption-below controls, source-linked DOCX handoff, PDF.js review
and unreviewed Korean figure-label translation-sheet input. Thirteen imported
targets do not demonstrate accepted translated-figure output; the observed
export remains held. Fifty-seven Korean publisher-XML reading-PDF pages do not
establish reconstruction of their original complex PDFs. Clinical expert review
remains 0/15; general layout/math/OCR/relationship recovery is incomplete.

## Source and verification

Product files match the exact r3 source snapshot identified in
SOURCE_PROVENANCE_20261029.json. Publication changes only release documentation,
license coverage and Git handling of those reviewed bytes, not product logic.
The source includes registered JSZip files; generated worker/runtime directories
remain excluded. Tests and historical release helpers already public are retained.

The subsequent independent r3 review supplied in the project chat reports fresh
npm install/client build, .NET Release 0 warnings/errors, example validation and
principal GET 200 on the development machine. The follow-up inspected the build
outputs and matched the source manifest; it did not independently rerun command
outcomes. No new full build, browser/OCR suite or native run is claimed for this
publication. The separate Azure deployment subsequently ran pinned client build,
a non-incremental Release build with zero warnings/errors, publish and offline
fixture validation; its exact ZIP received independent read-only review before
deployment. The broad legacy GitHub matrix was not rerun. A build
check is not second-PC/clean-machine, complete UI or clinical validation.

The older r3/r4 judge attachments remain frozen evidence of their preparation
times, including the then-unresolved license scope. This subsequent public grant
and source publication supersede that licensing/public-source status. The later
Azure deployment supersedes their old hosted-version status for the web subset;
it does not deploy the separate Windows engine or enable paid calls.
Devpost replacement-attachment saving is still unconfirmed; this GitHub update
does not change the Devpost form or certify final submission compliance.
