# Explicit reservation loss acceptance implementation plan

> **For agentic workers:** Use superpowers:executing-plans. Implement and verify locally; activation requires separate informed owner authorization.

**Goal:** Permit an operator to accept one completed failed request's full reserved budget as permanently spent, without claiming a provider billing receipt.

**Architecture:** Extend the existing durable ledger and offline CLI. The failure state, actual billed amount, usage, price snapshot, prior holds, attempts and all limits remain intact. A separately recorded acceptance can suppress that entry's admission block only in the existing operator reservation policy. Other unknown/failed requests still block. No HTTP administration route, automatic acceptance, retry, top-up, or new queue.

**Tech stack:** Existing C#/.NET console test harness and JSON ledger.

**Design / alternatives:** The current monthly account statement cannot settle the individual failed MRI request. Waiting for an actual receipt remains the default. Inventing a zero/estimated billed charge is rejected. The proposed alternative is explicit full-reservation loss acceptance for one finished failure: exact call ID and full amount, owner evidence ID and nonfuture timestamp after completion. It is not a finding of actual charge or a general waiver. This design is the implementer's proposal; current owner approval of unknown-cost blocking has not been replaced.

## Constraints and review focus

- Never change actual billed cost or label an unknown charge reconciled solely because loss was accepted.
- Full reservation stays committed even if a later genuine billing receipt is smaller.
- Reject wrong IDs/amounts, success/active/orphaned/legacy entries, conflicting acknowledgments, and malformed/future metadata. Retain run ownership locking during import.
- Preserve default and legacy admission blocks, daily/cumulative/per-run limits, all previous entries and prior USD0.015 hold.
- Import upgrades only accepted ledgers to version3. Existing v2 tools must reject these ledgers before admission or reconciliation, rather than drop the metadata. Ordinary unaccepted ledgers stay version2.
- This candidate must not touch the production ledger, deploy, or send a model request before specific activation authorization.

## Task 1 — Ledger and offline command

- [x] Add failing tests for exact acceptance, default blocking, immutable full commitment, bad inputs, live ownership, corrupted metadata and offline CLI.
- [x] Run the new tests and retain RED.
- [x] Add optional loss acceptance record, strict validation, local operator method and CLI command. Do not modify web routes.
- [x] Run new tests, all related money tests and clean Release build; retain outputs.
- [x] Independent source review and resolve important findings.
- [x] Prepare exact one-call proposal and record candidate status. No activation without informed owner authorization.

## Accounting boundary

Full loss acceptance cannot be undone by the existing reconciliation importer. If the provider later supplies an actual billing receipt, retain it separately as evidence; the permanently consumed application budget is not restored. Schema3 is a deliberate fail-closed compatibility boundary, so deployment rollback to an older binary also pauses access rather than exposing a mutable reservation.
