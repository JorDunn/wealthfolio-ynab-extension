# Handoff — Stage 3 (Implement sync core) → Stage 4 (UI)

Core is implemented test-first and green: 68 Vitest tests across 6 files,
`npm run build` and `npm run type-check` both exit 0. This handoff is a
reference for wiring the UI to the engine — not a narrative.

**Read the "Deviations from spec / Stage 2 scaffold" section before wiring
anything.** The most important one changes how idempotency actually works
(no `externalId` field exists in the real SDK — metadata is used instead).

---

## 1. Public interfaces

### `src/ynab/client.ts` — `YNABClient`

```ts
export interface YNABClientConfig {
  request: NetworkRequestFn;      // ctx.api.network.request, unmodified
  secretKey: string;               // name of the secret holding the YNAB PAT
}

class YNABClient {
  constructor(config: YNABClientConfig);
  getBudgets(): Promise<YnabBudgetSummary[]>;
  getBudgetSettings(budgetId: string): Promise<YnabBudgetSettings>;   // .currency_format.iso_code
  getAccounts(budgetId: string): Promise<YnabAccount[]>;
  getTransactions(budgetId: string, options?: { sinceDate?: string; lastKnowledgeOfServer?: number })
    : Promise<{ transactions: YnabTransaction[]; serverKnowledge: number }>;
  validateToken(): Promise<boolean>;   // false only on 401; rethrows other errors
}
```

**Construction from `ctx` (exact wiring):**
```ts
const client = new YNABClient({
  request: (req) => ctx.api.network.request(req),   // NetworkRequest -> NetworkResponse, matches ctx.api.network.request's real signature
  secretKey: YNAB_TOKEN_SECRET_NAME,                  // from src/secrets/token.ts — 'ynab-personal-access-token'
});
```
The client **never** calls `ctx.api.secrets.get()` for the token. Auth is
`{ type: 'bearer', secretKey }` on every request; the host broker resolves
the secret and injects `Authorization` itself. Do not add a manual
`Authorization` header anywhere — that would defeat the point.

### `src/sync/mapping.ts` — pure functions

```ts
function mapTransaction(txn: YnabTransaction, config: MappingConfig): MappingOutcome;
function toActivityInput(draft: ActivityDraft): WealthfolioActivityInput;

type MappingOutcome =
  | { kind: 'skip'; reason: 'zero-amount' | 'unmapped-account' | 'unapproved' | 'uncleared'; ynabTransactionId: string }
  | { kind: 'mapped'; draft: ActivityDraft };

interface MappingConfig {
  budgetId: string;
  budgetCurrency: string;                                  // currency_format.iso_code
  accountMapping: Record<string, string>;                  // ynabAccountId -> wealthfolioAccountId
  wealthfolioAccountCurrencies?: Record<string, string>;    // wealthfolioAccountId -> currency (for the mismatch warning)
  includeUnapproved: boolean;
  includeUncleared: boolean;
}
```
No I/O. Zero engine/ctx coupling. Table-tested in `tests/mapping.test.ts` (20 cases).

### `src/sync/engine.ts` — `SyncEngine`

```ts
class SyncEngine {
  constructor(deps: SyncEngineDeps);
  sync(): Promise<SyncSummary>;
}

interface SyncEngineDeps {
  ynabClient: TransactionsFetcher;      // YNABClient satisfies this structurally
  activitiesApi: EngineActivitiesAPI;   // ctx.api.activities satisfies this structurally (getAll/create/update only)
  stateStore: StateStore;
  config: SyncEngineConfig;
  now?: () => number;                   // defaults to Date.now; inject in tests only
}

interface SyncEngineConfig {
  budgetId: string;
  budgetCurrency: string;
  accountMapping: Record<string, string>;
  wealthfolioAccountCurrencies?: Record<string, string>;
  includeUnapproved: boolean;
  includeUncleared: boolean;
  sinceDate?: string;   // optional; omit for normal delta syncs
}

interface SyncSummary {
  success: boolean;
  created: number;
  updated: number;
  skipped: number;
  orphaned: number;
  warnings: string[];       // human-readable: eligibility flips, orphan-flags, currency mismatches
  errors: string[];
  errorKind?: 'invalid_token' | 'rate_limited' | 'network' | 'partial_batch' | 'unknown';
  retryAfterSeconds?: number;   // only set when errorKind === 'rate_limited'
}
```

