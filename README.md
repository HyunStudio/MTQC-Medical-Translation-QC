# MTQC - Medical Document Translation & QC

Research prototype for medical excerpt and document-structure review using
NVIDIA Nemotron through Nebius Token Factory, with browser-local PDF/OCR tools.
It is not a clinical translation service or a validated general PDF translator.

## October 29 public source update

This repository now includes the current reviewed browser/client implementation
and its shared DOCX package dependencies. The owner has authorized Apache-2.0
for the five supplemental files listed in [LICENSE-SCOPE.txt](LICENSE-SCOPE.txt).
Existing scientific and third-party licenses/attribution remain distinct.

- [Latest public video - 2:49](https://youtu.be/954tVuF-6Qw)
- [Hosted judge demo](https://mtqc-nebius-2026-hyunstudio.azurewebsites.net/)
- [Devpost project](https://devpost.com/software/mtqc-medical-textbook-translation-quality-control)
- [Exact update, verification scope and limits](docs/web-demo/RELEASE_UPDATE_20261029.md)

**The Azure web app was updated on October 29** from source commit
`c29cbcf01f7fc275909b33b03b3178aa35b5d49a`. The root returned HTTP 200, and
nine selected assets returned HTTP 200 with hashes matching the reviewed package.
Paid model requests remain disabled pending billing evidence. The
video identifies historical inference and later local development separately.
No key or payment is needed for saved examples or local extraction.
See the [deployment record](docs/web-demo/AZURE_DEPLOYMENT_20261029.json).

| Access | What is available / limits |
| --- | --- |
| Hosted October 29 web app | Current browser/client assets, saved editable visual drafts, source comparison and local PDF/OCR tools. Deployment was checked with GETs and asset hashes; hosted end-to-end document processing was not rerun. Paid inference remains unavailable. |
| Build this source locally | Current PDF.js/Tesseract workbench, source-bound draft/review components, bounded multi-table and compound-figure assembly, caption-below controls and unreviewed figure-label translation-sheet handoff. |
| Optional Word/PDF integration | Requires separately installed Word and the separately configured owned desktop CLI. That older Windows engine/installer is not included here. Keep native routes disabled for this source-only quick start. |
| Video evidence | 57 publisher-XML-derived Korean reading-PDF pages; bounded 122-cell complex excerpt; 13 imported figure-label translation targets. These are scoped observations, not general reconstruction or clinical acceptance. |
| Still incomplete | General original two-column PDF recovery, arbitrary scanned mathematics, figure relationships and accepted translated-figure export; clinical expert review 0/15. |

## Build and run without paid calls or Word

Requires .NET 10 SDK and Node.js 24 LTS with npm. Internet is needed once for
pinned npm dependencies. Run from a fresh clone in PowerShell:

```powershell
$env:DEMO_LIVE_ENABLED = 'false'
$env:MTQC_LOCAL_DOCUMENTS = 'false'
Remove-Item Env:MTQC_WORD_LAYOUT_MANIFEST -ErrorAction SilentlyContinue
Remove-Item Env:MTQC_VISUAL_AUDIT_MANIFEST -ErrorAction SilentlyContinue
Push-Location src/web_demo_client
npm ci --ignore-scripts --no-audit --no-fund
npm run build
Pop-Location
dotnet build src/web_demo/MedicalQcWebDemo.csproj -c Release --nologo
dotnet src/web_demo/bin/Release/net10.0/MedicalQcWebDemo.dll --validate-fixtures
dotnet src/web_demo/bin/Release/net10.0/MedicalQcWebDemo.dll --urls http://127.0.0.1:5080
```

Open http://127.0.0.1:5080 and inspect recorded examples. Try local extraction
only with non-sensitive English PDF/image input. Review every result and its
source correspondence. Stop the server with Ctrl+C. No API key is needed.
The client build supplies pinned PDF.js, Tesseract and PDF export assets with
their notices. The registered JSZip source asset is included in Git.

The web source supports source-linked DOCX draft/review handoff and optional
native review endpoints; their presence does not bundle Word or demonstrate
that optional desktop features work on a judge's PC. Caption/structure drafts,
OCR candidates, numeric warnings and model suggestions remain review aids.
Do not treat a successful build or an automated result as medical approval.

## Verification and provenance

The product payload is byte-identical to the reviewed 140-file r3 source archive
(archive SHA-256 `8b52a8b3e9292e856f6cd83c756d40734eec60e20226e7eb49add6240e7898a8`;
private producer `f26030b55941a2933c18a8831ba7e44dfd8b2386`). The archive includes
generated documentation as well as code; the manifest lists the product files.
This public update changes licensing, README and release documentation, not
product logic. See [source provenance](docs/web-demo/SOURCE_PROVENANCE_20261029.json).

A subsequent independent review reports a fresh extraction of final r3 passed
npm ci, client build, .NET Release build (0 warnings/errors), offline example
validation and principal local GET requests (HTTP 200) on the development PC.
The follow-up inspection found the resulting source and Release outputs and
matched the source manifest. Command/HTTP outcomes are attributed to that
supplied review; this publication did not repeat those executions. This is not
a second-PC installation, complete UI test, general-document or clinical test.

Historical evaluations and tests remain in the repository with their original
scope. The older broad GitHub matrix is not being rerun for this unchanged
payload publication; no new CI pass is claimed. This publication uses a skip-ci
commit rather than replaying the historical browser/OCR suites.

## Rights, model use and safety boundaries

First-party source: [Apache-2.0](LICENSE), with the exact supplemental grant in
[LICENSE-SCOPE.txt](LICENSE-SCOPE.txt). Scientific/visual specimens retain their
source licenses, attribution and adaptation notices. Read
[rights inventory](docs/web-demo/RIGHTS.md) and
[third-party notices](docs/web-demo/THIRD_PARTY_NOTICES.md).

Earlier genuine Arabic drafting and optional experimental critique used NVIDIA
Nemotron through Nebius Token Factory. This source publication makes no new
model call. Historical paired critique results were negative within their
limited categories; no general accuracy improvement is claimed. Billing and
budget admission remain held; configuring a key alone does not enable calls.
Never put a credential or patient-identifiable information in source or a
public demo. OCR/model output needs native-speaker and clinician review.

The older Windows engine, private setup package and manuscripts are excluded.
Public source availability resolves a source-access gap; it does not certify
all hackathon requirements, full document reconstruction or clinical validity.
