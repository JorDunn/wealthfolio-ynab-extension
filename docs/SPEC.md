<!--
SPDX-License-Identifier: AGPL-3.0-only
Copyright (C) 2026 Jordan Dunn / NodeTwo
-->

# wealthfolio-ynab-sync — Design Specification

Status: authoritative (Stage 1 output). If code disagrees with this document,
flag it — do not silently pick one (per CLAUDE.md).

Target: self-hosted Wealthfolio Docker, **web edition**, Addon SDK **3.6.1+**
(sandboxed iframe runtime). TypeScript strict, `@wealthfolio/addon-sdk`,
`@wealthfolio/addon-dev-tools`, Vitest.

---

## 1. Problem statement

Wealthfolio tracks net worth and cash across accounts but has no native
connection to YNAB. A user who runs their day-to-day budgeting in YNAB must
re-enter the same cash-account transactions into Wealthfolio by hand to keep
Wealthfolio's cash balances and performance figures accurate.

This addon performs a **one-way import**: it reads transactions from a single
YNAB budget and creates/updates matching **cash activities** on user-mapped
Wealthfolio accounts. It is idempotent (re-running never duplicates), driven by
YNAB delta requests, secret-safe (the personal access token never leaves the
SDK secrets/network broker), and manually triggered (the addon runtime has no
scheduler).

---

## 2. Runtime facts verified against the addon docs

These constrain every decision below. Sources:
`docs/addons/addon-api-reference.md`, `addon-architecture.md`,
`addon-getting-started.md`, `addon-migration-guide-v3.5-to-v3.6.md`,
`addon-packages.md` in `github.com/afadil/wealthfolio` (fetched 2026-07-20).

- **Sandbox (3.6):** every addon runs in an isolated iframe
  (`sandbox="allow-scripts"`, opaque origin). Consequences:
  - `localStorage` / `sessionStorage` **throw** — must use `ctx.api.storage`.
  - Arbitrary `fetch()` is blocked by CSP + opaque origin. **All** outbound
    HTTP goes through the host **network broker**: `ctx.api.network.request()`,
    limited to hosts declared in the manifest, with auth injected by the broker
    from a named secret (the addon code never handles the raw token in the
    request path).
  - React is no longer re-exported by the SDK; import from `react` /
    `react-dom` and externalize host deps in the bundler.
- **AddonContext shape (verified):**
  ```ts
  interface AddonContext {
    api: HostAPI;                 // accounts, activities, storage, secrets, network, ...
    sidebar: SidebarAPI;          // addItem(item) -> handle.remove()
    router: RouterAPI;            // add(routeConfig)
    onDisable: (cb: () => void) => void;
  }
  ```
  Note: `storage`, `secrets`, and `network` live under **`ctx.api`**, not at
  the top of `ctx`. (The PLAN/task shorthand `ctx.secrets` is incorrect for
  3.6; use `ctx.api.secrets`.)
- **`ctx.api.accounts`:** `getAll(): Promise<Account[]>`, `get(id)`.
- **`ctx.api.activities`:** `create(ActivityInput)`, `update(ActivityUpdate)`,
  `search(page, pageSize, filters, keyword, sort?)`, `getAll(accountId?)`,
  `saveMany`, `delete`, plus import helpers. **Permission granularity note:**
  the documented `activities` permission functions are
  `getAll, search, create, update, import` — `delete`/`saveMany` are *not* in
  that list. We design so the addon needs none of the unlisted functions (see
  §6, deletions → orphan-flag). Flagged for the scaffold stage to confirm.
- **Activity model fields (verified):** `id`, `accountId`, `activityType`,
  `quantity`, `unitPrice`, `date`, `symbol`, `comment`, **`externalId`**
  (optional, "third-party transaction reference"), **`metadata`** (optional
  key-value). Cash amount representation (`amount` + `currency` vs
  `quantity*unitPrice`) is **not** pinned in the docs — see Open Questions.
