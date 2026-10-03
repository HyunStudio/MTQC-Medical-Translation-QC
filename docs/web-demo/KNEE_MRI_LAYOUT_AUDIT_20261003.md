# Knee MRI document-layout audit — 2026-10-03

This is an extraction and reviewer-workflow test, **not** a medical-translation quality assessment or a claim to reconstruct a full article. No Nebius model call was made for this audit.

## Source and permitted use

Xiang et al., “Multi-class segmentation of knee MRI based on hybrid attention,” *Frontiers in Medicine* (2025), DOI [10.3389/fmed.2025.1581487](https://doi.org/10.3389/fmed.2025.1581487). The [publisher page](https://www.frontiersin.org/journals/medicine/articles/10.3389/fmed.2025.1581487/full) labels the article CC BY 4.0. The downloaded PDF SHA-256 is `C86EC6BD3FA6C00B130F794915A36E53B0249930154441BF30BFD907C1B557C2`. Its 13-page, 10.6 MB source exceeds the app's 10 MiB input limit, so testing used separate one- or two-page excerpts within the product's documented limits. Neither the complete article nor the excerpts are bundled with the public app/source export.

The four test inputs use physical PDF pages 3, 4, 8, and 8–9. They cover a multi-panel MRI illustration, a network architecture diagram and equations, a chart plus full-width numeric table above two-column prose, and another multi-panel MRI figure. Figure text inside rasters is not guaranteed to be part of the selectable text layer.

## Defect and correction

The pre-change geometric orderer applied one page-wide two-column gutter. On physical page 8, it separated a table row: `DeepLabv3+ 0.8423 0.7632 0.8666` appeared near the top, while `0.8394 39.63 0.65` appeared later after unrelated prose. The words were retained, but the row association was wrong. Existing anchor-only checks did not detect this failure.

The correction isolates a narrowly recognized `TABLE n` band with multiple wide numeric rows. It reads that band across each row, then resumes the normal column order for the rest of the page. After the change, the extracted line is `DeepLabv3+ 0.8423 0.7632 0.8666 0.8394 39.63 0.65`. A synthetic unit regression checks row association and fragment retention; a browser regression checks the actual PDF preview, review gate, and visible warning. This is a **row-alignment proposal**, not a table-cell semantic parser. The reviewer must check every value, heading, and unit against the original page before approving the excerpt.

## Bounded results

The four new PDF inputs produced no extraction exceptions, unexpected missing anchors, unexpected order failures, lost fragment identities, external browser requests, posted model requests, or review-gate bypasses in either the baseline or corrected run. Those counts alone would have missed the table error; the new row-association assertion distinguishes the correction. After the change, the existing 22-case document corpus also had zero unexpected anchor/order failures and zero fragment-identity losses. Previously documented OCR misses in that corpus remain; they were not counted as new passes. The browser suite contains 34 passing checks, including the new numeric-table preview case.

These checks are limited to two-page-or-less excerpts with tested text layers and synthetic regressions. They do not establish accuracy for arbitrary tables, rotated labels, raster-only figure legends, unseen article layouts, or clinical terminology. The original page remains visible next to editable extracted text; applying a reading-order proposal revokes source approval, and translation requires an explicit new review.
