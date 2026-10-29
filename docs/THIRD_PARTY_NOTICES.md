# Third-party notices for the web demo

The app bundles browser-side PDF extraction and English OCR assets for local processing. These packages are not authored by this project. Keep their copyright and license notices when redistributing the judge build.

| Component | Version | Purpose | Declared license and source |
| --- | --- | --- | --- |
| [PDF.js (`pdfjs-dist`)](https://github.com/mozilla/pdf.js) | 6.3.289 | PDF rendering and text extraction | Apache License 2.0 |
| [Tesseract.js](https://github.com/naptha/tesseract.js) | 7.0.0 | Browser OCR orchestration | Apache License 2.0 |
| [Tesseract.js Core](https://github.com/naptha/tesseract.js-core) | 7.0.0 | WebAssembly OCR runtime | Apache License 2.0; the bundled core's `LICENSE` file is retained in `vendor/tesseract/core/` |
| [English trained data (`@tesseract.js-data/eng`)](https://github.com/naptha/tessdata) | 1.0.0 | Local English OCR | npm package metadata declares MIT; the upstream data repository displays Apache License 2.0. Both notices should be preserved pending clarification from the distributor. |

The project does not claim authorship of these components. Their original license terms govern them independently of the web-demo code license. Source links above are also the location of full upstream notices. The local `vendor/` directory is generated from the pinned package lock and is excluded from the public source export; rebuild it with `npm ci` and `npm run build` in `src/web_demo_client`.

Servier Medical Art and Müller et al. specimen rights are separate from these software dependencies; see [RIGHTS.md](RIGHTS.md). No third-party specimen or OCR data is relicensed by the project's code license.

PDF figure-label export uses pdf-lib1.17.1 (MIT), with @pdf-lib/standard-fonts1.0.0 (MIT), @pdf-lib/upng1.0.1 (MIT), pako1.0.11 (MIT AND Zlib), and tslib (0BSD). The pinned npm lock supplies the exact dependency versions. Generated `vendor/pdf-lib/notices/` retains the upstream license/copyright files; the standalone ESM bundle and notices are included in runtime packages. This component edits a local derived review copy, without sending PDF contents to a service.


## JSZip 3.10.1

The unchanged browser distribution is vendored from the bundled workspace dependency for local DOCX package processing. Used under the MIT option of its MIT/GPLv3 dual license. Full upstream license and bundled dependency notices are retained at src/web_demo/wwwroot/vendor/jszip/LICENSE.markdown. Exact browser bundle and license SHA-256 values are in the adjacent manifest.json. No runtime CDN requests.
