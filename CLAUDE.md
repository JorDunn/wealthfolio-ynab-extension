# wealthfolio-ynab-sync

Wealthfolio addon that syncs transactions from a YNAB budget into mapped
Wealthfolio cash accounts. Target deployment: self-hosted Wealthfolio Docker
(web edition), addon SDK 3.6+. TypeScript, `@wealthfolio/addon-sdk`,
`@wealthfolio/addon-dev-tools`, Vitest.

## Source of truth

- `docs/SPEC.md` is the authoritative design. If code and spec disagree,
  flag it — don't silently pick one.
- `PLAN.md` drives the build via the plan-orchestrator skill. Handoffs live
  in `.claude/handoffs/` and are committed.
- Wealthfolio addon API reference: https://wealthfolio.app/docs/addons/api-reference/
- YNAB API v1: https://api.ynab.com/ — amounts are milliunits (÷1000).
  Rate limit 200 requests/hour per token.

## Hard rules

- **Secrets**: the YNAB personal access token goes through the SDK secrets
  API only. Never in addon state storage, never in logs, never rendered in
  the UI (existence check only). Never hardcode tokens in tests — use
  fixtures with fake values.
- **Network**: outbound calls to `api.ynab.com` only, and it must stay the
  only host in the manifest network allowlist.
- **Idempotency**: every synced activity carries its YNAB transaction id.
  Sync state (`last_knowledge_of_server` + txn-id→activity-id map) advances
  only after a batch fully applies. Running sync twice must create nothing
  the second time — there is a test asserting this; keep it green.
- **Manifest permissions**: minimal set only. Adding a permission requires a
  spec update with rationale.
- **No background scheduling**: the addon lifecycle has no cron. Sync is
  user-triggered (plus the on-open toggle if the spec enables it).

## Code conventions

- TypeScript strict; no `any` at module boundaries.
- Core logic (`src/ynab/`, `src/sync/`, `src/state/`) is UI-free and fully
  unit-tested with mocked YNAB responses and a mocked `ctx.api`. UI
  components stay thin; logic that grows in a component gets pushed down
  into the core.
- Test-first for all core changes: failing test → implement → green →
  refactor. Table-driven tests for the mapping layer.
- YNAB fixtures live in `tests/fixtures/` as captured-shape JSON (fake ids,
  fake amounts).

## Commands

- `npm test -- --run` — full test suite (CI mode, no watch)
- `npm run build` — type-check + addon bundle
- `npm run dev:server` — addon dev server for a Wealthfolio instance running
  with `VITE_ENABLE_ADDON_DEV_MODE=true`

## Licensing

- AGPL-3.0-only, copyright Jordan Dunn / NodeTwo. `LICENSE` holds the
  verbatim AGPL-3.0 text; every `src/` file carries the short notice header.
- Dependency rule: runtime dependencies must be AGPL-compatible (MIT, BSD,
  Apache-2.0, ISC, LGPL, GPL are fine). Do not add a dependency with an
  incompatible or unclear license without flagging it.
- Do not accept vendored/copied third-party code without recording its
  origin and license in the file header.

## Versioning

Semver, starting 0.1.0. Keep a Changelog format in `CHANGELOG.md`. Version
bumps touch `manifest.json` and `package.json` together.
