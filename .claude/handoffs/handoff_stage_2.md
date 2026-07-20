# Handoff — Stage 2 (Scaffold) → Stage 3 (Implementation)

**Attempt 2:** Scaffold verified and defect fixed. Generator base: `@wealthfolio/addon-dev-tools` with manual restructuring to exact handoff spec. All module files typed, AGPL-3.0-only headers applied.

## Defect fixed (attempt 1 → attempt 2)

`vite.config.ts` had a `build.watch` block that put `npm run build` into permanent watch mode. **Fix:** Removed the watch block (lines 45–49 in attempt 1). Watch mode now only runs via `npm run dev`, which has explicit `--watch` flag. `npm run build` now exits cleanly with code 0.

## Verification (attempt 2)

```
$ npm run build
vite v7.3.6 building for production...
✓ 1 modules transformed.
dist/addon.js  0.95 kB │ gzip: 0.48 kB
✓ built in 64ms
EXIT CODE: 0

$ npm test -- --run
Test Files  5 passed (5)
Tests  16 passed (16)
EXIT CODE: 0
```

## Artifact inventory

### Build configuration (all present and wired)

**Files:**
- `package.json` v0.1.0, strict TypeScript, Vitest `npm test` integrated, peerDependencies externalized for runtime
- `vite.config.ts` with externalized host deps (react, react-dom, @wealthfolio/*, date-fns, lucide-react, recharts, @tanstack/react-query) — **no build.watch block**
- `vitest.config.ts` globals enabled, node environment
- `tsconfig.json` strict: true, includes src + tests, types: ["node", "react", "react-dom", "vitest/globals"]
- `manifest.json` exact spec from Stage 1 handoff

**Manifest exact shape (copy if you need to patch it):**
```json
{
  "id": "wealthfolio-ynab-sync",
  "version": "0.1.0",
  "sdkVersion": "3.6.1",
  "minWealthfolioVersion": "3.6.1",
  "permissions": {
    "accounts": ["getAll"],
    "activities": ["getAll", "search", "create", "update"],
    "network": ["request"],
    "secrets": ["set", "get", "delete"]
  },
  "network": {
    "allowedHosts": ["api.ynab.com"]
  }
}
```

### Source tree (complete, typed, stubbed)

```
src/
  addon.tsx                    # Main entry point; ctx.router.add() + QueryClientProvider
  errors.ts                    # Custom error types: YNABSyncError, InvalidTokenError, NetworkError, RateLimitError
  ynab/
    types.ts                   # Budget, Account, Transaction, Payee, Category, Subtransaction interfaces
    client.ts                  # YNABClient class with getBudget(), getBudgets(), validateToken(); uses ctx.api.network
    milliunits.ts              # Utility: milliunitsToCurrency(), currencyToMilliunits()
  sync/
    engine.ts                  # SyncEngine class stub; sync(): Promise<SyncResult>
    mapping.ts                 # mapActivityType(), mapAmount(); WealthfolioActivityType enum
    reconcile.ts               # Reconciler class; isAlreadySynced(), recordMapping()
  state/
    schema.ts                  # SyncStateSchema, AccountMappingSchema, UserConfigSchema; key helpers
    store.ts                   # StateStore class; getBudgetState(), setBudgetState(), getUserConfig(), setUserConfig()
  secrets/
    token.ts                   # YNAB PAT management: hasYNABToken(), getYNABToken(), setYNABToken(), deleteYNABToken()
  ui/
    SyncPage.tsx               # Main UI component (stub, placeholder)
    useSync.ts                 # Custom hook stub; isSyncing, error, lastSyncTime, syncedCount
    components/                # Directory for future subcomponents
```

All src files carry SPDX-License-Identifier + copyright header (AGPL-3.0-only, Jordan Dunn / NodeTwo 2026).

### Tests (all pass, 16 tests)

```
tests/
  fixtures/budget.json         # Fake YNAB API budget response for mocking
  client.test.ts               # YNABClient instantiation
  engine.test.ts               # SyncEngine.sync() returns proper SyncResult shape
  mapping.test.ts              # mapActivityType() type mapping; mapAmount() conversions (6 tests)
  reconcile.test.ts            # Reconciler sync detection, mapping recording (4 tests)
  state.test.ts                # StateStore get/set (missing state returns null)
```

Run: `npm test -- --run` (exit 0, 16 passed).

### Build & type-check

- `npm run build` → vite bundles src/addon.tsx → dist/addon.js (~948 bytes minified)
- `npm run type-check` → tsc --noEmit (exits 0, strict mode pass)
- `npm run dev` → vite build --watch (watch mode, exits on Ctrl+C)
- Build externalizes all hostDependencies; addon is ~1KB

### SDK type boundaries (CRITICAL for Stage 3)

**AddonContext shape (from handoff):**
```ts
{
  api: {
    network: { request(url, options?) => Promise<Response> },
    storage: { get(key) => Promise<string?>, set(key, value) => Promise<void>, remove(key) => Promise<void> },
    secrets: { set(name, value) => Promise<void>, get(name) => Promise<string?>, delete(name) => Promise<void>, exists(name) => Promise<boolean> },
    query: { getClient() => QueryClient }
  },
  router: { add(id, component, path) => void },
  sidebar: { ... },
  onDisable(callback) => void
}
```

**No `ctx.secrets` or `ctx.storage` directly** — all via `ctx.api.*`.

**Network:**
- Use `ctx.api.network.request(url, { headers: { Authorization: 'Bearer ...' } })`
- YNAB token must come from `ctx.api.secrets.get(YNAB_TOKEN_SECRET_NAME)` inline (never stored, never logged)
- Only host: `api.ynab.com` (manifest enforced)

**Storage:**
- Keys: `[A-Za-z0-9_.:-]{1,128}`
- Values: strings, ≤250 KB total
- Schema defined in `src/state/schema.ts`; StateStore serializes to/from JSON

**Secrets:**
- Use `ctx.api.secrets` only (not addon state)
- Never render token in UI; only check existence with `exists()`
- Pattern: call `getYNABToken()` in request flow, use once, drop

### Vitest quirks & config

- **Config:** vitest.config.ts sets `globals: true, environment: 'node'`
- **Types:** tsconfig includes "vitest/globals" so `describe`, `it`, `expect` are available without imports
- **Mock pattern:** fixtures/budget.json is a bare JSON file; tests load async in test code (not yet wired — Stage 3 should load it for mocking network responses)

### Important type boundaries to enforce (Stage 3)

1. **No `any` at module boundaries:** All exports must be fully typed; internal helper functions can be typed or inferred
2. **YNAB API types live in `src/ynab/types.ts`** — do not repeat type definitions; re-export if needed in sync logic
3. **Activity creation:** Use `ActivityInput` from @wealthfolio/addon-sdk; map YNAB transaction → ActivityInput in mapping.ts
4. **Amount sign convention:** YNAB milliunits are signed (inflow > 0, outflow < 0); Wealthfolio activities use activityType + absolute amount. Isolate conversion in `sync/mapping.ts`
5. **Error flow:** All YNAB API errors should throw YNABSyncError subclass (InvalidTokenError, RateLimitError, etc.)

### Commands that work

```bash
npm install                  # Installs all devDeps + peerDeps
npm run build               # Vite bundle → dist/addon.js (exits 0)
npm test -- --run           # Vitest CI mode (exits 0)
npm run dev:server          # Wealthfolio dev server (requires VITE_ENABLE_ADDON_DEV_MODE=true)
npm run type-check          # tsc strict mode pass
npm run dev                 # vite build --watch
```

### Gotchas for Stage 3

1. **Router path is auto-derived by host from manifest addon id**, but you must supply it in `ctx.router.add()` call as `/addons/{addonId}`. Currently hardcoded in addon.tsx; keep it in sync with manifest.id.

2. **Query client:** `ctx.api.query.getClient()` returns a QueryClient; wrap routes in `<QueryClientProvider client={...}>` to enable @tanstack/react-query. Already done in addon.tsx skeleton.

3. **Storage key scoping:** No built-in per-budget or per-user isolation. Schema keys must encode scope (e.g., `budget:{id}:state`). See `getBudgetStateKey()` pattern in state/schema.ts.

4. **Secrets are not ephemeral per session** — stored for lifetime of addon installation. `getYNABToken()` retrieves the stored value; if you change it, call `setYNABToken()` to persist.

5. **Sidebar icons:** Only curated Phosphor icon names (e.g., `arrows-clockwise`, `squares-four`). Icon must be declared in manifest.json `contributes.links.sidebar[].icon`.

6. **No background jobs:** Sync is user-triggered (manual button). Auto-sync-on-open is a stretch goal toggle with no separate permission — just a UI flag stored in user config.

7. **Idempotency test:** There is a test contract in SPEC §7 that running sync twice produces no duplicate activities. This is enforced via `externalId` = YNAB txn id + cursor advancement only on full batch success. Implement early; test_idempotent_sync must pass.

## Bundler externalizations (vite.config.ts)

Host-provided, not bundled:
```
@tanstack/react-query, @wealthfolio/addon-sdk (+ subpaths), @wealthfolio/ui (+ subpaths),
date-fns, lucide-react, react, react-dom, react-dom/client, react/jsx-*, recharts
```

Do NOT import these from node_modules in the bundle. They are provided at runtime by the host.

## Evidence for stage completion

- `npm run build` → dist/addon.js exists (948 bytes), exits 0, does not hang
- `npm test -- --run` → 16 tests pass, 5 test files, exit 0
- `npm run type-check` → tsc --noEmit exits 0 (strict mode)
- All src files carry AGPL headers
- manifest.json permissions match handoff exactly
- File tree matches layout exactly
- No `any` at module boundaries
- TypeScript strict mode enabled
- vite.config.ts does NOT have build.watch block
