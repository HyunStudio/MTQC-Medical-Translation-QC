# Open medical corpus: provenance and reproducibility

The 2026-09-30 pilot uses twelve distinct publisher-PDF pages, three anatomy charts, paired excerpts and raster variants. It is a convenience corpus, not a medical-quality benchmark. Full originals, generated PDFs and extracted texts remain in ignored local QA storage.

| ID | Source / selected PDF pages | License / inclusion decision | Original PDF SHA-256 |
| --- | --- | --- | --- |
| spine | Liu et al. (2024), [Frontiers in Medicine, 1403423](https://www.frontiersin.org/journals/medicine/articles/10.3389/fmed.2024.1403423/full); 2, 3, 6, 9 | Publisher CC BY 4.0. Selected schematics/captions checked for separate credits; no exclusion found. | `e9f212ff2eb714af40610ddd2279e8b31da101be0a735df69b1c34ccf11b8cc8` |
| ear | Xue et al. (2024), [Frontiers in Bioengineering and Biotechnology, 1439499](https://www.frontiersin.org/journals/bioengineering-and-biotechnology/articles/10.3389/fbioe.2024.1439499/full); 2, 3, 8, 9 | Publisher CC BY 4.0. Selected anatomy schematic and table captions have no separate permission restriction found. | `cd13e278a6cdad2942f5ba7e9c1bbe0cd432b930e66980ba5f9570e23e17dda1` |
| vascular | Jansen et al. (2020), [PLOS ONE, e0242596](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0242596); 2, 3, 5, 8 | Article CC BY. Public visual use restricted to author Fig. 1 schematic and text; cadaver photographs are not redistributed. | `78cf228f11d2d293b04a9a1f9ca08b6b7cdfbdaef4b9ce5bc8cf6bdca617445e` |
| servier | [Servier Medical Art educational tools](https://smart.servier.com/educational-tools/): Visual System, Blood Circulation Pathway, Venous System | CC BY 4.0; chart footer credit retained. Translations/adaptations must be identified separately. | Per-image hashes stored with local case inventory. |

Article-level licensing does not override third-party exclusions. Recheck individual credit lines when selecting other figures. [PLOS policy](https://journals.plos.org/plosone/s/content-license), [Servier citation instructions](https://smart.servier.com/how-to-cite-servier-medical-art/), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

The public workbench screenshot in `assets/corpus-spine-review-20260930.png` reproduces part of Liu et al. PDF page 3 / Figure 1 under CC BY 4.0. The browser review controls, numbered text overlay and displayed extraction warning are MTQC additions. It is not a translation or publisher endorsement. No source article or screenshot was sent to a model in this evaluation.

## Reproduce locally

1. Install Python with PyMuPDF and Pillow. Obtain the original publisher PDFs and permitted chart PNGs yourself; name them as listed in `src/web_demo_browser_tests/corpus.sources.json`. Compare the hashes above before preparing the corpus.
2. Build the client dependencies and browser-test dependencies as described in the README. Use Chrome and .NET 10.
3. Run `python src/web_demo_browser_tests/prepare_corpus.py --source-root <local-download-folder> --output qa/corpus`.
4. Run `node src/web_demo_browser_tests/corpus.mjs qa/corpus final`. Per-input text, screenshots, geometry, privacy/review checks, scores and summary are written locally.

Input accounting: 12 single-page PDFs + 3 two-page pairs + 2 raster PNG pages + 1 degraded JPEG page + 1 mixed searchable/scanned PDF + 3 charts = 22 inputs. Pair/raster runs are not additional independent source pages. Selection fits the two-page product limit; the tool still translates only an approved excerpt of at most 3,000 code points.

Ground-truth corrections: the ear page-8 anchor is `KerMA`, not `PEGDA`; vascular page 5 contains `Pre-procedural unenhanced computed tomography` and `68%`, not `93.3%`. Ear page-3 diagram was not scored against invented English ear-part labels. Both baseline and revised extraction are scored against the corrected labels. These annotation corrections are not counted as software improvements.

The later [complex medical image pilot](COMPLEX_MEDICAL_IMAGE_PILOT_20260930.md) adds a two-column neuroanatomy paper with a Johns Hopkins Biomedical Engineering coauthor, its multi-panel figures, an OpenStax cranial-nerve illustration and a public-domain Gray plate. Its eight input variants and license decisions are recorded separately; they are not part of the 22-input baseline accounting above.
