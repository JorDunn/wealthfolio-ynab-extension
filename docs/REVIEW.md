<!--
SPDX-License-Identifier: AGPL-3.0-only
Copyright (C) 2026 Jordan Dunn / NodeTwo
-->

# wealthfolio-ynab-sync — Stage 5 Review

Reviewed against `docs/SPEC.md` (authoritative). Scope: `src/ynab/`, `src/sync/`,
`src/state/`, `src/secrets/`, `src/ui/`, `src/addon.tsx`, `manifest.json`,
`tests/`, plus the installed `@wealthfolio/addon-sdk@3.6.2` `.d.ts`/README as
ground truth for every claim the code or `.claude/handoffs/handoff_stage_4.md`
makes about the SDK's real shapes.

## Verdict: 1 BLOCKER found. Do not ship to Stage 6 packaging until it is fixed.

The blocker is narrow and mechanical (a manifest JSON shape correction), not a
core-logic defect — the sync engine, mapping, idempotency, and security
handling are all sound and well-tested. But it sits in the addon's security
disclosure surface (permissions), so it should be fixed and test-covered
before packaging, per the run's own rule ("Stage 6 may only fix blockers,
each fix test-covered").

---

## 1. Verification actually run (this session, not copied from handoff)

```
$ npm test -- --run
 Test Files  8 passed (8)
      Tests  82 passed (82)
EXIT CODE: 0

$ npm run type-check   # tsc --noEmit
(no output)
EXIT CODE: 0

$ npm run build        # vite build
dist/addon.js  29.78 kB │ gzip: 8.24 kB
✓ built in 253ms
EXIT CODE: 0
```

