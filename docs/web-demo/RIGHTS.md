# Demo source, rights, and provenance

The new web-demo application code is released under Apache License 2.0 (see `src/web_demo/LICENSE`, copied to the public repository root). This grant does **not** relicense the preexisting private Windows document engine, manuscripts, the Servier/Müller specimens, or their third-party components. Those assets retain the separate terms below and in `THIRD_PARTY_NOTICES.md`.

This inventory covers the two recorded cases in `src/web_demo/fixtures`. Public specimen artifacts are enumerated and integrity-checked by `src/web_demo/fixtures/assets.sha256`. A manifest hash proves byte identity within this release, not correctness or permission by itself. User-selected documents are not shipped with the app.

## Servier Medical Art — Visual System

- **Creator/source:** Servier Medical Art (SMART), Les Laboratoires Servier, [Educational Tools: Visual System](https://smart.servier.com/educational-tools/).
- **License:** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/). SMART permits reuse and adaptation with attribution; the source PowerPoint retains its embedded Servier/SMART attribution in the translated outputs.
- **Released alterations:** An English-source preview (`servier-visual-en.png`); 18 translated, editable PowerPoint slides (`servier-visual-<language>.pptx`) and their rendered preview PNGs. The 14 visible strings of the one-chart specimen were translated; anatomical art and shape geometry were retained, with font-size fitting for long labels. The released charts are derivatives, not originals endorsed by Servier.
- **Generation/QC status:** The saved batch records a `gpt-6-sol` Codex CLI translation run, package/geometry checks, and native PowerPoint visual review. These are scoped layout and coverage checks. All 18 translations are `AI_DRAFT_UNREVIEWED`: no independent clinician or native-speaker terminology validation is recorded.
- **Language accounting:** English source plus 18 target languages = 19 displayed languages. One selected target is shown at a time; this is not 19 translations per source.

## Müller et al. — arterial–venous network Figure 1

- **Creators/source:** Müller LO, Watanabe SM, Toro EF, Feijóo RA, Blanco PJ (2023), “An anatomically detailed arterial-venous network model. Cerebral and coronary circulation,” *Frontiers in Physiology* 14:1162391, [doi:10.3389/fphys.2023.1162391](https://doi.org/10.3389/fphys.2023.1162391).
- **License:** [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/), as stated by the publisher article. The article citation and link are displayed in the demo.
- **Released alterations:** Publisher PDF page 4 rendered as `source-page04.png`; a separate three-page comparison draft PDF (`Mueller_Figure1_Translation_Comparison_DRAFT.pdf`) and Korean, Spanish, Arabic preview PNGs. Only the Figure 1 title, caption, and four labels are translated. The article body remains English; the demo never claims a full article translation.
- **Generation/QC status:** Assistant-generated translation draft; this specimen has **no recorded successful Codex CLI model run**. Its saved visual inspection reports no clipping or overlap on the three comparison pages, but no independent medical/linguistic review. All three targets remain `AI_DRAFT_UNREVIEWED`.

## Use restrictions for this demo

The expanded medical-document intake evaluation has a separate [corpus provenance record](CORPUS_SOURCES.md). It links three CC-licensed publisher papers and three Servier charts; originals and local test excerpts are not bundled. The public Liu et al. Figure 1 workbench screenshot is credited there with its source, license and overlay modifications. This evaluation is not a full-paper translation or a medical validation.

The submission walkthrough also uses `docs/web-demo/assets/original-circulation-demo.svg`, an original abstract vessel teaching diagram created for this software demo. It is not a patient image, a clinical reference, or a copied medical illustration. The recording script renders it to a local PNG for the browser OCR demonstration; the PNG is not part of the recorded Servier/Müller specimen set.

No Harrison textbook page, patient material, private manuscript, or private API credential is included. The optional Nebius/NVIDIA feature can send either a bounded, user-reviewed excerpt from a locally selected PDF/image or the fixed Müller caption when the server operator explicitly enables it. The browser extracts source files locally; it does not upload the file. The user must confirm the right to use any selected source and must not submit protected health information without a suitable privacy/legal basis. Attribution, license links, modification disclosures, and draft-review labels must remain visible in any redistributed copy or submission video.
