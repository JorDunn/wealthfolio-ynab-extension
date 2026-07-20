---
handoff_dir: .claude/handoffs
max_retries: 2
on_failure: escalate
project_type: node
---

# Wealthfolio YNAB Sync Addon — Build Plan

Goal: a Wealthfolio addon (`wealthfolio-ynab-sync`) that syncs transactions from
a YNAB budget into Wealthfolio cash accounts, for a self-hosted Docker (web
edition) Wealthfolio instance. TypeScript, built on `@wealthfolio/addon-sdk`
with `@wealthfolio/addon-dev-tools` for scaffold/dev/build.

No stage has a `skill:` binding — this is a Node/TS stack outside the local
skill library. Working method is embedded in each stage's prose instead.

## Stage 1 — Spec

```yaml
model: opus
effort: high
tools: [Read, Write, Glob, Grep, WebFetch, WebSearch]
verify:
  files:
    - docs/SPEC.md
depends_on: []
```

Produce `docs/SPEC.md` for a Wealthfolio addon that syncs YNAB transactions
into Wealthfolio. No code in this stage.

Research inputs (fetch and read before writing):
- Wealthfolio addon docs: https://wealthfolio.app/docs/addons/api-reference/
  and https://github.com/wealthfolio/wealthfolio/tree/main/docs/addons —
  confirm the current AddonContext surface (`ctx.api.accounts`,
  `ctx.api.activities`, `ctx.secrets`, `ctx.sidebar`, `ctx.router`), the
  manifest permission model (data permissions, network host allowlist, secrets),
  addon storage options for non-secret state, and any web-edition/sandbox
  constraints (SDK 3.6+ sandbox).
- YNAB API v1: https://api.ynab.com/ — `GET /budgets/{budget_id}/transactions`,
  `since_date`, and `last_knowledge_of_server` delta requests; auth via
  personal access token (Bearer); amounts in milliunits (÷1000).

The spec MUST decide, with rationale:
1. **Scope**: sync YNAB transactions into user-mapped Wealthfolio cash
   accounts only. Explicitly out of scope: pushing data back to YNAB,
   investment BUY/SELL activity, YNAB budget/category modeling.
2. **Account mapping**: user maps YNAB account → Wealthfolio account in the
   addon settings UI. Unmapped YNAB accounts are ignored. Mapping persisted in
   addon state storage.
3. **Activity type mapping**: YNAB inflow → `DEPOSIT` (or `INCOME` where the
   docs say appropriate), outflow → `WITHDRAWAL`; transfers between two mapped
   accounts → `TRANSFER_IN`/`TRANSFER_OUT` pair without double counting;
   define handling for split transactions (sync the parent total, not
   subtransactions) and pending/unapproved transactions (configurable,
   default: cleared+approved only).
4. **Idempotency/dedup**: every created Wealthfolio activity must carry the
   originating YNAB transaction id (in whatever field the SDK supports —
   comment/metadata/externalId; verify against the API reference). Sync state
   = `last_knowledge_of_server` per budget + YNAB-txn-id → WF-activity-id map.
   Re-running sync never duplicates. Define behavior for YNAB edits (update
   the mapped activity) and YNAB deletions (delete vs orphan-flag —
   pick one and justify).
5. **Secrets**: YNAB personal access token stored via the SDK secrets API
   only; never in state storage, never logged. Manifest network allowlist:
   `api.ynab.com` only.
6. **UI**: one sidebar page with: connection status, budget selector, account
   mapping table, "Sync now" button, last-sync summary, and an error log.
   No background scheduler (addon lifecycle has none) — manual sync in v1;
   note an on-app-open auto-sync toggle as the stretch behavior if the SDK's
   event model supports it.
7. **Failure model**: YNAB 401 (bad token), 429 (rate limit: 200 req/hr),
   network-down, partially-failed batch — each with defined user-visible
   outcome and retry semantics.

Spec format: problem statement, decisions (numbered, with rationale), data
flow diagram (text), module layout for the repo, acceptance criteria as a
checklist testable by later stages. End with a short "open questions" section
only if something genuinely blocks — otherwise decide.

Write the handoff to `.claude/handoffs/handoff_stage_1.attempt_{k}.md`: the
decision list, module layout, and acceptance criteria — not the full spec.

## Stage 2 — Scaffold

```yaml
model: haiku
effort: low
verify:
  files:
    - manifest.json
    - package.json
    - src/addon.tsx
  command: npm run build
depends_on: [1]
```

Mechanical stage. Scaffold the addon skeleton per the Stage 1 handoff's module
layout. Use the official tooling — check for a generator first
(`npm create wealthfolio-addon@latest` or the `@wealthfolio/addon-dev-tools`
CLI per the addon docs); only hand-roll the skeleton if no generator exists.

Requirements:
- `manifest.json` with: addon id `wealthfolio-ynab-sync`, name, version
  `0.1.0`, and the minimal permission set from the spec (accounts read,
  activities read/write, secrets, network host `api.ynab.com`, UI/sidebar).
- TypeScript strict mode; Vitest wired up (`npm test` runs and passes with a
  placeholder test); `npm run build` produces the addon bundle.
- Empty-but-typed module files matching the spec's layout (e.g.
  `src/ynab/client.ts`, `src/sync/engine.ts`, `src/sync/mapping.ts`,
  `src/state/store.ts`, `src/ui/` — follow the handoff, not this example).
- A `.gitignore` suitable for a Node/TS addon.