Test file breakdown (unchanged from Stage 4's claim, reproduced independently):
`tests/token.test.ts` (4), `tests/state.test.ts` (7), `tests/mapping.test.ts`
(20), `tests/reconcile.test.ts` (10), `tests/client.test.ts` (15),
`tests/engine.test.ts` (12), `tests/ui/useSync.test.tsx` (9),
`tests/ui/SyncPage.test.tsx` (5) = 82.

`grep -rn "\bany\b" src/` → exactly one hit, `src/addon.tsx:45`, inside an
English-language comment ("...drop its reference to `ctx` (any in-flight
promise chain..."), not a type annotation. No `logger.*` calls exist anywhere
in `src/`. `ctx.api.storage` is referenced directly exactly once
(`src/ui/useSync.ts:103`, the `new StateStore(ctx.api.storage)` construction);
every other hit is a comment.

---

## 2. Findings

### BLOCKER

**B1 — `manifest.json`'s `permissions` field has the wrong shape and drops all required justification text.**

- File: `manifest.json:19–33`.
- Current content:
  ```json
  "permissions": {
    "accounts": ["getAll"],
    "activities": ["getAll", "search", "create", "update"],
    "network": ["request"],
    "secrets": ["set", "get", "delete"]
  }
  ```
- Required shape, confirmed by **three independent sources that all agree**:
  1. The installed SDK's own type: `AddonManifest.permissions?: Permission[]`
     where `Permission = { category: string; functions: FunctionPermission[]; purpose: string }`
     (`node_modules/@wealthfolio/addon-sdk/dist/src/manifest.d.ts` +
     `dist/src/permissions.d.ts`) — an **array**, not an object keyed by
     category.
  2. The SDK's own shipped `README.md` shows the manifest author-time format
     twice (lines ~200 and ~585), both times as an array of
     `{ category, functions: string[], purpose: string }` objects, e.g.:
     ```json
     "permissions": [
       { "category": "activities", "functions": ["getAll"],
         "purpose": "Analyze transaction history for fee calculations" }
     ]
     ```
  3. `docs/SPEC.md` §6's own example (this project's own authoritative spec)
     already specifies exactly that array-of-objects-with-`purpose` shape —
     the current `manifest.json` deviates from the project's own spec, not
     just from the SDK.
  4. `node_modules/@wealthfolio/addon-dev-tools/templates/manifest.json.template`
     (the official scaffold generator's own template) defaults to
     `"permissions": []` — an empty array, confirming the array convention.
- **Why blocker, not major:** the addon's four declared permission categories/
  functions (`accounts.getAll`, `activities.getAll/search/create/update`,
  `network.request`, `secrets.set/get/delete`) are individually all valid,
  minimal, and correctly matched against
  `PERMISSION_CATEGORIES` (verified in
  `node_modules/@wealthfolio/addon-sdk/dist/chunk-KCG6RCFW.js`) — so the
  *content* is right. But the *shape* is wrong on the addon's security
  disclosure artifact: an object literal will not satisfy a
  `Permission[]`-typed field, and — independent of whatever the host's JSON
  parser does with the mismatch — the manifest **carries zero `purpose` text**
  for any of the four permissions it declares, even though `docs/SPEC.md` §6
  explicitly wrote a `purpose` string for each one. This is exactly the thing
  this review's "Security" dimension was asked to check ("every permission in
  `manifest.json` justified by the spec") and it fails literally: the
  justification text was written in the spec's prose but never landed in the
  artifact that a human/host consent screen would actually read.
- **Deviation origin:** not a Stage 4 regression — this shape was already
  present in `.claude/handoffs/handoff_stage_2.md`'s "exact manifest shape"
  snippet and has been carried unchanged (and unflagged) through Stages 2–4.
- **Fix location:** the spec is correct here; the code should change to match
  it, using `docs/SPEC.md` §6's own JSON block verbatim (it is already
  correctly shaped — array of `{category, functions, purpose}`).
- **Recommended test coverage for the fix:** add a lightweight compile-time
  check, e.g. a new `tests/manifest.test.ts` that does
  `import manifest from '../manifest.json'; import type { AddonManifest } from '@wealthfolio/addon-sdk';`
  and asserts `manifest.permissions` is an array with a `purpose` string on
  every entry (and/or a `const _typed: AddonManifest = manifest;` assignment
  inside a `.ts` file compiled by `tsc --noEmit`, which would fail today).
  This gives the "must be test-covered" fix a concrete, cheap mechanism.

### MAJOR

**M1 — `manifest.json` declares `sdkVersion`/`minWealthfolioVersion: "3.6.1"`, but the code was built and typechecked exclusively against the installed `3.6.2` SDK's shapes.**

- File: `manifest.json:8–9` (`"sdkVersion": "3.6.1"`, `"minWealthfolioVersion": "3.6.1"`).
- Every "Deviation note" comment left by Stage 3 (`src/ynab/client.ts:15–24`,
  `src/state/store.ts:11–16`, `src/secrets/token.ts:9–16`) explains that the
  Stage 1/2 assumptions about the **3.6.1-documented** API shapes were wrong,
  and that the actual, installed **3.6.2** SDK has different call shapes:
  `NetworkAPI.request(request: NetworkRequest): Promise<NetworkResponse>`
  (object in/out) instead of a fetch-shaped `request(url, init): Promise<Response>`;
  `StorageAPI`/`SecretsAPI` using `delete()` (not `remove()`) and returning
  `string | null` (not `string | undefined`); no `SecretsAPI.exists()`.
  `package.json`'s own `peerDependencies`/`devDependencies` pin
  `"@wealthfolio/addon-sdk": "^3.6.2"`, not `^3.6.1`.
- **Risk:** if a real host running the genuine 3.6.1 runtime has the *older*
  API shapes Stage 3 originally (and incorrectly) assumed 3.6.1 to have, every
  `ctx.api.network.request(...)`/`ctx.api.storage.*`/`ctx.api.secrets.*` call
  in this addon would break at runtime on that host — while
  `manifest.json` tells the host installer this addon is compatible with it.
  This review cannot fully confirm or refute this (no 3.6.1 package is
  installed locally to diff against 3.6.2), so it's graded **major** rather
  than blocker, with explicit hedging.
- **Recommendation:** bump `sdkVersion`/`minWealthfolioVersion` to `"3.6.2"`
  to match what the code actually requires and what `package.json` already
  declares as the peer floor, unless 3.6.1-runtime compatibility is
  positively confirmed against a real 3.6.1 host first.

**M2 — The `package` npm script omits `LICENSE` from the distributable zip.**

- File: `package.json`'s `"package"` script:
  `zip -r dist/$npm_package_name-$npm_package_version.zip manifest.json dist/ README.md -x '*.map'`.
- `LICENSE` (AGPL-3.0-only, present at repo root, verified) is not included in
  the zip contents list, nor is `CHANGELOG.md`. For an AGPL-3.0-only licensed
  addon this is a compliance gap in the distributable artifact. This is
  squarely Stage 6 (packaging) scope — flagging here so it isn't missed.

### MINOR

**m1 — `useSync.triggerSync`'s failure branch doesn't persist `lastSyncError` for a budget's first-ever failed sync.**

- File: `src/ui/useSync.ts:310–323`.
  ```ts
  const current = await stateStore.getBudgetState(activeBudgetId);
  if (current) {
    await stateStore.setBudgetState(activeBudgetId, { ...current, lastSyncError: message });
  }
  setPersistedError(message);
  ```
- If `triggerSync()` is called for a budget that has never had a successful
  sync yet (e.g., the user just mapped accounts and clicks "Sync now" for the
  first time, and it fails — invalid token, network down, etc.),
  `stateStore.getBudgetState(activeBudgetId)` returns `null`, so the `if
  (current)` guard skips the persistence write entirely. The error only lives
  in React state (`setPersistedError`) and is lost on reload/re-navigation.
  This compounds the gap Stage 4's handoff §3.3 already flagged (the error
  log is a single string, not a history) with a narrower edge case where even
  that single string doesn't survive a reload for a first-ever failure — a
  literal miss against spec §3.6 item 6 ("persisted so it survives reload").