- **`activityType` enum:** BUY, SELL, SPLIT, DIVIDEND, INTEREST, **DEPOSIT**,
  **WITHDRAWAL**, **TRANSFER_IN**, **TRANSFER_OUT**, FEE, TAX, CREDIT,
  ADJUSTMENT, UNKNOWN. There is **no `INCOME` type** — inflows map to DEPOSIT.
- **`ctx.api.storage`:** async `get/set/delete(key, value)`; string values only
  (`JSON.stringify` objects); key charset `[A-Za-z0-9_.:-]`, ≤128 chars. Docs
  disagree on per-value size (api-reference "≤1 MiB", migration guide
  "~250 KB"); we treat **250 KB** as the hard ceiling and chunk if needed.
- **`ctx.api.secrets`:** async `set/get/delete(key, value)`; encrypted,
  per-addon scoped (`addon_<id>_<key>`). Declaring `secrets` is a High-risk
  permission that **must** be listed in the manifest (not baseline).
- **Baseline capabilities (no manifest entry):** `ui`, `query`, `toast`,
  `logger`, `storage`.
- **Routing/lifecycle:** `ctx.router.add({ id, path?, component })` (3.6.1
  allows a `component` export the host mounts; do **not** call `createRoot`).
  Sidebar items reference a route `id`; icons are from a curated Phosphor set;
  no `onClick` (navigation via `route`). Host mounts routes under
  `/addons/<manifest.id>`. `ctx.onDisable(cb)` for cleanup.
- **No lifecycle scheduler / no app-open event.** The `events` permission
  exposes `onDrop, onUpdateComplete, onSyncStart` (portfolio-sync events), not
  an application-open hook. This confirms CLAUDE.md's "no background
  scheduling" rule and shapes the stretch auto-sync decision (§6.6).

YNAB facts (verified at `api.ynab.com` / `api.ynab.com/#/`): Bearer PAT auth;
`GET /budgets/{id}/transactions` with `since_date` and delta via
`last_knowledge_of_server` → response `server_knowledge`; delta responses
include `deleted:true` tombstones; amounts in **milliunits** (÷1000, signed:
negative = outflow); rate limit **200 req/hr per token** (rolling), 429 on
breach; transaction fields include `id, amount, date, cleared, approved,
deleted, transfer_account_id, transfer_transaction_id, subtransactions[],
import_id, payee_name, memo`; budget currency from
`GET /budgets/{id}/settings` → `currency_format.iso_code`.

---

## 3. Decisions (numbered, with rationale)

### 3.1 Scope — one-way YNAB → Wealthfolio cash import
**In scope:** read a single YNAB budget's transactions; create/update cash
activities (DEPOSIT / WITHDRAWAL / TRANSFER_IN / TRANSFER_OUT) on user-mapped
Wealthfolio cash accounts.
**Out of scope (explicit):** pushing anything back to YNAB (read-only YNAB
usage; no create/update/delete against YNAB); investment activity
(BUY/SELL/DIVIDEND/SPLIT and quantities/prices); YNAB budgets, categories,
goals, payees-as-entities, and scheduled/future transactions.
*Rationale:* the value is keeping Wealthfolio cash balances correct with
minimum permission surface. Investment modeling and write-back multiply risk
and permissions for no stated user need.

### 3.2 Account mapping — explicit, user-controlled, unmapped ignored
The user maps **YNAB account → Wealthfolio account** in the addon settings UI.
YNAB accounts are fetched live; Wealthfolio accounts come from
`ctx.api.accounts.getAll()`. A YNAB account with no mapping is **ignored**
entirely (its transactions are never read into WF). Mapping is persisted in
`ctx.api.storage` keyed by budget.
*Rationale:* explicit opt-in per account prevents surprise imports (e.g. a
YNAB tracking/loan account) and makes the transfer-pairing rule (§3.3)
decidable — "is the counterpart account mapped?" is answerable from the map.