Write the handoff: exact file tree produced, the manifest permission block,
and the build/test commands that work.

## Stage 3 — Implement sync core (test-first)

```yaml
model: sonnet
effort: high
verify:
  files:
    - src/ynab/client.ts
    - src/sync/engine.ts
    - src/sync/mapping.ts
  command: npm test -- --run && npm run build
depends_on: [2]
```

Implement the non-UI core strictly test-first with Vitest: for each unit,
write the failing test, see it fail, implement, see it pass, refactor. Mock
the YNAB API (fixture JSON responses) and mock the SDK's `ctx.api` — no
network and no real Wealthfolio instance in tests.

Deliverables, per the Stage 1 spec and Stage 2 layout:
1. **YNAB client**: typed wrapper for budgets list + transactions with
   `since_date`/`last_knowledge_of_server`, Bearer auth injected from the
   secrets API, milliunit→decimal conversion, 401/429/5xx error taxonomy.
2. **Mapping layer**: pure functions YNAB txn → Wealthfolio activity draft
   (type mapping, transfer pairing, split handling, skip-rules), fully
   covered by table-driven tests including edge cases from the spec
   (transfer between one mapped and one unmapped account, edited txn,
   deleted txn, zero-amount, foreign currency if YNAB budget currency ≠
   account currency — per spec's decision).
3. **Sync engine**: orchestrates fetch → diff against state → create/update/
   delete activities via `ctx.api.activities` → persist new server knowledge
   and id-map atomically (state only advances if the batch fully applied, per
   the spec's failure model). Idempotency test: running sync twice on the
   same fixtures produces zero new activities the second time.

Coverage of the mapping layer and engine decision paths must be complete
enough that the acceptance checklist items from the spec that concern the
core are each traceable to a named test.

Write the handoff: public interfaces of client/mapping/engine (signatures),
state shape, and any deviation from the spec with justification.

## Stage 4 — Implement UI

```yaml
model: sonnet
effort: medium
verify:
  files:
    - src/addon.tsx
  command: npm test -- --run && npm run build
depends_on: [3]
```

Build the addon UI per the spec's UI section, wiring the Stage 3 engine:
sidebar item + routed page (`ctx.sidebar.addItem`, `ctx.router.add`),
token entry (writes to secrets, reads back only existence — never displays
the token), budget selector, account-mapping table (YNAB accounts fetched
live, Wealthfolio accounts from `ctx.api.accounts.getAll()`), "Sync now"
with progress + result summary, error log surfaced from the engine's error
taxonomy, and `ctx.onDisable` cleanup.

Match Wealthfolio's UI conventions (the app is React + Tailwind + shadcn-style
components; check what the SDK exposes vs. what must be self-styled). Keep
components thin — all logic stays in the Stage 3 core so the UI needs only
smoke-level tests (render + interaction wiring), which still run under
`npm test`.

Write the handoff: routes/components added, how the UI invokes the engine,
and manual-QA notes for the reviewer.

## Stage 5 — Review

```yaml
model: sonnet
effort: high
tools: [Read, Glob, Grep, Bash]
verify:
  files:
    - docs/REVIEW.md
depends_on: [4]
```

Read-only critique of the full addon against `docs/SPEC.md`. You may run
`npm test -- --run` and `npm run build` to check claims, but do not edit
source. Review for:
- Acceptance-checklist coverage: every spec checklist item → pass/fail with
  file/test evidence.
- Security: token never logged, never in state storage, never rendered;
  network calls restricted to `api.ynab.com`; manifest permissions minimal.
- Idempotency and state-advance-only-on-success actually enforced (trace the
  code path, don't trust names).
- Type safety (no `any` leaks at module boundaries), error taxonomy actually
  reaching the UI.

Write findings to `docs/REVIEW.md` graded blocker/major/minor. Write the
handoff: the blocker/major list only. If there are blockers, say so plainly —
the human decides whether to loop back before Stage 6.

## Stage 6 — Package & install docs

```yaml
model: sonnet
effort: low
verify:
  files:
    - CHANGELOG.md
    - docs/INSTALL.md
    - LICENSE
  command: npm run build
depends_on: [5]
```

Fix any Stage 5 blockers ONLY if the handoff lists them and each fix is
covered by a test; otherwise touch no core logic. Then:
- Licensing: add the verbatim AGPL-3.0 text as `LICENSE`; set
  `"license": "AGPL-3.0-only"` in `package.json` (and in `manifest.json` if
  the addon manifest schema has a license field); add a short copyright +
  license notice header comment to each `src/` file (holder: Jordan Dunn /
  NodeTwo); add a License section to `README.md` stating AGPL-3.0 and that
  commercial licensing inquiries go to nodetwo.io.
- Set version `0.1.0` in `manifest.json`/`package.json`; write
  `CHANGELOG.md` (Keep a Changelog format).
- Produce the distributable addon package with the SDK's build/package
  command and note the artifact path.
- Write `docs/INSTALL.md` for the **self-hosted Docker web edition**
  specifically: how to install/enable the addon on the web edition, the
  dev-mode flow (`VITE_ENABLE_ADDON_DEV_MODE` + dev server) vs. installing
  the packaged build, where addon data/secrets live relative to the `/data`
  volume, and the upgrade path.
- `README.md`: what it does, screenshots placeholder, scope/limitations
  (manual sync, cash accounts only), YNAB token setup steps.

Write the handoff: artifact path, install steps verified, and any remaining
minor findings deferred from review.
