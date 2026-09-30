# Medical-document intake evaluation — 2026-09-30

This is an evidence report for the MTQC browser intake workbench, **not** full-document translation, clinical validation, or a multilingual accuracy benchmark. [Sources, licensing and reproduction](CORPUS_SOURCES.md).

## Test design

22 actual inputs cover twelve distinct pages from three medical papers, three Servier anatomy charts, paired pages, scanned images, a degraded JPEG and a mixed searchable/scanned PDF. They exercise the real file picker, local workers, approval gate and reading-order controls. No provider request is made. Original documents and detailed QA outputs are kept local; public code includes the reproducible preparation script, source manifest and explicit anchor/order annotations.

Anchor checks ask whether a short source-grounded string survives; pairwise checks ask whether selected spans occur in the expected sequence. They do not measure every character, table relation, diagram label or medically correct translation. PDF fragment retention measures the selectable text layer only. A picture may contain additional text absent from that layer.

## Findings and corrections

| Finding | Baseline evidence | Change / replay |
| --- | --- | --- |
| PDF cleanup error | 16 of 22 inputs raised a browser error after extraction: `pdf?.destroy is not a function` | Destroy the PDF.js loading task, not the document proxy. Browser error collection is now asserted in regression tests. |
| Narrow journal gutter and centered footer | Spine page 2 had 2/3 selected order edges; ear page 2 retained 4/5 anchors and split a ligature across columns; ear page 3 had 2/3 edges | Robust gutter-edge percentiles and a 1.5%-width minimum handle the observed narrow gap. Revised scores: 3/3, 5/5, 3/3 respectively. Dedicated narrow-gutter and split-ligature regressions were observed failing before the fix. |
| Scanned prose columns interleaved | Synthetic two-column scan failed left-before-right assertion; actual spine scan 1/3 selected order edges, degraded scan 0/3 | Automatic OCR page segmentation passes the new synthetic regression. Actual source/degraded scan each improves to 2/3; spelling and some order errors remain. |
| One OCR segmentation is unsuitable for all inputs | Automatic page segmentation lost one selected venous-chart label that single-block OCR retained | Explicit document-page versus diagram-label OCR choice. Chart evaluation uses diagram mode; scan evaluation uses page mode. This is a reviewer choice, not automatic layout classification. Changing the preference never overwrites existing reviewer text. |
| Searchable PDF silently omits raster labels | Spine page 3 contains flowchart headings visible in the image but absent from the selectable layer | Detect embedded PDF image operations and display an explicit image-label omission warning. The original diagram remains visible; necessary labels must be entered manually. No automatic figure-label recovery is claimed. |
| Corrupt input | Added genuine-signature/broken-body PDF fixture | Safely rejected with no browser error and translation disabled. |

After the text-layer correction, the twelve unique PDF pages retain 52/54 selected anchors and satisfy 25/26 selected order edges, versus 51/54 and 23/26 in the baseline when both are scored with the same corrected annotations. Excluding the explicitly unresolved rotated table, the eleven remaining pages satisfy 49/49 anchors and 24/24 selected edges. These are narrow convenience-sample counts, **not** general accuracy estimates. Duplicate pair runs do not increase the distinct-page count.

## Remaining observed limitations

- **Rotated landscape table, spine page 9:** 3/5 contiguous anchors and 1/2 order edges. All selectable fragments survive, but wrapped cell headings are interleaved with adjacent columns. Row mode helps visual comparison; it does not infer cell membership or reconstruct the table. Do not translate its automatic text as a faithful table.
- **Raster/low-resolution prose:** original and degraded spine scans each retain 4/5 selected anchors and 2/3 edges. Ear diagram-page scan retains 4/5 and 2/3. Local OCR is review-only, including confidence values.
- **Mixed searchable/scanned PDF:** both pages produce editable text, but only 5/9 selected source anchors match in page mode. The rasterized figure-heavy second page needs transcription/correction; automatic segmentation can lose text.
- **Anatomy chart OCR:** diagram mode retains 3/4 Visual System anchors, 4/4 circulation anchors and 4/4 venous anchors. In the visual chart, the title is not retained as an exact contiguous string. A good-looking source/draft preview does not prove all labels were extracted or translated.
- **Diagram text:** raster labels in searchable PDFs are not extracted automatically. A page text layer can retain every selectable fragment while still omitting important visible information.

