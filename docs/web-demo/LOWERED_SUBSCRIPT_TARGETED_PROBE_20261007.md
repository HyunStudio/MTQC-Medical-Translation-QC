# Lowered-numeric-fragment targeted risk probe (protocol frozen 2026-10-07 01:29 UTC)

This is a **targeted failure probe**, not an independent held-out corpus, random sample, accuracy benchmark, clinical translation evaluation, or generalization estimate. The earlier 18 pages (six published-MRI development pages and twelve prior medical pages; 2,476 PDF.js fragments) were scanned separately and had zero broad/strong lowered-adjacent-fragment candidates. Do not rescore or rename those pages. The local candidate is at `c7c30b1d8b34ff5df6324a8815d3f4f3fa470d4d` plus five pre-existing uncommitted project files, whose SHA-256 digests are in the preceding turn's freeze record. Do not push or deploy this probe.

## Prespecified acquisition and exclusions

The exact prior-turn web-search query was `site:pmc.ncbi.nlm.nih.gov/articles radiotherapy D95 V20Gy open access CC BY 2024 2025`. The first five article hits were captured in that result order on 2026-10-07 before inspecting the PDF bodies. Search rank is not stable over time; the frozen PMCID order below, not a later search rerun, defines this probe. Attempt **all five** in order. Accept only an accessible final-publisher PDF in PMC's OA distribution with article-level **CC BY** (not CC BY-NC, CC BY-ND, or unclear) confirmed by Europe PMC core metadata and publisher/JATS license. Do not replace an excluded or unavailable candidate with a later result. Keep exclusions and download failures in the attempted denominator.

| Rank | PMCID | DOI | Metadata OA/license | Prespecified action |
|---:|---|---|---|---|
| 1 | PMC7522917 | 10.1016/j.meddos.2018.04.006 | N / none | Exclude: no confirmed reusable PDF license |
| 2 | PMC9670516 | 10.1186/s13014-022-02140-0 | Y / CC BY | Acquire final PDF |
| 3 | PMC9116532 | 10.3389/fcvm.2022.849247 | Y / CC BY | Acquire final PDF |
| 4 | PMC7734651 | 10.1016/j.radonc.2019.05.022 | N / none | Exclude: no confirmed reusable PDF license |
| 5 | PMC6360784 | 10.1186/s12885-019-5307-z | Y / CC BY | Acquire final PDF |

Metadata authority: `https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=PMCID&format=json&resultType=core`, with `PMCID` replaced by the literal value. PDF authority: PMC OA distribution at `https://pmc-oa-opendata.s3.amazonaws.com/{PMCID}.1/{PMCID}.1.pdf`; retrieve the corresponding `.xml` to cross-check license and publication identity. If the `.1` object is unavailable or not the final-publisher PDF, record exclusion; do not silently substitute a manuscript or different edition. Capture retrieval UTC time, byte size, SHA-256, full article title, actual PDF page count, license evidence, and exact URL **before opening rendered or extracted content**. Store original PDFs only in ignored local `output/research/lowered-subscript-targeted-20261007/`.

## Frozen page and truth rules (before PDF output observation)

For each eligible PDF, render physical pages 2 through `min(10, page_count)` in order at >=150 dpi. A human visually selects the **first** page with a visibly lowered numeric notation in a medical/scientific term or dosimetric symbol, including but not limited to `D₉₅`, `V₂₀Gy`, `T₂`, `CO₂`, `H₂O`; do not skip an earlier qualifying page for a clearer later one. If none is found in that fixed window, select physical page 2 as a negative-control page (or page 1 only if the PDF has one page). Never inspect PDF.js or MTQC extraction/order output until the visual truth for the selected page is frozen.

For every visibly lowered numeric notation on the selected page (not just the search examples), transcribe the exact visible term, physical page, approximate region/line, whether the base and lowered numeral belong on the **same visual line**, any adjacent following token, and whether the notation appears in ordinary selectable text, table, raster figure, or artwork. Mark ambiguous rendering as ambiguous rather than guessing. Also record at least one visibly raised superscript and one genuine next-line transition if present; these are negative controls for any later geometry change. Confirm source figure/caption licenses individually before reproducing an image outside the ignored local probe. Freeze this truth list in this document **before** reading PDF.js fragments or MTQC output.

## Extraction and classification after truth freeze

Read the selected page with the same PDF.js build and scale 1.25 as the existing MTQC test harness. Preserve every raw item string and rounded `x,y,width,height`, plus index and transform. Compute both: (1) plain PDF.js `getTextContent().items` array order and (2) current local MTQC `recoverReadingOrder` automatic proposal, with exactly the same fragments. Judge both against every frozen visual-truth item. A true candidate requires two adjacent horizontally touching/near fragments where the second is physically lower and visibly part of the first term; record all such candidates, including correct and failed ones. Do not equate a regex hit in extracted text with a real subscript. Classify each scorable case as both correct, raw-only correct (MTQC regression), MTQC-only correct, or both wrong (shared PDF source/extraction problem). Nonselectable raster labels, unclear truth, missing PDF, and exclusions stay in the denominator with explicit reason, not silently dropped.