### 3.3 Activity-type mapping
Applied by a **pure** mapping function (`src/sync/mapping.ts`), table-tested.

| YNAB transaction shape | Wealthfolio activityType |
|---|---|
| inflow (`amount > 0`), not a transfer | `DEPOSIT` |
| outflow (`amount < 0`), not a transfer | `WITHDRAWAL` |
| transfer leg, `amount > 0`, **counterpart account mapped** | `TRANSFER_IN` |
| transfer leg, `amount < 0`, **counterpart account mapped** | `TRANSFER_OUT` |
| transfer leg whose **counterpart account is unmapped** | `DEPOSIT`/`WITHDRAWAL` by sign |
| `amount == 0` | **skip** (counted as skipped) |

Details and rationale:
- **Inflow → DEPOSIT (not INCOME):** the enum has no INCOME; DEPOSIT is the
  documented type for external cash inflow and is what drives WF net-contribution
  performance math.
- **Transfers, no double-count:** YNAB models a transfer between two accounts as
  **two linked transactions** (each with `transfer_account_id` /
  `transfer_transaction_id`). When *both* YNAB accounts are mapped, the two
  legs map 1:1 to WF's own two-sided transfer pair (TRANSFER_OUT on the source,
  TRANSFER_IN on the destination). Each WF activity carries its own leg's YNAB
  txn id as `externalId`, so there is exactly one WF activity per YNAB txn — no
  double counting, fully idempotent. A transfer leg is **never** mapped to
  DEPOSIT/WITHDRAWAL when its counterpart is mapped.
- **Transfer to an unmapped counterpart** (e.g. YNAB credit card / off-book
  account not mapped to WF): treated as external cash movement →
  DEPOSIT/WITHDRAWAL by sign. Emitting a half-transfer with no WF counterpart
  would leave a dangling TRANSFER_* that never nets to zero. This is the key
  edge case the mapping tests must cover.
- **Split transactions → parent total only:** a split parent carries the full
  `amount`; `subtransactions[]` are category allocations (out of scope). Sync
  the parent as one DEPOSIT/WITHDRAWAL for its total; ignore subtransactions.
  *Known limitation:* a split that contains a **transfer subtransaction** will
  be recorded as a plain DEPOSIT/WITHDRAWAL for the total and will **not**
  produce a matched TRANSFER pair. Documented; acceptable for v1.
- **Pending / unapproved — configurable, safe default:** default syncs only
  transactions with `approved === true` **and** `cleared !== "uncleared"`
  (i.e. `cleared` or `reconciled`). Two independent toggles in settings:
  `includeUnapproved` and `includeUncleared` (both default `false`).
  *Rationale:* unapproved/uncleared entries are volatile in YNAB; importing
  them early causes churn (create → edit → possibly orphan). Scheduled/future
  transactions live on a different endpoint and are always out of scope.
- **Amount & currency:** convert milliunits → decimal (÷1000). Direction is
  carried by `activityType`; pass the **absolute** amount (sign convention to
  confirm — Open Questions). Activity `currency` = the **YNAB budget's** ISO
  currency (`currency_format.iso_code`). If it differs from the mapped WF
  account's currency, **warn** in the sync summary but still record (WF is
  multi-currency; the addon does not FX-convert). Zero-amount → skipped.

### 3.4 Idempotency & dedup
**Every** created WF activity carries the originating YNAB transaction id in
`externalId` (verified as the "third-party transaction reference" field);
`metadata` additionally records `{ source: "ynab", budgetId, ynabAccountId }`.

Sync state (in `ctx.api.storage`, per budget):
- `last_knowledge_of_server` (the YNAB delta cursor),
- a **YNAB-txn-id → WF-activity-id map**.

