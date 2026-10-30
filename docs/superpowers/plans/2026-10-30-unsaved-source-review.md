# Unsaved source review implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this bounded fix. No delegation is required.

**Goal:** Prevent an unsaved source transcription/type/box from retaining excerpt consent or enabling translation of the previous saved source.

**Architecture:** Compare the current main region editor with the saved active region before returning a verified excerpt. Input clears consent and refreshes admission without aborting an in-flight paid request. Saving still invalidates region verification; explicit source review is required again.

**Tech stack:** Existing browser ES modules, Node test runner and actual application UI through CUA. Work in the dedicated public-source clone on fix/unsaved-source-review-20261030; original private projects remain untouched.

**Spec / observed failure:** QA `output/qa/mtqc-three-paper-20261030/unsaved-edit-original-failure.json`: verified actual paper heading, consent true, then changed transcription without Save; old preview/consent and enabled Translate persisted. No provider call was sent in the reproduction. The scope is main source text/type/box edits; do not infer a complete specialized-editor audit.

## Constraints and checks

- Keep saved source geometry, literal values, validation policies, budgets and existing failure history unchanged.
- Do not use the permanent diagnostic dirty latch as excerpt authority: it intentionally has a different lifetime.
- Preserve unsaved editor text; do not rerender it away just to disable a button.
- Equivalent browser newline normalization and the existing full-precision main box serialization are accepted; changing text/type/box must hold. Returning to exact saved values does not silently restore consent.
- Input alone must not abort or restart an in-flight provider request.

## Tasks

- [x] Write targeted tests for missing/current/changed text, type, box and newline normalization; observe the original failure before implementation.
- [x] Add the main-editor comparison to excerpt admission and verification; on draft input clear consent through a separate callback without cancelling inference.
- [ ] Run focused regressions, syntax checks and client build. Reproduce the actual corrected UI path with source Save/Verify, unsaved edit, revert and Save/Verify transitions, and verify zero upstream calls.
- [ ] Finish new-paper intake, original-page visual comparisons, malformed input checks, table inspection, local figure OCR and at most three approved excerpt model calls.
- [ ] Review the diff and necessary release/deployment consequence; preserve r6 archive and all original failures. Report exact scopes and remaining limitations.

## Actual deployment follow-up

The first published 7abbba5 served exact new files/DLLs but a new browser tab retained old behavior. `source-editor-hosted-ui-green.json` was misnamed: its actual result is FAILED and remains preserved. Code responses lacked explicit cache revalidation; ZIP local-time entries also produced future Last-Modified headers. Do not claim a sole browser-internal cause.

- [ ] Preserve failing HTTP cache/header checks and two entry/dependency URL regression tests.
- [ ] Version both changed code URLs, require code/HTML/CSS revalidation, and write the separate deployment ZIP with UTC timestamps. Existing unversioned cached entries are not assumed to disappear automatically; verify a fresh release URL and a normal reload of the old tab.
- [ ] Review and separately deploy this confirmed correction, then verify actual hosted source-admission behavior before any model requests. Do not rerun the original paid or frozen paper parents to hunt for a pass.