Only if a **real selected-page term** has demonstrable meaning/line corruption attributable to the local reading-order algorithm may implementation proceed: add a failing regression using the original PDF.js fragments, activate the existing skipped synthetic `D`/`95%` test, make only a narrow row-grouping correction, then verify superscripts, genuine following lines, single-row and multirow tables, two-column reading order, all 22 existing corpus inputs, and the full relevant suites. If no real case is observed, leave the synthetic test skipped and code unchanged; report the remaining risk honestly. No paid Nebius call, public push, CI trigger, Azure deployment, Devpost change, or LinkedIn edit.

## Locked acquisition manifest (completed before opening PDF page content, 2026-10-07 01:32 UTC)

Five attempted search hits, two excluded on metadata license, three CC BY PDFs acquired from the PMC OA final-layout PDF objects. Europe PMC core metadata reports `isOpenAccess=Y; license=cc by` for all three; each corresponding PMC JATS XML has `license_ref=https://creativecommons.org/licenses/by/4.0/`. The PDF metadata lists journal-production tools (Adobe InDesign/Springer, LaTeX/dvips Frontiers, Arbortext/Acrobat BMC) and page counts; whether any PDF body is an author manuscript remains a visual source check, not silently assumed from metadata alone. No extracted body text, PDF.js array, or MTQC proposal has yet been inspected.

| PMCID; complete title | Exact PMC OA PDF URL | Retrieved UTC | Bytes | PDF pages | SHA-256 |
|---|---|---|---:|---:|---|
| PMC9670516; *Dummy run quality assurance study in the Korean Radiation Oncology Group 19 − 09 multi-institutional prospective cohort study of breast cancer* | https://pmc-oa-opendata.s3.amazonaws.com/PMC9670516.1/PMC9670516.1.pdf | 2026-10-07 01:31:05 | 2,110,518 | 10 | `9118A8B1243CE276744CCBF46032499CF320E69B11AC9040DD70325F54DA41A5` |
| PMC9116532; *Case Report: Treatment Planning Study to Demonstrate Feasibility of Transthoracic Ultrasound Guidance to Facilitate Ventricular Tachycardia Ablation With Protons* | https://pmc-oa-opendata.s3.amazonaws.com/PMC9116532.1/PMC9116532.1.pdf | 2026-10-07 01:31:07 | 463,323 | 5 | `4BEBF981D4387C6389F0FC37F52CEB83E609FBD2CA4145280F46B3C0F0B06767` |
| PMC6360784; *Study protocol: a multi-centre randomised study of induction chemotherapy followed by capecitabine ± nelfinavir with high- or standard-dose radiotherapy for locally advanced pancreatic cancer (SCALOP-2)* | https://pmc-oa-opendata.s3.amazonaws.com/PMC6360784.1/PMC6360784.1.pdf | 2026-10-07 01:31:08 | 779,325 | 9 | `3125689D89FDD214C76D7E1A3766CDDCF8FD32384DDADF13DFE1F44F7D0C6D68` |

## Visual truth (frozen 2026-10-07 01:42 UTC, before PDF.js/MTQC output inspection)

Original page images were rendered from the hashed PDFs with Poppler at 160 dpi for physical pages 2-5 and 140 dpi for later pages. The prespecified visual search window was completed without skipping a page: PMC9670516 pages **2-10 (9)**, PMC9116532 pages **2-5 (4)**, and PMC6360784 pages **2-9 (8)**, **21 rendered physical pages total**. All are visibly publisher-formatted final articles with journal headers/footers and final page numbering. Although `D95%`, `D98%`, `V20Gy`, `V5Gy`, and other dose labels occur, their digits are printed on the **same baseline** as the leading letter; these are *not* lowered numeric typography. Neither the `_` in labels such as `CTV_4D` nor a raised exponent qualifies as a lowered numeric fragment. Thus **0/21 visually scanned pages** has a qualifying lowered numeric notation. The fixed no-target fallback selects physical **page 2 of each PDF**. No truth item in these three selected pages can be scored as a lowered-subscript repair.

| Selected page | Visual lowered-numeric truth items | Raised/other negative control visible on selected page | Genuine next-line / reading-order control |
|---|---:|---|---|
| PMC9670516 p.2 | 0 | `30.4 (kg/m²)` in right-column Methods has visibly raised `2`; `V5Gy` in left-column paragraph is baseline text, not a subscript. | Blue boxed conclusion/keywords precedes two-column body; left-column Background continues until its last line, then right-column Methods. |
| PMC9116532 p.2 | 0 | `45 cm³` in left-column Case Description has visibly raised `3`. | Left-column Introduction and Case Description, right-column Figure 1/caption and body are distinct blocks; true paragraph line breaks are not a lowered term. |
| PMC6360784 p.2 | 0 | `30 mg/m²` and `200–300 mg/m²` in right-column chemotherapy paragraph have visibly raised `2`. | Left-column Background precedes right-column continuation/other text; no numeral under its base at line boundary. |

The source page images remain ignored local QA assets only. This negative visual truth was written before opening any PDF.js fragments or MTQC ordering output for these three PDFs. The 21-page visual search is a denominator, not a positive accuracy estimate; the three selected no-target pages provide controls only.