**Construction from `ctx` (exact wiring) — one `SyncEngine` per sync click:**
```ts
import { SyncEngine } from './sync/engine';
import { YNABClient } from './ynab/client';
import { StateStore } from './state/store';
import { YNAB_TOKEN_SECRET_NAME } from './secrets/token';

const engine = new SyncEngine({
  ynabClient: new YNABClient({
    request: (req) => ctx.api.network.request(req),
    secretKey: YNAB_TOKEN_SECRET_NAME,
  }),
  activitiesApi: ctx.api.activities,   // structurally compatible: getAll/create/update
  stateStore: new StateStore(ctx.api.storage),
  config: {
    budgetId,                                  // from UserConfigSchema.activeBudgetId
    budgetCurrency,                             // from client.getBudgetSettings(budgetId).currency_format.iso_code
    accountMapping,                             // from BudgetStateSchema.accountMappings (persisted mapping UI)
    wealthfolioAccountCurrencies,               // build from ctx.api.accounts.getAll() -> Record<id, currency>
    includeUnapproved: userConfig.includeUnapproved,
    includeUncleared: userConfig.includeUncleared,
  },
});

const summary = await engine.sync();
```
`SyncEngine` holds no ctx reference itself — everything it needs is passed
in via `deps`, so it stays testable without any SDK types. The engine is
side-effect-free until `.sync()` is called; construct fresh per click (cheap).

### `src/sync/reconcile.ts` — dedup (engine-internal, but exported for the UI if you ever need a manual "already synced?" check)

```ts
function buildKnownSet(persistedMap: TransactionIdMap, mappedWealthfolioAccountIds: string[], activitiesApi: ActivitiesLookupAPI): Promise<KnownSet>;
function knownSetToTransactionIdMap(knownSet: KnownSet): TransactionIdMap;
```
You should not need to call these directly from the UI — `SyncEngine.sync()`
already does. Listed for completeness / debugging.

---

## 2. State shape (`ctx.api.storage`, via `StateStore`)

```ts
// key: budget:{budgetId}:state
interface BudgetStateSchema {
  syncState: {
    lastKnowledgeOfServer: number | null;     // YNAB delta cursor — a NUMBER, not a string
    transactionIdMap: Record<string, { wealthfolioActivityId: string; orphaned: boolean }>;
    lastSyncTimestamp: number | null;         // epoch ms
  };
  accountMappings: Record<string, string>;    // ynabAccountId -> wealthfolioAccountId
  lastSyncError: string | null;
}

// key: user:config
interface UserConfigSchema {
  activeBudgetId: string | null;
  autoSyncOnOpen: boolean;
  includeUnapproved: boolean;
  includeUncleared: boolean;
}
```
`StateStore` (`src/state/store.ts`) wraps `ctx.api.storage` (`get`/`set`/`delete`,
`get` returns `string | null`) and handles JSON (de)serialization + malformed-data
recovery (`getBudgetState`/`getUserConfig` return `null` rather than throwing on
bad JSON). The UI should read/write through `StateStore`, never touch
`ctx.api.storage` directly, and never persist `accountMapping`/settings anywhere
except through this schema (so the engine and UI always agree on shape).

**`accountMappings` here is the persisted UI mapping table's output** — the
UI owns editing it; the engine only reads `config.accountMapping` (passed in
at construction, sourced from this same persisted value).

---

## 3. Error taxonomy the UI must surface

Two layers:

1. **`YNABClient` throws directly** if you call it outside the engine (e.g. a
   "test connection" button calling `validateToken()`): `InvalidTokenError`,
   `RateLimitError` (`.retryAfter: number`, seconds), `NetworkError`,
   `ServerError extends NetworkError` (5xx — `instanceof NetworkError` still
   catches it), or a generic `YNABSyncError` for other non-2xx statuses. All
   in `src/errors.ts`.

2. **`SyncEngine.sync()` never throws** — it always resolves to a
   `SyncSummary`. Check `summary.success` and `summary.errorKind`:

   | `errorKind` | Meaning | Suggested UI copy | Cursor state |
   |---|---|---|---|
   | `invalid_token` | 401 from YNAB | "Invalid token — re-enter your YNAB personal access token." | untouched |
   | `rate_limited` | 429 | `` `Rate-limited by YNAB — retry after ${summary.retryAfterSeconds}s.` `` — **do not auto-retry** | untouched |
   | `network` | request rejected, or 5xx | "Cannot reach api.ynab.com — check your connection and retry." | untouched |
   | `partial_batch` | a create/update threw mid-batch | `summary.errors[0]` is a ready-to-show sentence with applied/remaining counts | untouched; a retry click finishes the rest, no duplicates |
   | `unknown` | anything else | show `summary.errors[0]` | untouched |

   On success (`errorKind` absent), still render `summary.warnings` — this is
   where currency-mismatch notices, "no longer eligible, left in place", and
   "deleted in YNAB, flagged not deleted" messages surface (spec §3.6 item 5/6).