**Reconciliation set (dup prevention):** at the start of every sync the engine
builds a *known set* = **union of** (a) the persisted id-map and (b) a **live
scan** of each mapped WF account via `ctx.api.activities.getAll(accountId)`
collecting existing `externalId`s. The live scan makes correctness independent
of whether the persisted map advanced (see partial-failure handling), so a run
after an interrupted run still recognizes already-created activities and does
not duplicate them. This is what keeps the "run sync twice → zero new
activities" test green.

**State-advance invariant (honors CLAUDE.md hard rule):** the **delta cursor
(`last_knowledge_of_server`) advances only after the entire batch fully
applies.** On any failure the cursor is left untouched, so the next run
re-fetches the identical delta; already-applied items are recognized via the
known set and skipped/updated, failed items are retried. The id-map is written
alongside the cursor on full success; because dup prevention rests on the live
`externalId` scan (not solely on the persisted map), a partial failure cannot
create duplicates even though the cursor did not advance.

**YNAB edits:** a delta returns the changed transaction (same `id`). Look it up
in the known set → `ctx.api.activities.update(...)` the mapped WF activity with
the new amount/date/type/comment. An edit that flips an item from eligible to
ineligible (e.g. approved→unapproved) is **left in place with a warning** (v1
does not auto-remove); ineligible→eligible creates it.

**YNAB deletions → orphan-flag (NOT auto-delete).** Delta tombstones
(`deleted:true`) do **not** trigger a WF delete. Instead the engine marks the
mapped WF activity via `update` — appending `[ynab:deleted <date>]` to `comment`
and setting `metadata.ynabDeleted = true` — and lists it in the sync summary's
warnings for the user to remove manually. The id-map entry is kept but marked
orphaned so it is never recreated.
*Rationale (three reasons):* (1) WF `activities.delete` is destructive with no
undo — a mistaken or unapproved YNAB-side delete would silently erase WF data;
(2) `delete` is **not** in the documented `activities` permission function set,
so orphan-flagging keeps the manifest to the minimal declared functions; (3)
one-way imports should never let the source destroy user data in the target
without confirmation. (Auto-delete can be revisited as an opt-in later.)

### 3.5 Secrets & network
- The YNAB PAT is written **once** via `ctx.api.secrets.set("ynab_token", …)`
  when the user enters it. After that, requests reference the secret **by key**
  through the network broker — addon request code never reads the plaintext.
  Reads are **existence-only** (`get(...) !== null`) to render "connected";
  the token value is never returned to the UI, never logged, never in storage.
- All YNAB HTTP goes through `ctx.api.network.request()` to host
  **`api.ynab.com`**, which is the **only** entry in the manifest network
  allowlist. The broker injects `Authorization: Bearer <token>` from the named
  secret (scheme `"bearer"`). CSP + sandbox make any other host impossible,
  reinforcing the allowlist.
- **Logging discipline:** the `logger` may record counts, YNAB txn ids, and WF
  activity ids only — never tokens, headers, request bodies, payee/memo free
  text beyond what a warning needs.

### 3.6 UI — one sidebar page, manual sync
A single route (`/addons/wealthfolio-ynab-sync`) + one sidebar item. Sections:
1. **Connection status** — connected / no-token / invalid-token, with a token
   entry field (write-only; shows "a token is saved", never the value) and a
   "Remove token" action.
2. **Budget selector** — lists budgets from YNAB; selection persisted.
3. **Account mapping table** — rows of YNAB accounts, each with a dropdown of
   WF accounts (`getAll()`); unmapped = ignored.
4. **"Sync now"** button — runs the engine; shows in-progress state.
5. **Last-sync summary** — timestamp + counts (created / updated / skipped /
   orphaned / warnings) and currency-mismatch notices.
6. **Error log** — the engine's typed errors (auth / rate-limit / network /
   partial-batch) with actionable messages; persisted so it survives reload.

Components are thin; all logic lives in `src/sync` / `src/state` / `src/ynab`.
`ctx.onDisable` removes the sidebar item and cancels any in-flight sync.