- Fix would be a one-line change: fall back to `emptyBudgetState()` (already
  defined in this file, used elsewhere) instead of skipping the write when
  `current` is `null`.

**m2 — `CHANGELOG.md` is stale relative to the actual Stage 3/4 work.**

- File: `CHANGELOG.md`. Its only entry, `## [0.1.0] - 2026-07-20`, describes
  "Initial scaffolding: core sync engine, YNAB client, state management, and
  UI foundation" — worded as if everything is still a stub, not reflecting
  that the sync engine, mapping, reconciliation, and full UI are now
  complete and tested. Stage 6 should update this before any release/tag.

**m3 — `docs/INSTALL.md` is missing.**

- `docs/SPEC.md` §5's module layout lists `docs/{SPEC.md, INSTALL.md,
  REVIEW.md}`. Only `SPEC.md` exists under `docs/` (this review adds
  `REVIEW.md`). Not a Stage 5 deliverable, but Stage 6 (packaging/docs) needs
  to create `INSTALL.md`.

### Resolved / downgraded from the Stage 4 handoff (no action needed)

**Handoff §3.2's "TS method-bivariance" concern, checked by hand — it's not actually load-bearing.**
I verified `EngineActivitiesAPI` (`src/sync/engine.ts:65–68`, extending
`ActivitiesLookupAPI` from `src/sync/reconcile.ts:50–52`) against the real
`ActivitiesAPI` (`node_modules/@wealthfolio/addon-sdk/dist/src/host-api.d.ts:82–140`)
field-by-field:
- `create`/`update`'s parameter direction (contravariant): `ActivityWriteInput`
  (engine.ts) is assignable to `ActivityCreate`/`ActivityUpdate`
  (data-types.d.ts) under **ordinary strict structural checking** — every
  field `ActivityWriteInput` declares matches the corresponding field on
  `ActivityCreate`/`ActivityUpdate` exactly, and every field
  `ActivityCreate`/`ActivityUpdate` has that `ActivityWriteInput` omits
  (`subtype`, `sourceGroupId`, `asset`, `quantity`, `unitPrice`, `fee`, `tax`,
  `fxRate`) is optional there, so its absence in the narrower type is fine.
- `getAll`'s return direction (covariant): `ActivityDetails[]` (the real
  return type) satisfies `ActivityRecord[]` (`src/sync/reconcile.ts:38–47`)
  because every field `ActivityRecord` declares is either present-and-typed-
  compatibly on `ActivityDetails`, or optional there and simply absent
  (`ActivityRecord.activityDate` vs `ActivityDetails.date` — the former is
  optional, so its absence is not a problem).

Neither direction actually depends on TS's looser bivariant method-parameter
check — this is genuine, ordinary structural compatibility. The Stage 4
handoff's flag was a reasonable thing to raise for a reviewer to check, and I
checked it: it holds up. No action needed.

---

## 3. Acceptance checklist (docs/SPEC.md §7) — pass/fail with evidence

### Scope & mapping

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 1 | Only mapped YNAB accounts produce WF activities; unmapped ignored | PASS | `src/sync/mapping.ts:75-77` (skip `unmapped-account`); `tests/mapping.test.ts` "transaction on an unmapped YNAB account -> skip"; `tests/engine.test.ts` "never creates activities for transactions on an unmapped YNAB account" |
| 2 | Inflow → DEPOSIT, outflow → WITHDRAWAL (absolute amount) | PASS | `src/sync/mapping.ts:121-123`; `tests/mapping.test.ts` inflow/outflow cases |
| 3 | Transfer, both mapped → TRANSFER_OUT + TRANSFER_IN, own txn id each, no DEPOSIT/WITHDRAWAL, nets to zero | PASS | `src/sync/mapping.ts:92-94,117-119`; `tests/mapping.test.ts` transfer cases; `tests/engine.test.ts` fixture test (`txn-transfer-out`/`txn-transfer-in`) |
| 4 | Transfer, counterpart unmapped → DEPOSIT/WITHDRAWAL by sign | PASS | `src/sync/mapping.ts:89-94`; `tests/mapping.test.ts` + `tests/engine.test.ts` (`txn-transfer-unmapped-counterpart`) |
| 5 | Split parent → single activity for total; subtransactions ignored; limitation documented | PASS | `src/sync/mapping.ts:66-73,74` (only reads parent `amount`); `tests/mapping.test.ts` "split parent -> total only" |
| 6 | Default eligibility = approved && cleared≠uncleared; toggles change it; zero-amount skipped | PASS | `src/sync/mapping.ts:78-86`; `tests/mapping.test.ts` unapproved/uncleared/zero + toggle cases |
| 7 | Milliunits ÷1000 correct; currency = YNAB budget ISO; mismatch warns but records | PASS | `src/ynab/milliunits.ts`; `tests/mapping.test.ts` "milliunits convert precisely (123930 -> 123.93)", currency-mismatch cases; `tests/engine.test.ts` currency-mismatch describe |

### Idempotency & state

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 8 | Every created activity has `externalId`=YNAB txn id, `metadata.source="ynab"` | **PASS w/ documented deviation** | The installed SDK has **no `externalId` field anywhere** (verified: `grep -n externalId node_modules/@wealthfolio/addon-sdk/dist/src/data-types.d.ts` → no match). `ActivityCreate`/`ActivityUpdate` only accept `metadata` (not `sourceSystem`/`sourceRecordId`/`idempotencyKey`, which exist only on the read-only `Activity`/`ActivityDetails` models). The addon substitutes `metadata.ynabTransactionId` + `metadata.source: 'ynab'` (`src/sync/mapping.ts:126-183`), which is what actually round-trips through `create`/`update`/`getAll`. Documented in-code (mapping.ts:128-146) and tested (`tests/mapping.test.ts` `toActivityInput`, `tests/engine.test.ts` per-activity metadata loop). **Recommend `docs/SPEC.md` §3.4/§7 be updated to say `metadata.ynabTransactionId`, not `externalId`** — the spec's assumption about the SDK was wrong; the code correctly adapted. |
| 9 | Running sync twice creates zero new activities (named test) | PASS | `tests/engine.test.ts` — `'MANDATORY: running sync twice on the same fixtures creates zero new activities the second time (spec §7 idempotency)'`, read in full: fetcher ignores the cursor and re-returns the identical page both times (the strongest version), asserts `second.created === 0` and `activitiesApi.records.size` unchanged |
| 10 | Known set = persisted map ∪ live scan; partial failure + re-sync → no duplicates | PASS | `src/sync/reconcile.ts:85-124`; `tests/reconcile.test.ts` "live scan wins over stale persisted entry" + "discovers activities via live scan... (partial-failure recovery path)"; `tests/engine.test.ts` "partial batch failure" describe block (read in full — asserts a create failing on txn-b still lets a retry finish with `updated:1` for txn-a, not a duplicate create) |
| 11 | `last_knowledge_of_server` advances only after full-batch success | PASS | `src/sync/engine.ts:207-252` (state write happens strictly after the create/update/orphan loop's `try`, only if `batchError === undefined`); `tests/engine.test.ts` 401/429/network tests assert `getBudgetState()` stays `null`; partial-batch test explicitly asserts cursor not advanced then advances only on the successful retry |
| 12 | YNAB edit → mapped WF activity updated, not duplicated | PASS | `tests/engine.test.ts` "SyncEngine — YNAB edit" |
| 13 | YNAB delete → orphan-flagged (comment + `metadata.ynabDeleted`), warned, not deleted, never recreated | PASS | `src/sync/engine.ts:153-173,266-287`; `tests/engine.test.ts` "SyncEngine — YNAB delete" (both tests, including "does not re-flag... on a later sync") |

### Secrets & network

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 14 | Token only via `ctx.api.secrets`; never storage, never logged, never rendered | PASS | `src/secrets/token.ts` (existence-only `hasYNABToken`); `grep -rn logger src/` → no hits; `grep -rn "ctx.api.storage" src/` → one real hit (`StateStore` construction), no token path through it; `src/ui/components/ConnectionStatusCard.tsx` token input is write-only, `type="password"`, cleared post-save, never pre-filled from `getYNABToken()` |
| 15 | All YNAB traffic via `ctx.api.network.request` to `api.ynab.com`; manifest allowlist has exactly that host; Bearer injected by broker | PASS | `src/ynab/client.ts:35,150-165` (`auth: { type: 'bearer', secretKey }`, never a manual `Authorization` header); `manifest.json:35-39` (`"network": {"allowedHosts": ["api.ynab.com"]}`, exact match to `AddonNetworkAccess`); `tests/client.test.ts` "never an inline Authorization header" (asserts `sentRequest.headers?.Authorization` undefined and the serialized request never contains the string `"Bearer"`) |
| 16 | No token/header/body in any `logger` call (grep-checkable) | PASS | No `logger.*` calls exist anywhere in `src/` — nothing to leak through |

### Failure model

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 17 | 401 → "Invalid token", nothing written, manual re-entry | PASS | `tests/engine.test.ts` 401 case (`activitiesApi.records.size === 0`, state null); `src/ui/useSync.ts:156-157,320-322` flips `connectionStatus` to `'invalid-token'`; `src/ui/components/ErrorLog.tsx:22-23` copy |
| 18 | 429 → "retry after N", no auto-retry loop, cursor not advanced | PASS | `tests/engine.test.ts` 429 case (`retryAfterSeconds` surfaced, nothing written); `src/ui/components/ErrorLog.tsx:24-25`; no retry-loop code exists anywhere (grepped) |
| 19 | Network error → "Cannot reach api.ynab.com", cursor not advanced | PASS | `src/ynab/client.ts:31` default message; `tests/engine.test.ts` network case; `src/ui/components/ErrorLog.tsx:26-27` |
| 20 | Partial batch → summary lists succeeded/failed with reasons; retryable | PASS | `src/sync/engine.ts:227-241`; `tests/engine.test.ts` "partial batch failure" (asserts message text `/1 item\(s\) applied/`, then a full successful retry) |

### UI & build

| # | Item | Verdict | Evidence |
|---|---|---|---|
| 21 | One sidebar item + one route; `onDisable` cleans up | PASS | `manifest.json:11-27` (`contributes.routes`/`contributes.links.sidebar`, one entry each); `src/addon.tsx:36-52` (`ctx.router.add` matching route id, `ctx.onDisable`) |
| 22 | Page shows: connection status, budget selector, mapping table, sync now, last-sync summary, error log | PASS | `src/ui/SyncPage.tsx:48-91` composes `ConnectionStatusCard`, `BudgetSelector`, `AccountMappingTable`, `SyncSettings`, `SyncControls` (sync now + summary badges), `ErrorLog` |
| 23 | Manifest lists exactly §6 permissions; `sdkVersion`/`minWealthfolioVersion` ≥ 3.6.1; host deps externalized | **FAIL (shape) / see B1, M1** | Permission function *content* is correct and minimal (validated against the SDK's own `PERMISSION_CATEGORIES`), but the manifest's *shape* is wrong and drops all `purpose` text (B1); `sdkVersion`/`minWealthfolioVersion` literally reads "≥3.6.1" but was built/typechecked only against 3.6.2 (M1). Host deps externalized: PASS — `vite.config.ts`'s `rollupOptions.external` lists all `@wealthfolio/*`/`react`/etc., and the 29.78 kB build output confirms nothing host-provided got bundled |
| 24 | `npm test -- --run` and `npm run build` pass; TS strict, no `any` at module boundaries | PASS | Reproduced this session: test exit 0 (82/82), build exit 0, `type-check` exit 0; `grep -rn "\bany\b" src/` → one comment-only hit |

---

## 4. Security review dimension (detail beyond the checklist)

- **Token never logged:** no `logger.*` call sites exist in `src/` at all —
  confirmed by exhaustive grep, not just spot-checking.
- **Token never in addon state storage:** `StateStore` (`src/state/store.ts`)
  only ever serializes `BudgetStateSchema`/`UserConfigSchema`
  (`src/state/schema.ts`), neither of which has a token field; the token path
  (`src/secrets/token.ts`) is entirely separate and only touches
  `ctx.api.secrets`.
- **Token never rendered:** `ConnectionStatusCard`'s only token-bearing state
  is local component state (`tokenInput`), write-only, cleared immediately
  post-save, never initialized from a read. `useSync.ts` never calls
  `getYNABToken()` at all (only `hasYNABToken`/`setYNABToken`/
  `deleteYNABToken`) — confirmed by reading the full hook.
- **Network restricted to `api.ynab.com`:** the only base URL constant in the
  codebase is `YNAB_API_BASE_URL = 'https://api.ynab.com/v1'`
  (`src/ynab/client.ts:35`); `grep -rn "https://\|fetch(" src/` finds no other
  host reference anywhere. `manifest.json`'s `network.allowedHosts` has
  exactly that one host.
- **Manifest permissions minimal, content-correct, but malformed as an
  artifact** — see B1. Every function declared (`accounts.getAll`,
  `activities.getAll/search/create/update`, `network.request`,
  `secrets.set/get/delete`) is individually valid and matches the SDK's
  `PERMISSION_CATEGORIES` (confirmed: `activities.delete`/`saveMany`/`import`
  etc. are correctly *not* requested, matching the orphan-flag design's
  stated rationale in `docs/SPEC.md` §3.4).

## 5. Idempotency / state-advance dimension (detail beyond the checklist)

Traced the actual code path in `src/sync/engine.ts` (not just names/comments):
1. `sync()` reads `persistedState` first (line 116), never mutates it.
2. Fetch failure returns immediately via `failureSummary(err)` (line 128) —
   no write has happened yet at that point in the function.
3. `buildKnownSet` (line 132) is a pure read (`ActivitiesLookupAPI.getAll`
   only) — no writes.
4. The create/update/orphan loop (lines 207-225) is wrapped in one `try`;
   `batchError` is only set, never thrown further — meaning a failure at
   item N of the batch still lets items 1..N-1 have already been applied to
   the host (via `activitiesApi.create`/`update`, which are real writes) but
   the function does **not** call `stateStore.setBudgetState` in that branch
   (lines 227-242 return early). The `touched` map (built as a copy of
   `knownSet` and updated as each item applies, line 201/210/215/220) is
   discarded on this path — it's never persisted, so its role is confined to
   the current run's counts, not to what's actually retained as durable
   state.
5. `stateStore.setBudgetState` (line 244) is reached only when the loop
   completed with `batchError === undefined` — i.e., strictly after every
   create/update/orphan call succeeded. This is the literal state-advance
   invariant, not merely documented as such.
6. Re-running after a partial failure: `buildKnownSet`'s live scan
   (`src/sync/reconcile.ts`) re-derives what actually exists on the host via
   `activitiesApi.getAll(accountId)` + `metadata.source === 'ynab'` filtering
   — independent of whether the persisted map caught up — which is what lets
   the retry recognize the already-applied items as `update`s instead of
   re-`create`s.
- **The "run twice" test** (`tests/engine.test.ts`, describe block "SyncEngine
  — first sync over the fixture budget") genuinely exercises this: the same
  `TransactionsFetcher` instance is reused and explicitly documented as
  "ignores the cursor" so dedup cannot come from YNAB's own delta filtering,
  only from the engine's known-set logic — read the test body, it does not
  merely assert a return value shape.
- **The partial-failure test** (`tests/engine.test.ts`, describe block
  "SyncEngine — partial batch failure") configures the mock to fail exactly
  on the 2nd `create` call, asserts the first sync's `created === 1` and
  `success === false`, asserts the cursor is *not* persisted, then runs a
  second sync and asserts `created === 2, updated === 1` (the previously-
  applied item recognized via the live scan, not recreated) and
  `activitiesApi.records.size === 3` (exactly one activity per YNAB
  transaction, never duplicated).

## 6. Type-safety dimension (detail beyond the checklist)

- No `any` at module boundaries (confirmed above).
- `EngineActivitiesAPI` vs the real `ActivitiesAPI`: verified genuinely
  structurally sound, not merely bivariance-dependent — see "Resolved /
  downgraded" above.
- Error taxonomy traced end-to-end:
  `src/ynab/client.ts` (`throwForStatus`, lines 175-189) throws
  `InvalidTokenError`/`RateLimitError`/`ServerError` (a `NetworkError`
  subclass)/generic `YNABSyncError`, or the `get()` wrapper's `catch` throws a
  bare `NetworkError` when the brokered call itself rejects (lines 156-163)
  → `src/sync/engine.ts`'s `failureSummary()` (lines 289-309) narrows via
  `instanceof` to `errorKind: 'invalid_token' | 'rate_limited' | 'network' |
  'unknown'` on `SyncSummary`
  → `src/ui/useSync.ts`'s `triggerSync()` (lines 303-323) reads
  `summary.errorKind`/`summary.errors[0]`, flips `connectionStatus` to
  `'invalid-token'` specifically for that kind, and persists the message
  → `src/ui/components/ErrorLog.tsx`'s `friendlyErrorMessage()` (lines
  19-30) renders per-kind copy matching `docs/SPEC.md` §3.7's table verbatim
  ("Invalid token — re-enter...", "Rate-limited by YNAB — retry after Ns.",
  "Cannot reach api.ynab.com...").
  A mid-batch `PartialBatchError`-shaped failure is folded into
  `errorKind: 'partial_batch'` regardless of the underlying thrown value's
  type (`src/sync/engine.ts:223-242`) — this is correct, since anything
  thrown during the create/update/orphan loop originates from Wealthfolio's
  own `ctx.api.activities` calls, not from YNAB, so it can never legitimately
  be an `InvalidTokenError`/`RateLimitError` in that phase.

## 7. Claims this review could NOT verify (read-only, no live host)

Carried forward from the Stage 4 handoff §4, re-flagged as still unverified
after this review (not newly discovered, not resolved):
- `metadata` round-tripping unmodified through a **live** `ctx.api.activities`
  host implementation (the single biggest residual risk to the dedup
  mechanism, since `externalId` doesn't exist and `metadata` is the
  substitute — see B/finding 8 above).
- Radix `Select` (`BudgetSelector`, `AccountMappingTable`) actually opening
  and allowing an option click inside the real Wealthfolio shell (only
  smoke-tested under jsdom for rendered text/counts).
- `Account.currency` as the real source Wealthfolio populates for
  `wealthfolioAccountCurrencies` in `triggerSync()`.
- Whether a genuine 3.6.1 host (if one is ever actually run) has the older
  fetch-shaped `NetworkAPI` Stage 3 originally assumed, or already matches
  3.6.2 (relevant to M1).
- Whether the host's manifest loader actually rejects, silently drops, or
  tolerates the B1 permissions-shape mismatch — this review's confidence in
  B1 rests on the SDK's own type declarations and README, not on observing
  an actual install failure against a real host.
- Storage per-value ~250 KB ceiling headroom for `transactionIdMap` on a
  long-lived, high-transaction-volume budget — `docs/SPEC.md` §8 already
  flags this as an accepted, non-blocking open question with a stated
  future-work path (chunk by account/date range); not re-raised as a new
  finding here since no acceptance criterion currently demands otherwise.
