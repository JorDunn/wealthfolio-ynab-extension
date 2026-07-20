# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-20

### Added
- One-way sync of transactions from a single YNAB budget into user-mapped
  Wealthfolio cash accounts (`DEPOSIT` / `WITHDRAWAL` / `TRANSFER_IN` /
  `TRANSFER_OUT`), driven by YNAB delta requests (`last_knowledge_of_server`)
  and manually triggered from the addon UI.
- Idempotent sync engine: every synced activity carries the YNAB transaction
  id as `externalId`; sync state (server-knowledge cursor + txn-id to
  activity-id map) advances only after a batch fully applies, so re-running
  sync never creates duplicates.
- YNAB API v1 client (`src/ynab/`) with milliunits-to-decimal conversion and
  an error taxonomy for invalid token, rate limit, and network failures.
- Pure, table-tested mapping layer (`src/sync/mapping.ts`) covering inflow,
  outflow, mapped/unmapped transfers, split parents, and zero-amount skip
  rules.
- Reconciliation (`src/sync/reconcile.ts`) that unions the persisted
  id-map with a live `externalId` scan so partial failures never duplicate
  on retry.
- Persistent sync state and account-mapping storage backed by
  `ctx.api.storage` (`src/state/`).
- YNAB personal access token storage via `ctx.api.secrets` only
  (`src/secrets/token.ts`); existence-only checks, never logged or rendered.
- Addon UI (`src/ui/`): connection status, budget selector, account mapping
  table, sync settings, "Sync now" controls with last-sync summary, and an
  error log.
- Addon manifest with the minimal permission set required
  (`accounts.getAll`; `activities.getAll/search/create/update`;
  `network.request` scoped to `api.ynab.com`; `secrets.set/get/delete`).
- Test suite (Vitest) covering the YNAB client, mapping, sync engine,
  reconciliation, state store, secrets handling, and UI components.
- Build pipeline (Vite) and strict TypeScript configuration; addon
  packaging script producing a distributable zip.