**Stretch — auto-sync on open (not v1):** because there is no app-open event
and no scheduler, the only honest "on open" is **run sync when the addon page
mounts**, gated by an `autoSyncOnOpen` toggle (default off). This needs **no**
extra permission (it runs on component mount) and does not violate "no
background scheduling" — it is user-navigation-triggered. v1 ships the toggle
UI stubbed/off or omits it; the engine is built so enabling it later is a
one-line call. True background/interval sync is explicitly rejected.

### 3.7 Failure model (each: user-visible outcome + retry semantics)
State-advance rule from §3.4 applies to all: **cursor never advances on
failure.**

| Failure | Detection | User-visible outcome | Retry |
|---|---|---|---|
| **401 bad/expired token** | broker/YNAB 401 | status → "Invalid token"; prompt re-enter; no data written | manual, after new token |
| **429 rate limit** (200/hr) | HTTP 429 (+`Retry-After` if present) | summary: "Rate-limited, retry after N s"; **no auto-retry loop** | manual "Sync now" after the window |
| **Network down / host unreachable** | request rejects / non-HTTP error | error log: "Cannot reach api.ynab.com"; nothing written | manual retry |
| **Partial batch failure** | one op throws mid-batch | summary lists succeeded vs failed items with reasons; cursor **not** advanced | next sync re-fetches same delta; known set skips the succeeded, retries the failed |

Design keeps YNAB calls per sync tiny (1 delta transactions call + occasional
budgets/settings), so a normal sync is nowhere near the 200/hr ceiling; 429 is
an edge, handled without hammering.

---

## 4. Data flow (text diagram)

```
                         addon settings (storage)
                      budgetId, account map, toggles
                                   │
  user clicks "Sync now"          ▼
        │             ┌────────────────────────────┐
        └────────────▶│        sync/engine.ts       │
                      └────────────────────────────┘
        1. load state (state/store.ts): cursor + id-map + account map + settings
        2. YNAB fetch (ynab/client.ts → ctx.api.network.request → api.ynab.com)
             GET /budgets/{id}/transactions?last_knowledge_of_server=<cursor>
             (Bearer injected by broker from secrets("ynab_token"))
             ── milliunits ÷1000 (ynab/milliunits.ts) ──▶ typed YNAB txns
        3. reconcile (sync/reconcile.ts): known set =
             persisted id-map  ∪  live externalId scan of mapped WF accounts
             (ctx.api.activities.getAll(accountId))
        4. map (sync/mapping.ts, pure): each eligible txn → ActivityDraft
             (type by sign/transfer/counterpart; split→parent; skip rules)
             classify vs known set → CREATE | UPDATE | ORPHAN-FLAG | SKIP
        5. apply: ctx.api.activities.create / update  (externalId = ynab txn id)
             on error → stop, collect partial results
        6. persist ONLY on full success (state/store.ts):
             new cursor (server_knowledge) + merged id-map  (atomic write)
        7. return SyncSummary → UI (created/updated/skipped/orphaned/warnings/errors)
```

Secrets never enter steps 4–7; the token exists in addon memory only at the
moment of `secrets.set` during token entry.

---

## 5. Module layout

