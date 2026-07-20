# Handoff — Stage 4 (Implement UI) → Stage 5 (review)

UI is implemented and wired to the Stage 3 core exactly per
`.claude/handoffs/handoff_stage_3.md`'s wiring snippets. 82 Vitest tests pass
(68 core + 14 new UI smoke tests), `npm run build` and `npm run type-check`
both exit 0. This is a reference for the reviewer — not a narrative.

---

## 1. What was added / changed

**New:**
- `src/ui/components/ConnectionStatusCard.tsx` — token entry (write-only) +
  connection badge + remove-token action.
- `src/ui/components/BudgetSelector.tsx` — live YNAB budget dropdown.
- `src/ui/components/AccountMappingTable.tsx` — YNAB account rows, each with
  a Wealthfolio-account dropdown (`UNMAPPED_VALUE` sentinel for "Not
  synced").
- `src/ui/components/SyncSettings.tsx` — `includeUnapproved` /
  `includeUncleared` toggles.
- `src/ui/components/SyncControls.tsx` — "Sync now" button + last-sync
  summary badges (created/updated/skipped/orphaned).
- `src/ui/components/ErrorLog.tsx` — current-summary error/warnings +
  persisted `lastSyncError` fallback.
- `tests/ui/testUtils.ts` — shared mock `AddonContext` builder (in-memory
  storage/secrets/network/accounts/activities; network responses routed by
  YNAB API v1 path).
- `tests/ui/useSync.test.tsx` (9 tests), `tests/ui/SyncPage.test.tsx` (5
  tests).
- `tests/setup-dom.ts` — global Vitest setup; guarded so it's a no-op under
  the core suite's `environment: 'node'` and only polyfills a few
  Radix-touched browser APIs (`hasPointerCapture`, `scrollIntoView`,
  `ResizeObserver`) for UI test files that opt into jsdom.

**Rewritten (were Stage 2 stubs):**
- `src/ui/useSync.ts` — now the full UI↔engine bridge (see §2).
- `src/ui/SyncPage.tsx` — thin layout assembling the components above,
  driven entirely by `useSync`.
- `src/addon.tsx` — route component now renders the real `SyncPage` instead
  of the Stage 2 placeholder card; comment updated to record the
  routes/links mechanism finding (§3.1).

**Config:**
- `vitest.config.ts` — added `setupFiles: ['./tests/setup-dom.ts']`.
- `package.json` — added devDependencies: `jsdom@29.1.1`,
  `@testing-library/react@16.3.2`, `@testing-library/user-event@14.6.1`,
  `@testing-library/jest-dom@6.9.1`. Dev-only; no runtime/licensing impact
  (CLAUDE.md's dependency rule concerns runtime deps).
- Deleted `src/ui/components/.keep` (directory now has real content).

**Not touched:** `src/ynab/`, `src/sync/`, `src/state/`, `src/secrets/`,
`src/errors.ts` — no core changes, no bugs found in core during this stage.

---

## 2. How the UI invokes the engine

`useSync(ctx: AddonContext)` owns all state; `SyncPage` and every
`src/ui/components/*` file are display-only (props in, callbacks out — no
`ctx` access, no persistence calls of their own).

- **Mount:** `hasYNABToken()` → if absent, `connectionStatus = 'no-token'`.
  If present, calls `client.getBudgets()` as the live validation call
  (spec §3.6 item 1 — "connected" is existence *and* a working token, not
  just existence). `InvalidTokenError` → `'invalid-token'`; any other error
  → stays `'connected'` but surfaces `connectionError` (e.g. transient
  network blip distinguishable from a bad token). Then loads
  `UserConfigSchema` and, if `activeBudgetId` is set, loads that budget's
  YNAB accounts, Wealthfolio accounts, and persisted mapping/settings/error.
- **Token actions:** `saveToken`/`removeToken` call
  `setYNABToken`/`deleteYNABToken` (`src/secrets/token.ts`) directly —
  `useSync` never calls `getYNABToken()`, matching the handoff's advice to
  avoid the plaintext-returning path unless there's a concrete need.
- **Budget/account-mapping/settings persistence:** exclusively through
  `StateStore` (`stateStore.getBudgetState`/`setBudgetState`,
  `getUserConfig`/`setUserConfig`) — read-modify-write, never
  `ctx.api.storage` directly from the UI (verified: `grep -rn
  "ctx.api.storage" src` shows exactly one hit, the
  `new StateStore(ctx.api.storage)` construction itself; every other hit is
  a comment).
- **`triggerSync()`** — constructs one `YNABClient` + one `SyncEngine` per
  click (per the handoff's "construct fresh per sync click (cheap)"),
  fetches `budgetCurrency` via `getBudgetSettings` and
  `wealthfolioAccountCurrencies` via `ctx.api.accounts.getAll()`, calls
  `engine.sync()`, and:
  - on success: reads back the just-written `BudgetStateSchema` for the new
    `lastSyncTimestamp` and clears `persistedError`.
  - on failure: the engine **never** touches `BudgetStateSchema` (state-
    advance invariant), so `useSync` does its own read-modify-write of just
    the `lastSyncError` field, leaving `syncState`/`accountMappings`
    untouched — this is what makes the error log "survive reload" (spec
    §3.6 item 6) despite the engine's schema only holding a single
    `lastSyncError: string | null`, not a list (see §4.3 below).
  - `errorKind === 'invalid_token'` additionally flips `connectionStatus`
    back to `'invalid-token'` so the token-entry UI reappears without a
    page reload.

`ctx.api.activities` is passed to `SyncEngine` unchanged (structurally
satisfies `EngineActivitiesAPI`'s `getAll`/`create`/`update` subset — see
§4.2 for why this type-checks against the real `ActivitiesAPI`/
`ActivityDetails` shapes).

---

## 3. Deviations / findings (read before reviewing)

### 3.1 Sidebar/route mechanism — confirms the existing scaffold, no imperative `ctx.sidebar.addItem()` needed

Verified against `node_modules/@wealthfolio/addon-sdk/dist/src/manifest.d.ts`
and `types.d.ts`. The real mechanism is:
- `manifest.json`'s `contributes.routes[]` declares a durable route id
  ("host-renderable before the addon boots").
- `manifest.json`'s `contributes.links.sidebar[]` places a sidebar entry
  pointing at that route id (`AddonContributedLink.route`).
- The addon's `enable()` calls `ctx.router.add({ id, path, component })` at
  runtime to register the actual React component for that same route id
  (`id` **must** equal the manifest's `contributes.routes[].id`).

There is a separate imperative `ctx.sidebar.addItem()` /
`SidebarManager.addItem()` API (`types.d.ts`), but it's for sidebar entries
*not* backed by a durable manifest route — not needed here since this addon
already declares its one route+link in the manifest. **The Stage 2/3
scaffold's approach (manifest `contributes.routes`/`contributes.links` +
`ctx.router.add`) was already correct**; Stage 4 kept it and only swapped
the mounted component from the placeholder to the real `SyncPage`, plus
added an explanatory comment in `addon.tsx` recording this finding so a
future reader doesn't re-litigate it.

### 3.2 `ctx.api.activities` (real `ActivitiesAPI`) satisfies `EngineActivitiesAPI` structurally, but only by TS method-bivariance

`EngineActivitiesAPI.create/update` take `ActivityWriteInput`
(engine.ts) and the real `ActivitiesAPI.create/update` take
`ActivityCreate`/`ActivityUpdate` (data-types.d.ts) — these are field-
compatible (checked by hand: `accountId`, `activityType`, `activityDate`,
`amount`, `currency`, `comment`, `metadata` all line up). `getAll` returns
`ActivityDetails[]`, which lacks an `activityDate` field (has `date: Date`
instead) but that field is optional on `ActivityRecord`
(`src/sync/reconcile.ts`), so TS's structural check doesn't require it to
be present at all. This all type-checks and passes `npm run type-check`,
but the interface match relies on TS's method-syntax bivariant parameter
checking (a known looser check than function-property strict-mode
checking) — flagging so a reviewer knows this wasn't accidentally
`as unknown as X`-cast away; it's genuinely structurally compatible, just
via the looser of TS's two checking modes for object methods.

### 3.3 "Error log" is effectively "last sync error" (single, persisted) + in-session `SyncSummary`, not a persisted history list

`BudgetStateSchema.lastSyncError` (Stage 3's schema, unchanged) is a single
`string | null`, not an array. Spec §3.6 item 6 asks for "the engine's
typed errors ... persisted so it survives reload." What's actually
persisted and reload-safe is the *most recent* error message; the richer
`SyncSummary` (all errors/warnings/errorKind/retryAfterSeconds) only lives
in React state for the current session and is lost on reload/re-navigation.
This is a **gap relative to spec's literal "log" wording**, not a Stage 4
bug — the schema that would need to change to support a true history is
Stage 3's `BudgetStateSchema`, which this stage was told not to modify
without flagging. If a persisted multi-entry log is wanted, the fix point
is `SyncStateSchema`/`BudgetStateSchema` in `src/state/schema.ts` (add e.g.
`errorHistory: string[]` capped at N entries) plus a small change in
`useSync.triggerSync`'s failure branch to append instead of overwrite.
Flagging per CLAUDE.md rather than silently picking an interpretation.

### 3.4 `autoSyncOnOpen` toggle omitted from v1 UI

Per spec §3.6's stretch section ("v1 ships the toggle UI stubbed/off or
omits it"), the toggle is omitted entirely rather than shown disabled.
`UserConfigSchema.autoSyncOnOpen` still round-trips through `StateStore`
(read on mount, defaults `false`) but nothing in the UI sets it to `true`
yet — wiring it later is a one-line addition (call `triggerSync()` in a
mount effect gated on the flag), per the handoff's note that the engine
needs no change for this.

### 3.5 `onDisable` cannot cancel an in-flight sync

There's no cancellation token threaded through `ctx.api.network.request`
or `SyncEngine.sync()`, so `ctx.onDisable` (in `addon.tsx`) only clears the
captured `ctx` reference, same as the Stage 2/3 scaffold did. An in-flight
`triggerSync()` promise chain still runs to completion; its `setState`
calls target an unmounted component (React discards them silently in
React 19, no warning), and nothing writes to storage/secrets/activities
after the point the callback fires that wasn't already committed before it.
Documented as a known limitation rather than a defect — the spec's own
wording ("cancels any in-flight sync") slightly overstates what's
achievable without engine-level cancellation support, which is out of this
stage's scope to add (would touch `src/sync/engine.ts`).

### 3.6 Defensive fix in `useSync.ts` (UI-layer, not core): optional-chain `budgetSettings` itself

`triggerSync()` reads `budgetSettings?.currency_format?.iso_code` (note the
first `?.`). Caught by a test that mocked a malformed settings response —
without chaining on `budgetSettings` itself (not just `.currency_format`),
a host returning an unexpected/empty settings body would throw a raw
`TypeError` instead of surfacing through the normal error path. This is in
UI code I own (`src/ui/useSync.ts`), not a core-module change.

---

## 4. Manual-QA notes for a live host (not exercised here — only against installed `.d.ts` + mocked `ctx`)

- **Radix `Select` in the real Wealthfolio shell** — `@wealthfolio/ui`'s
  `Select`/`SelectContent` uses a Radix `Portal`; this was smoke-tested
  under jsdom only by asserting rendered trigger/placeholder text and
  option counts, **not** by opening the dropdown and clicking an option
  (Radix's popover positioning/portal behavior in jsdom is brittle even
  with polyfills, and the risk/reward of chasing that didn't seem worth it
  for "smoke-level"). Confirm in a real dev server
  (`npm run dev:server`) that both `BudgetSelector` and
  `AccountMappingTable`'s dropdowns actually open and select correctly.
- **`metadata` round-trip on a live host** — still the single biggest open
  risk carried over from Stage 3's handoff §7: if a live
  `ctx.api.activities.create()` silently drops/truncates `metadata`, the
  live-scan dedup breaks silently and this stage's UI would report false
  "Created" counts on every sync. Worth a real smoke sync against a live
  dev server before shipping, exactly as Stage 3 flagged.
- **`Account.currency` as the source for `wealthfolioAccountCurrencies`** —
  used in `triggerSync()` exactly as Stage 3's wiring snippet suggested;
  not exercised against a live host (mocked in tests).
- **Token entry UX** — `ConnectionStatusCard`'s input is `type="password"`
  and is cleared immediately after a successful save; never pre-filled from
  `getYNABToken()`. Worth a manual check that no browser extension/password
  manager surfaces the value in a way that defeats the intent (out of this
  addon's control either way).

---

## 5. Test inventory (82 tests total, 8 files, all green)

Unchanged from Stage 3: `tests/client.test.ts` (15), `tests/mapping.test.ts`
(20), `tests/reconcile.test.ts` (10), `tests/engine.test.ts` (12),
`tests/state.test.ts` (7), `tests/token.test.ts` (4).

New this stage:
- `tests/ui/useSync.test.tsx` (9) — no-token / connected / invalid-token
  connection states; `saveToken` writes to `ctx.api.secrets` by key only
  (never the raw value asserted elsewhere); `removeToken` deletes the
  secret and resets state; `selectBudget` persists `activeBudgetId` via
  `StateStore` (asserted against the raw persisted JSON, not just hook
  state) and loads YNAB/Wealthfolio accounts; `setAccountMapping` persists
  through `StateStore`; **`triggerSync` run twice on the same fixtures
  creates the activity only once** (mirrors the core's mandatory
  idempotency test, but end-to-end through the hook's engine
  construction); `triggerSync` surfaces `invalid_token` and flips
  `connectionStatus` without any `activities.create` call.
- `tests/ui/SyncPage.test.tsx` (5) — renders no-token state (asserts the
  budget selector is absent, i.e. gated correctly); typing + saving a
  token calls `ctx.api.secrets.set` and flips the badge to "Connected",
  with the input cleared afterward; removing the token calls
  `ctx.api.secrets.delete` and returns to "No token saved"; a preloaded
  budget/mapping renders the mapping table and **clicking "Sync now" twice
  creates the activity only once** (`Created 1` then `Created 0`,
  cross-checked against the mock's activity store); an invalid-token
  failure mid-sync surfaces the exact spec-suggested copy ("Invalid token —
  re-enter your YNAB personal access token.") and never calls
  `activities.create`.

`tests/ui/testUtils.ts` is the shared mock-`ctx` builder both files use —
no real network, no real host; `ctx.api.network.request` is answered from
in-memory fixtures keyed by YNAB API v1 path.

---

## 6. Verification

```
$ npm test -- --run
 Test Files  8 passed (8)
      Tests  82 passed (82)
$ echo $?
0

$ npm run type-check
(no output)
$ echo $?
0

$ npm run build
dist/addon.js  29.78 kB │ gzip: 8.24 kB
✓ built in ~120ms
$ echo $?
0
```

`grep -rn "\bany\b" src` — one hit, in an English-language code comment in
`src/addon.tsx` ("...any in-flight promise chain still resolves..."), not a
type annotation. `grep -rn "ctx.api.storage" src` — one real hit (the
`StateStore` construction), rest are comments. No `logger.*` calls exist in
`src/` at all (nothing to grep for token leakage in). Every touched/new
`src/` file carries the AGPL-3.0-only header.