The initial runner identified these unresolved OCR/table cases but exempted whole case IDs from content-failure gating. The repair rounds below replace that exemption with individually documented failures. Real medical/native-language review remains unperformed.

## Verification and public evidence

Initial release regression suite: .NET 46/46, layout 8/8, browser 26/26. Corpus gates require no browser error, no third-party request, no POST, no approval bypass and no unexpected annotated failure. The initial fragment-count proxy did not independently validate output identities; the repair rounds below replace it. Each test run makes zero billable calls.

Final 22-input replay: all runtime/privacy/review/fragment-retention gates pass. Known OCR/table shortcomings above remain visible in the per-case scores. The loopback run explicitly disabled live inference; zero POST requests and zero external requests were observed. The source files were not sent to Nebius.

![Actual source-page review and image-label omission warning](assets/corpus-spine-review-20260930.png)

Source figure: Liu et al. (2024), Frontiers in Medicine, DOI [10.3389/fmed.2024.1403423](https://doi.org/10.3389/fmed.2024.1403423), PDF page 3 / Figure 1, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). MTQC adds the review interface, numbered overlay and warning; the screenshot is not a translated figure or publisher endorsement.

## Release record

The public-code milestone is `c0b2e8c`. Its scoped export was independently rebuilt and passed .NET 46/46, layout 8/8 and browser 26/26. The existing Azure Free F1 app was redeployed; HTTP checks confirmed the new OCR selector, image-label warning, loading-task cleanup and narrow-gutter code. No live provider request was made during deployment verification.

The Devpost story now includes the corpus design, measured improvements, remaining limitations and report link. Its gallery includes the credited source-review screenshot. The two-page judge brief was refreshed, rendered and visually inspected; after saving, the finalization page again displayed **Project submitted!**. The existing 118.5-second authentic narrated video is retained; its core workflow is unchanged, while the new intake choices and warnings are documented in the current report/screenshot.

Judge-build ZIP SHA-256: `F435264270969C4070FB9A6950F21CD690F999D1A3AC655B664DB9362A7720A1`. Updated source ZIP SHA-256: `9E8EA8FF11422DBBF09D3409D21C71E8ED7AB636B4DFB314B94947DAF0DC34C5`. These hashes identify the generated app/source snapshot; later evidence-only documentation and judge-PDF script updates are separate commits. Previous archives and PDFs remain available locally for rollback/reference.

## Submission-readiness repair rounds — September 30

The subsequent audit reproduced two engineering problems: a fresh public clone started recorded cases but returned 404 for PDF/OCR modules when following only Quick start; the live excerpt button remained enabled while a request was pending. Quick start now includes Node/npm and the local client build. In the fresh clone, those module URLs changed from 404 to 200 after the documented build. Pending requests now lock submit, offer explicit cancellation, and release the lock after success/error/cancellation. Late cancelled drafts are discarded; provider usage may already have occurred.

The content gate now allows only named missing anchors/order edges in `corpus.allowed-failures.json`, never an entire case ID. Empty or unannotated extractions fail closed, and newly missing headings or order edges fail even in known OCR cases. Output line fragment IDs are compared against source fragment identities for omissions, duplicates and foreign IDs; accepted-input counts are no longer the retention proof. The summary explicitly lists observed content limitations separately from engineering gates.

Scanned PDF pages now render at scale 3 (~216 dpi), versus the initial scale 1.25. A controlled replay of the same mixed PDF improves selected anchors from **5/9 to 8/9**; `Schematic diagram` still does not survive as an exact contiguous phrase. This is not full diagram recognition. Searchable pages retain their earlier geometry. A 12-million-pixel per-page guard rejects large sheets before canvas allocation. Another replay found that empty OCR pages were silently omitted; those page numbers are now explicitly reported while searchable-page text remains available.

Fresh regression at this milestone: **46 server, 9 layout, 5 corpus-policy, 29 browser checks**. The 22-input replay with the stricter policy passes runtime/privacy/review/fragment-identity gates and has no unpermitted annotated degradation. Known table/scan/chart limitations remain. The twelve unique searchable-page scores are unchanged at 52/54 anchors and 25/26 order edges. No billable model calls are made by these checks. Medical/native-language quality is still unvalidated, and the original preview is not a reconstructed translated document.

The earlier video and PDF describe the core workflow; their older test totals do not certify this later repair milestone. Use this report and the current source for the latest behavior. This section is implementation/verification evidence, not a claim that the Devpost form or judge PDF has been re-uploaded after the repairs.

## Source-approval withdrawal and submission-media refresh

The next audit reproduced a pending request surviving withdrawal of the source-review checkbox. Withdrawal now aborts the browser request, invalidates late or already displayed drafts and retains the source text. The regression was observed failing before the repair and passing afterward, including in the deployed Azure app with an intercepted response (zero real provider calls).

The resulting milestone has **46 server, 9 layout, 5 corpus-policy and 30 browser checks**; an independently built public-source copy passed its 14 policy/layout and 30 browser checks. Public application commit `7927989` carries this repair. The app ZIP SHA-256 is `716314F4F25E4800AF7388E4365E77F3D013E6CEA8652138F376F877F13628CC` and the scoped-source ZIP SHA-256 is `0EB20D57C95463D783A6AA8BC84D34602B2FB8EF31D531633C3CAB7C60DE18A8`.

The September 30 submission-media refresh updates the English copy and a separate two-page judge PDF to this milestone. The video remains the authentic 118.5-second recording; later cancellation/approval and OCR/gate repairs are described as post-recording changes, not claimed as footage. Public form save/upload status is recorded separately after UI verification. None of these changes establish medical/native-language quality or current provider credit/entitlement.

UI verification after saving the refresh: Devpost retained the submitted state and displayed `Project submitted!`; its Additional info form displayed `Current File: medical-qc-nebius-judge-brief-refresh-20260930.pdf`. Both PDF pages were rendered and visually inspected before upload. The refreshed PDF SHA-256 is `225B560F4BA7A4CF87FF19DE572D77A81758E1A31F0FA58B99EFF9E4A3A0D8FF`. The earlier PDF is preserved locally. Fresh app verification again passed 46 server, 14 layout/policy and 30 browser checks; the server test was rerun serially after a concurrent .NET build-cache lock, not after a product failure.

## Precision audit: late image OCR approval

The next precision audit reproduced a distinct approval race using a synthetic image and the actual local OCR worker. A reviewer could check the approval box while image OCR was pending and the excerpt was empty; the subsequent automatic OCR insertion inherited that approval and enabled translation without review of the inserted text. The new browser regression was observed failing before the repair. Automatic OCR insertion into an empty excerpt now clears source approval and any draft. Existing nonempty reviewer-entered text is still preserved.

The repaired suite passes **46/46 server, 9/9 layout, 5/5 corpus-policy and 31/31 browser checks**. The same delayed-worker reproduction on Azure confirms nonempty OCR text with approval cleared and translation disabled. Both local and hosted diagnostics observe zero browser errors, external requests and POSTs; no billable provider calls were made.

A fresh 22-input corpus replay passes runtime/privacy/review/fragment-identity gates with no unexpected annotated degradation. Searchable-page scores remain 52/54 selected anchors and 25/26 selected order edges; mixed-PDF anchors remain 8/9. Six input cases still have explicitly documented content limitations. These engineering gates do not establish complete extraction, reconstructed translated layout, native-language quality or clinical accuracy. The two-page judge brief has been re-rendered and visually inspected with the 31-check count and OCR approval boundary. Final public-code and submission-save status is recorded after verification, not inferred from a local file change.

The independent public-source copy also passes 9 layout, 5 policy and 31 browser checks with this repair. The final English Devpost story was saved and reloaded on the public project page with the 31/31 count and OCR-approval repair; the Additional info form retained the refreshed PDF filename and finalization displayed `Project submitted!`. The revised PDF SHA-256 is `FA39E318D98813BD134B6D0D1078CA35190917BE551E7CF9BA3EFD0E9D1602D6`. The previous 30-check PDF remains available locally.

The generated 31-check release snapshot has app ZIP SHA-256 `4B6648D4FBC1D6699870CE43305F1530484F2FBA9B8D4C9FC6FFAFDDD3FEEDED` and scoped-source ZIP SHA-256 `E60C021786245BCE30E5078127A0342063FF4EFB251734A39D7878C83310F6E5`. This final save-verification paragraph is a later evidence-only documentation change; it does not change that generated archive snapshot or the runtime code.