```
wealthfolio-ynab-sync/
├─ manifest.json                 # id, sdkVersion 3.6.1, minWealthfolioVersion, permissions, network, contributes
├─ package.json                  # AGPL-3.0-only; scripts: test, build, bundle, dev:server
├─ tsconfig.json                 # strict
├─ vite.config.ts                # externalize host deps (react, react-dom, @wealthfolio/*, ...)
├─ vitest.config.ts
├─ LICENSE                       # verbatim AGPL-3.0
├─ CHANGELOG.md                  # Keep a Changelog
├─ README.md
├─ docs/{SPEC.md, INSTALL.md, REVIEW.md}
├─ src/
│  ├─ addon.tsx                  # enable(ctx): router.add + sidebar.addItem + onDisable cleanup
│  ├─ ynab/
│  │  ├─ client.ts               # brokered GET budgets/settings/transactions; delta params; error taxonomy
│  │  ├─ types.ts                # YNAB response types (no `any` at boundary)
│  │  └─ milliunits.ts           # milliunits → decimal
│  ├─ sync/
│  │  ├─ engine.ts               # orchestration + state-advance invariant + partial-failure handling
│  │  ├─ mapping.ts              # PURE: YNAB txn → ActivityDraft (table-tested)
│  │  └─ reconcile.ts            # known set = persisted map ∪ live externalId scan
│  ├─ state/
│  │  ├─ store.ts                # ctx.api.storage-backed sync state (cursor, id-map, account map, settings, error log)
│  │  └─ schema.ts               # persisted shapes + version tag for migrations
│  ├─ secrets/
│  │  └─ token.ts                # set / exists / delete via ctx.api.secrets (existence-only reads)
│  ├─ errors.ts                  # AuthError | RateLimitError | NetworkError | PartialBatchError | ConfigError
│  └─ ui/
│     ├─ SyncPage.tsx            # the one route/page
│     ├─ useSync.ts              # hook: UI → engine
│     └─ components/             # thin: status, budget selector, mapping table, summary, error log
└─ tests/
   ├─ fixtures/                  # captured-shape YNAB JSON — fake ids, fake amounts
   ├─ mapping.test.ts            # table-driven: inflow/outflow/transfer(both mapped/one unmapped)/split/zero/unapproved
   ├─ engine.test.ts            # run-twice→0 new; edit→update; delete→orphan; partial failure→cursor not advanced
   ├─ reconcile.test.ts
   ├─ client.test.ts            # 401/429/network taxonomy; milliunit conversion
   └─ state.test.ts
```

---

## 6. Manifest permission set (minimal)

```jsonc
{
  "id": "wealthfolio-ynab-sync",
  "name": "YNAB Sync",
  "version": "0.1.0",
  "main": "dist/addon.js",
  "sdkVersion": "3.6.1",
  "minWealthfolioVersion": "3.6.1",
  "contributes": {
    "routes": [{ "id": "wealthfolio-ynab-sync" }],
    "links": { "sidebar": [{
      "id": "wealthfolio-ynab-sync", "route": "wealthfolio-ynab-sync",
      "label": "YNAB Sync", "icon": "arrows-clockwise", "order": 100
    }]}
  },
  "network": { "allowedHosts": ["api.ynab.com"] },   // exact key to confirm at scaffold
  "permissions": [
    { "category": "accounts",   "functions": ["getAll"],
      "purpose": "List Wealthfolio accounts to map YNAB accounts onto." },
    { "category": "activities", "functions": ["getAll", "search", "create", "update"],
      "purpose": "Read existing activities for dedup and create/update imported YNAB cash transactions." },
    { "category": "network",    "functions": ["request"],
      "purpose": "Fetch budgets and transactions from api.ynab.com." },
    { "category": "secrets",    "functions": ["set", "get", "delete"],
      "purpose": "Store the YNAB personal access token securely." }
  ]
}
```

`storage`, `ui`, `query`, `toast`, `logger` are **baseline** → no entry.
**Not** requested: `activities.delete`/`import`, `portfolio`, `settings`,
`files`, `events`, `goals`, etc. Adding any later requires a spec update with
rationale (CLAUDE.md).

---

## 7. Acceptance criteria (checklist for later stages)