**Never render the token value.** `getYNABToken()` in `src/secrets/token.ts`
exists only for edge cases needing the plaintext (there currently are none
in this addon's own code) — prefer `hasYNABToken()` for the "connected"
indicator, which is implemented as `get(...) !== null` and never returns
the value.

---

## 4. Deviations from spec / Stage 2 scaffold (read this)

All of these were forced by the **installed** `@wealthfolio/addon-sdk@3.6.2`
type declarations (`node_modules/@wealthfolio/addon-sdk/dist/src/*.d.ts`),
which differ from both `docs/SPEC.md`'s assumptions and the Stage 2 handoff's
assumed shapes. Flagging per CLAUDE.md ("if code and spec disagree, flag
it").

1. **No `externalId` field on Activity — idempotency uses `metadata`
   instead. Most important deviation.** Spec §3.4 and the Stage 2 handoff
   both assumed an `externalId` field ("third-party transaction reference")
   settable via create/update. The real `ActivityCreate`/`ActivityUpdate`/
   `Activity`/`ActivityDetails` types have no such field. `sourceSystem` /
   `sourceRecordId` / `idempotencyKey` DO exist, but **only on the read
   models** (`Activity`, `ActivityDetails`) — `ActivityCreate`/`ActivityUpdate`
   (what `create()`/`update()` actually accept) don't include them, so an
   addon cannot author them at all. The only field that is both
   addon-settable (via `create`/`update`) and addon-readable-back (via
   `ActivityDetails.metadata`) is `metadata`. Implemented as:
   `metadata: { source: 'ynab', budgetId, ynabAccountId, ynabTransactionId, ynabDeleted? }`,
   written by `mapping.ts`'s `toActivityInput`, read back by
   `reconcile.ts`'s live scan (`metadata.source === 'ynab' && metadata.ynabTransactionId`).
   **If the UI or a future SDK bump reintroduces a real `externalId`/
   `sourceRecordId`-on-write field, the fix is localized to `toActivityInput`
   (write side) and `extractYnabTransactionId` in `reconcile.ts` (read
   side).** Nothing else needs to change.

2. **`ctx.api.network.request` signature.** Stage 2 assumed
   `request(url, init): Promise<Response>` (fetch-shaped) with the client
   building `Authorization: Bearer <token>` itself from a plaintext
   `apiKey`. The real `NetworkAPI` is `request(request: NetworkRequest):
   Promise<NetworkResponse>` — a single object in, `{ status, headers, body:
   string }` out (not a fetch `Response`; no `.ok`/`.json()`). Auth is
   `NetworkAuth { type: 'bearer'|'basic'; secretKey: string }` — the addon
   supplies the *name* of the secret, never the value; the broker resolves
   and injects the header. `YNABClient` was rebuilt around this from
   scratch. This also resolves spec §8 open question 2 in favor of the
   secretKey-based design (safer than the spec's own tentative default).

3. **`ctx.api.storage` method is `delete`, not `remove`; `get()` returns
   `string | null`, not `string | undefined`.** Fixed in `StorageAPI`
   (`src/state/store.ts`).

4. **`ctx.api.secrets` has no `exists()` method; `get()` returns
   `string | null`.** Fixed in `SecretsAPI` (`src/secrets/token.ts`);
   `hasYNABToken()` reimplemented as `get(...) !== null` — this actually
   matches the spec's own prose ("Reads are existence-only (`get(...) !==
   null`)", §3.5) more closely than the Stage 2 stub did.

5. **YNAB delta cursor (`server_knowledge`) is a number, not a string.**
   Fixed `SyncStateSchema.lastKnowledgeOfServer: number | null`
   (`src/state/schema.ts`).

6. **`ynab/types.ts` field names.** The Stage 2 stub used camelCase
   (`lastModifiedOn`, `categoryGroupId`, ...) that doesn't match YNAB's
   actual snake_case wire format at all (`last_modified_on`,
   `transfer_account_id`, `server_knowledge`, ...). Rewrote wholesale to
   mirror the real API response shape 1:1 — this is deliberate: a
   translation layer is itself a place bugs hide, so the client parses wire
   JSON directly into these types with no renaming step.

7. **Persisted id-map gained an `orphaned` bit per entry**
   (`TransactionMapEntry { wealthfolioActivityId; orphaned }` instead of a
   bare `string`). Needed so a YNAB-side delete, once orphan-flagged, is
   never re-flagged (and never re-warned) on a later sync — a bare string
   value couldn't carry that state. See `reconcile.ts`'s `ActivitySnapshot` /
   `KnownSetEntry.snapshot` for how the engine rebuilds a full
   `ActivityUpdate` payload (a full-replace API, not a patch) for the orphan-flag
   write without a second activities scan.

8. **Minor:** `UserConfigSchema.activebudgetId` typo fixed to `activeBudgetId`.

None of these are spec-*intent* disagreements — the spec's decisions (§3.3
mapping table, §3.4 dedup/state-advance invariant, §3.7 failure model) are
all implemented as written. These are all "the SDK's actual shape differs
from what Stage 1/2 assumed it would be," resolved in favor of the real
installed `.d.ts` files, with the localized fix-point noted for each in case
a future SDK version changes again.

---

## 5. Test inventory (68 tests, 6 files, all green)

- `tests/client.test.ts` (15) — brokered request shape, auth-by-secretKey
  (never an inline header), budgets/settings/accounts/transactions parsing,
  query-param construction, 401/429 (incl. missing `Retry-After` fallback)/5xx/
  network-reject/other-4xx taxonomy, `validateToken()`.
- `tests/mapping.test.ts` (20) — table-driven: inflow/outflow, transfer both
  mapped (both legs), transfer counterpart unmapped (both signs), split
  parent (subtransactions never inspected, even a fake transfer one),
  zero-amount, unapproved/uncleared defaults and toggles, `reconciled` counts
  as cleared, unmapped-account skip, milliunit precision (123930→123.93),
  activity currency = budget currency (not account currency), currency
  mismatch flagging (present/absent/unknown-account cases), `toActivityInput`
  metadata tagging.
- `tests/reconcile.test.ts` (10) — empty set, persisted-only entries, live
  scan discovery from empty persisted map, live-wins-over-stale-persisted,
  ignores non-YNAB-sourced activities, multi-account scan, `orphaned` from
  `metadata.ynabDeleted`, dedup of repeated account ids, snapshot capture,
  `knownSetToTransactionIdMap` round-trip.
- `tests/engine.test.ts` (12) — full 5-scenario fixture sync (each mapping
  outcome, all metadata-tagged); **`MANDATORY` idempotency test** (name
  literally: "running sync twice on the same fixtures creates zero new
  activities the second time (spec §7 idempotency)") using a fetcher that
  ignores the cursor and returns the identical page both times — the
  strongest version of this test, since dedup must come from the engine's
  known-set logic rather than YNAB's own delta filtering; edit→update;
  delete→orphan-flag (not deleted, listed in warnings); re-delete is a no-op
  (no double-flag/double-warn); eligibility flip (approved→unapproved) left
  in place with a warning; currency-mismatch warning; 401/429/network
  fetch-stage failures (nothing written, correct `errorKind`); **partial
  batch failure** — cursor not advanced, retry finishes the rest without
  duplicating what already applied; unmapped-account transactions never
  create anything.
- `tests/state.test.ts` (7), `tests/token.test.ts` (4) — schema round-trips
  (incl. numeric cursor + per-entry `orphaned`), malformed-JSON recovery,
  per-budget key scoping, secrets existence-only semantics.

Every acceptance-checklist item in `docs/SPEC.md` §7 that concerns the core
(scope/mapping, idempotency/state, failure model) is traceable to one of the
named tests above.

---

## 6. Verification

```
$ npm test -- --run
 Test Files  6 passed (6)
      Tests  68 passed (68)
$ echo $?
0

$ npm run build
dist/addon.js  0.95 kB │ gzip: 0.48 kB
✓ built in ~50ms
$ echo $?
0

$ npm run type-check
(no output)
$ echo $?
0
```

`grep -rn "\bany\b" src` and a logger-call grep both come back empty; only
`api.ynab.com` appears as a URL host in `src/`; every touched `src/` file
still carries its AGPL-3.0-only header.

## 7. Uncertain / left for Stage 4 or later confirmation

- The `metadata`-based idempotency mechanism (deviation #1 above) has not
  been confirmed against a **live** Wealthfolio host — only against the
  installed SDK's type declarations. If a live host's `activities.create()`
  silently drops or truncates `metadata`, dedup breaks silently. Worth a
  smoke test against a real dev server before shipping.
- `ctx.api.accounts.getAll()` → `Account.currency` was used as the intended
  source for `wealthfolioAccountCurrencies` in the wiring example above; this
  wasn't exercised against a live host either (mapping.ts/engine.ts take it
  as a plain injected `Record<string,string>`, so this is purely a UI-layer
  wiring concern, not a core-logic risk).
- `sinceDate` on `SyncEngineConfig` is plumbed through but unused by any
  current UI plan; leave unset (undefined) unless Stage 4 has a concrete
  need for a bounded first sync.