## Probe result

Completed 2026-10-07 UTC using the local unpublished MTQC candidate. No paid model call or external application state change was made.

| Denominator / result | Count | Interpretation |
|---|---:|---|
| Frozen search hits attempted | 5 | Fixed first-five list above; no replacement after exclusion. |
| License excluded | 2 | PMC7522917 and PMC7734651: Europe PMC has no confirmed reusable OA/license. |
| Eligible CC BY publisher-layout PDFs acquired | 3 | PMC9670516, PMC9116532, PMC6360784; JATS CC BY 4.0 and final journal headers/page numbers visually checked. Original PDF hashes were rechecked unchanged after analysis. |
| Pages visually searched in fixed physical-page windows | 21 | 9 + 4 + 8; every page 2 through 10/5/9 was rendered and viewed. |
| Pages with visibly lowered numeric notation | 0 | Baseline `D95%`, `V20Gy`, etc. are not a geometric subscript. Raised `m²`/`cm³` and underscore labels are not lowered numerals either. |
| Prespecified selected fallback pages | 3 | Physical page 2 of each PDF; three negative controls, zero lower-subscript positive truth items. |
| PDF.js selectable fragments on all 21 pages | 3,759 | PMC9670516: 1,263; PMC9116532: 807; PMC6360784: 1,689. Current MTQC proposal retained 3,759/3,759 fragments. This measures retention only, not correctness. |
| Broad lowered-adjacency coordinate suggestions across all 21 pages | 1 | **False positive**, a real next reference line, detailed below; strict height-reduced suggestions 0. Selected-page suggestions 0/3. |
| Actual same-line lowered-fragment cases available to score | 0 | Raw-versus-MTQC subscript correctness is **N/A**, not 100% or a generalization claim. |

The broad coordinate scan considered a preceding fragment ending in a letter (up to 24 characters), a following fragment beginning with 1-3 digits, a horizontal gap of `[-3,10]` viewport pixels, lower top displacement `[0.5,12]` pixels, and following/base height ratio `<=1.1` at PDF.js scale 1.25. The only suggestion is **PMC9116532 physical page 4**, reference 4: PDF.js raw item 193 `(STAR)—a`, `x=577.7, y=747.3, w=40.8, h=9.3`, and raw item 202 `10.3390/jcm1006`, `x=624.0, y=759.1, h=9.3` (`gap=5.4`, `dy=11.8`, height ratio `1.00`). The rendered article visibly places these on different reference lines; item 194 `comprehensive` completes the first line, while the DOI belongs to the later line beginning `review. J Clin Med.`. Raw PDF.js stream and MTQC both retain the items in that proper line sequence. It is **not** a lowered subscript or MTQC regression. It remains in the one-suggestion denominator as a false positive.

The three selected-page visual controls were compared to original raw PDF.js item order and the MTQC line proposal:

| Page and frozen control | Raw PDF.js adjacent items (selected indices) | Current MTQC line output | Judgment |
|---|---|---|---|
| PMC9670516 p.2, raised `30.4 (kg/m²)` | 139 `30.4 (kg/m`, 140 `2` at `y=601.5` versus base `602.8`, 141 `), and…` | `30.4 (kg/m2), and the medium-breast case had a height of` | Same line and content retained; typographic superscript formatting is flattened in plain text by both representations. `V5Gy` is a baseline fragment in both. |
| PMC9116532 p.2, raised `45 cm³` | 92 `…45 cm`, 93 `3` at `y=818.6` versus base `820.0`, 94 `and it was located on` | `…45 cm3 and it was located on` | Same line and content retained; not a lowered fragment. |
| PMC6360784 p.2, raised `30 mg/m²` and `200–300 mg/m²` | 175 `Chemotherapy (30 mg/m`, 176 `2` at `y=360.6` versus base `361.9`, 177 `cisplatin and 200`, 178 `–`, 179 `300 mg/m`, 180 `2` at `y=360.6` | `Chemotherapy (30 mg/m2 cisplatin and 200–300 mg/m2` | Same line and content retained; not a lowered fragment. |

These controls demonstrate that the current row grouping did not break the three raised-unit samples; they do **not** resolve the still-reproducible synthetic lower-subscript case. `node --test src/web_demo_browser_tests/layout.test.mjs` freshly returned **19 pass, 0 fail, 1 explicitly skipped**; the skipped `D` + lowered `95%` + `dose` regression was not promoted to green. `git diff --check` reported no whitespace errors (only existing LF/CRLF conversion warnings). No production/layout code was changed for this probe because a real lower-subscript meaning failure was not found. The local pre-existing five-file candidate remains uncommitted; only this protocol/result report was added.

**Boundary:** Search terms biased the sample toward radiotherapy notation, but these publishers print dose indices on the baseline. This targeted probe therefore supplies *negative evidence about occurrence in these fixed 21 pages*, not proof that arbitrary medical PDFs, true subscript typography, image labels, equations, two-column layouts, or clinical translations are safe. A future prespecified corpus containing verified visually lowered notation is needed before enabling the skipped test or changing the row-grouping heuristic.