Scope & mapping
- [ ] Only mapped YNAB accounts produce WF activities; unmapped are ignored.
- [ ] Inflow → `DEPOSIT`, outflow → `WITHDRAWAL` (absolute amount, direction via type).
- [ ] Transfer with **both** accounts mapped → one `TRANSFER_OUT` + one `TRANSFER_IN`, each carrying its own YNAB txn id; no DEPOSIT/WITHDRAWAL emitted; balances net to zero.
- [ ] Transfer whose counterpart is **unmapped** → `DEPOSIT`/`WITHDRAWAL` by sign (no dangling transfer).
- [ ] Split parent → single activity for the parent total; subtransactions ignored; split-with-transfer limitation documented.
- [ ] Default eligibility = `approved && cleared !== "uncleared"`; `includeUnapproved` / `includeUncleared` toggles change it; zero-amount skipped.
- [ ] Milliunits ÷1000 correct (e.g. 123930 → 123.93); activity currency = YNAB budget ISO; currency mismatch warns but records.

Idempotency & state
- [ ] Every created activity has `externalId` = YNAB txn id and `metadata.source = "ynab"`.
- [ ] Running sync twice on the same fixtures creates **zero** new activities the second time (named test).
- [ ] Known set = persisted id-map ∪ live `externalId` scan; a partial failure followed by re-sync creates no duplicates.
- [ ] `last_knowledge_of_server` advances **only** after the full batch applies; on any failure it is unchanged and the next run re-fetches the same delta.
- [ ] YNAB edit → mapped WF activity updated (not duplicated).
- [ ] YNAB delete → WF activity **orphan-flagged** (comment + `metadata.ynabDeleted`), listed in warnings, **not** deleted; never recreated.

Secrets & network
- [ ] Token stored only via `ctx.api.secrets`; never in storage, never logged, never rendered (existence-only).
- [ ] All YNAB traffic via `ctx.api.network.request` to `api.ynab.com`; manifest network allowlist has exactly that one host; Bearer injected by broker from the named secret.
- [ ] No token/header/body appears in any `logger` call (grep-checkable).

Failure model
- [ ] 401 → status "Invalid token", nothing written, manual re-entry.
- [ ] 429 → "retry after N", no auto-retry loop, cursor not advanced.
- [ ] Network error → "Cannot reach api.ynab.com", cursor not advanced.
- [ ] Partial batch → summary lists succeeded/failed with reasons; retryable.

UI & build
- [ ] One sidebar item + one route (`/addons/wealthfolio-ynab-sync`); `onDisable` cleans up.
- [ ] Page shows: connection status, budget selector, mapping table, "Sync now", last-sync summary, error log.
- [ ] Manifest lists exactly the §6 permissions; `sdkVersion`/`minWealthfolioVersion` ≥ 3.6.1; host deps externalized.
- [ ] `npm test -- --run` and `npm run build` pass; TS strict, no `any` at module boundaries.

---

## 8. Open questions (only items that genuinely need runtime confirmation)

None block Stage 2 (scaffold). The following must be pinned against the SDK
`.d.ts` files / a real 3.6.1 host during Stage 3 (implement) — each has a safe
default so the build proceeds:

1. **Cash-amount representation of `ActivityInput`.** Docs list
   `quantity`/`unitPrice` but do not confirm an `amount`+`currency` shape for
   DEPOSIT/WITHDRAWAL/TRANSFER cash activities, nor the sign convention.
   *Default:* pass `amount` = absolute decimal + explicit `currency`, direction
   via `activityType`; adjust to the real SDK type in Stage 3 (single mapping
   function, one place to change).
2. **`ctx.api.network.request()` exact signature** (options object, header/
   `secretKey`/auth-scheme fields) and the **exact manifest key** for the host
   allowlist (`network.allowedHosts` per the migration guide). *Default:* the
   §6 shape; confirm and correct in the client wrapper only.
3. **`activities` permission enforcement granularity** — confirm `delete`/
   `saveMany` really are outside the declarable set (the orphan-flag decision
   already avoids needing them, so this is a confirmation, not a dependency).
4. **Storage per-value ceiling** (250 KB vs 1 MiB). *Default:* treat 250 KB as
   the limit; if a budget's id-map approaches it, chunk by account/date range.
