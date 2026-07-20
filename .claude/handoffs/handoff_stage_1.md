# Handoff — Stage 1 (Spec) → Stage 2 (Scaffold)

Full detail in `docs/SPEC.md`. This is the compressed build contract. Target:
Wealthfolio addon, **web edition**, SDK **3.6.1+ sandboxed iframe** runtime.

## Runtime facts that change the scaffold (3.6 sandbox)
- `secrets`, `storage`, `network` live under **`ctx.api.*`** (NOT `ctx.secrets`).
  AddonContext = `{ api, sidebar, router, onDisable }`.
- No arbitrary `fetch` / no `localStorage`. Outbound HTTP only via
  `ctx.api.network.request()` to manifest-declared hosts; persistence only via
  `ctx.api.storage` (string values, ≤250 KB, key `[A-Za-z0-9_.:-]` ≤128).
- React NOT re-exported by SDK; import from `react`/`react-dom` and
  **externalize** host deps in the bundler (react, react-dom, `@wealthfolio/*`,
  date-fns, lucide-react, recharts, `@tanstack/react-query`).
- Routes: `ctx.router.add({ id, component })`; do not call `createRoot`.
  Sidebar icons = curated Phosphor names; nav via `route` (no onClick).
- `activityType` enum includes DEPOSIT, WITHDRAWAL, TRANSFER_IN, TRANSFER_OUT
  (no INCOME). `externalId` + `metadata` fields exist on activities.

## Decisions (condensed)
1. **Scope:** one-way YNAB→WF cash import. Out: write-back to YNAB, investment
   BUY/SELL, YNAB categories/budgets/scheduled txns.
2. **Mapping:** user maps YNAB acct→WF acct in UI; unmapped ignored; persisted
   in storage per budget.
3. **Type map:** inflow→DEPOSIT, outflow→WITHDRAWAL; transfer w/ both accounts
   mapped→TRANSFER_OUT+TRANSFER_IN pair; transfer w/ unmapped counterpart→
   DEPOSIT/WITHDRAWAL; split→parent total only (subtxns ignored); zero-amount
   skipped. Default eligibility `approved && cleared!="uncleared"`, toggles
   `includeUnapproved`/`includeUncleared` (default false). Amount=milliunits÷1000,
   currency=YNAB budget ISO (mismatch warns, no FX).
4. **Idempotency:** `externalId`=YNAB txn id on every activity. Known set =
   persisted id-map ∪ live `externalId` scan of mapped accounts. Cursor
   (`last_knowledge_of_server`) advances **only** after full batch success.
   Edit→`update`; delete→**orphan-flag** (comment + `metadata.ynabDeleted`,
   listed in warnings, never auto-deleted → also keeps `activities.delete` out
   of the manifest).
5. **Secrets/network:** PAT via `ctx.api.secrets` only (existence-only reads,
   never logged/rendered/stored); all HTTP via broker to `api.ynab.com` (only
   allowlisted host); Bearer injected by broker from the named secret.
6. **UI:** one sidebar item + one route: status+token entry, budget selector,
   mapping table, "Sync now", last-sync summary, error log. Stretch auto-sync =
   run on page mount behind `autoSyncOnOpen` toggle (default off, no extra
   permission). No scheduler.
7. **Failures:** 401→"invalid token"; 429→"retry after N" no auto-loop;
   network→"cannot reach api.ynab.com"; partial batch→list succeeded/failed,
   cursor not advanced. Cursor never advances on any failure.

## Module layout to scaffold (empty-but-typed)
```
manifest.json, package.json, tsconfig.json, vite.config.ts, vitest.config.ts,
.gitignore, LICENSE, CHANGELOG.md, README.md, docs/
src/addon.tsx
src/ynab/{client.ts, types.ts, milliunits.ts}
src/sync/{engine.ts, mapping.ts, reconcile.ts}
src/state/{store.ts, schema.ts}
src/secrets/token.ts
src/errors.ts
src/ui/{SyncPage.tsx, useSync.ts, components/}
tests/{fixtures/, mapping.test.ts, engine.test.ts, reconcile.test.ts,
       client.test.ts, state.test.ts}
```

## Manifest permission set (minimal — put in manifest.json)
- `accounts`: `[getAll]`
- `activities`: `[getAll, search, create, update]`  (NOT delete/import)
- `network`: `[request]` + `network.allowedHosts: ["api.ynab.com"]`
- `secrets`: `[set, get, delete]`
- Baseline (no entry): storage, ui, query, toast, logger.
- Manifest also: `id: wealthfolio-ynab-sync`, `version: 0.1.0`,
  `sdkVersion: "3.6.1"`, `minWealthfolioVersion: "3.6.1"`, `main: dist/addon.js`,
  `contributes.routes:[{id:"wealthfolio-ynab-sync"}]` + one sidebar link
  (icon e.g. `arrows-clockwise`).

## To confirm during scaffold/impl (safe defaults exist — don't block)
- Exact `ctx.api.network.request()` signature + exact manifest allowlist key.
- `ActivityInput` cash-amount shape (`amount`+`currency` vs quantity×unitPrice)
  and sign convention — isolate in `sync/mapping.ts`.
- Whether official generator exists (`npm create wealthfolio-addon` or
  `@wealthfolio/addon-dev-tools` CLI) — prefer it over hand-rolling.
- Storage per-value ceiling (treat 250 KB as hard limit).

## Acceptance criteria (Stage 2 must not break these; full list in SPEC §7)
- `npm run build` produces the addon bundle; `npm test -- --run` passes with a
  placeholder test; TS strict, no `any` at boundaries.
- manifest.json contains exactly the permission set above; sdk/min versions ≥3.6.1.
- File tree matches layout; each src file typed (may be stub) and carries the
  AGPL-3.0 short-notice header.
