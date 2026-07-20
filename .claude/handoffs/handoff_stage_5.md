<!--
SPDX-License-Identifier: AGPL-3.0-only
Copyright (C) 2026 Jordan Dunn / NodeTwo
-->

# Handoff — Stage 5 (Review) → Stage 6 (Packaging/docs)

Full findings: `docs/REVIEW.md`. This is the compressed, actionable subset:
**1 blocker (Stage 6 must fix, test-covered), 2 major (flagging only — read
before deciding whether to fix; not required to block packaging but should
not be silently shipped either)**. Minor findings are in `docs/REVIEW.md` §2
only, not repeated here.

Verification reproduced this session: `npm test -- --run` → 8 files / 82
tests / exit 0. `npm run type-check` → exit 0. `npm run build` → 29.78 kB /
exit 0. No blockers or majors touch core sync logic — engine, mapping,
reconcile, idempotency, and the error-taxonomy trace are all sound and
test-covered (see `docs/REVIEW.md` §3, §5, §6 for the full trace).

---

## Must fix (blocker)

### B1 — `manifest.json`'s `permissions` field has the wrong shape

- **File:** `manifest.json:19-33`.
- **Problem:** currently an object `{ "accounts": ["getAll"], ... }`. Must be
  an **array** of `{ category, functions: string[], purpose: string }`
  objects — confirmed against the installed SDK's own type
  (`AddonManifest.permissions?: Permission[]` in
  `node_modules/@wealthfolio/addon-sdk/dist/src/manifest.d.ts`), the SDK's
  shipped `README.md` (two worked examples), and `docs/SPEC.md` §6's own
  example (already correctly shaped — copy it verbatim).
- **Fix:** replace the `permissions` block with `docs/SPEC.md` §6's JSON
  exactly:
  ```json
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
  ```
  The permission *content* (categories/functions) doesn't change — only the
  shape and the addition of `purpose` strings.
- **Required test coverage for this fix (per the run's rule — Stage 6 fixes
  must be test-covered):** add `tests/manifest.test.ts` that imports
  `manifest.json` and asserts `Array.isArray(manifest.permissions)` and that
  every entry has a non-empty `category`, a `functions: string[]`, and a
  non-empty `purpose` string. A `tsc`-level check (`const _t: AddonManifest =
  manifest` in a compiled file) is a nice-to-have addition but the runtime
  assertion above is the minimum bar.
- **Do not** change the declared permission categories/functions themselves —
  they were independently verified correct and minimal against the SDK's
  `PERMISSION_CATEGORIES` (see `docs/REVIEW.md` §2/B1 and §4).

---

## Flagging only (major — your call whether to fix; not required to unblock packaging, but don't ship silently unaware)

### M1 — `sdkVersion`/`minWealthfolioVersion` say `"3.6.1"`, code requires `3.6.2` shapes

- **File:** `manifest.json:8-9`.
- Every Stage 3 "Deviation note" comment (`src/ynab/client.ts`,
  `src/state/store.ts`, `src/secrets/token.ts`) documents that the actual
  installed SDK (`3.6.2`) has different API shapes than what was assumed for
  `3.6.1` at design time. `package.json` itself pins `^3.6.2`, not `^3.6.1`.
- **Unverified, hedged in the review:** whether a genuine 3.6.1 host actually
  has the older shapes (no 3.6.1 package available locally to diff). If you
  have a way to confirm 3.6.1-runtime compatibility, do that; otherwise the
  safe fix is bumping both fields to `"3.6.2"`.

### M2 — `npm run package` doesn't include `LICENSE` (or `CHANGELOG.md`) in the distributable zip

- **File:** `package.json`'s `"package"` script — currently zips
  `manifest.json dist/ README.md`.
- `LICENSE` (AGPL-3.0-only, present at repo root) should be in the shipped
  artifact for an AGPL-licensed addon. This is exactly Stage 6's scope —
  fix the zip command to include `LICENSE` (and consider `CHANGELOG.md`).

---

## Things Stage 6 needs to know (not findings, just state)

- **Packaging inputs present:** `LICENSE` (AGPL-3.0-only, full text, repo
  root), `README.md` (repo root, minimal — dev-workflow only, no user-facing
  install/usage instructions), `CHANGELOG.md` (repo root, Keep-a-Changelog
  format, but **stale** — only documents "initial scaffolding," doesn't
  reflect the Stage 3 core engine or Stage 4 UI work; update before tagging a
  release).
- **Missing:** `docs/INSTALL.md` — `docs/SPEC.md` §5's module layout expects
  it (`docs/{SPEC.md, INSTALL.md, REVIEW.md}`); doesn't exist yet. `REVIEW.md`
  now exists (this stage's output).
- **`npm run bundle`** = `clean && build && package` — verified `build`
  works (exit 0, produces `dist/addon.js` at 29.78 kB / gzip 8.24 kB); did not
  run `bundle`/`package` myself (would create a zip artifact, out of scope for
  a read-only review) — Stage 6 should run it and fix M2 in the same pass.
- **Manifest content otherwise verified correct:** `id`, `main`,
  `contributes.routes`/`contributes.links.sidebar` (one route, one sidebar
  item, ids match `src/addon.tsx`'s `ctx.router.add`), `network.allowedHosts:
  ["api.ynab.com"]` (exact match to spec, only host referenced anywhere in
  `src/`), `hostDependencies` (matches `vite.config.ts`'s externalized list).
  Only `permissions` (B1) and `sdkVersion`/`minWealthfolioVersion` (M1) need
  attention.
- **Core logic needs no further work from Stage 6.** Idempotency, state-
  advance-only-on-success, the mapping table, the failure-model error
  taxonomy, and secrets/network handling were all independently traced and
  test-verified this stage (`docs/REVIEW.md` §3, §5, §6) — nothing there is
  blocking.
- **Known, accepted, unverifiable-without-a-live-host risks carried forward**
  (not blockers, just don't be surprised): `metadata` round-trip fidelity on
  a real `ctx.api.activities` implementation (the whole dedup mechanism rests
  on this, since the SDK has no `externalId` field at all — see
  `docs/REVIEW.md` finding 8 in the acceptance table); Radix `Select`
  dropdown open/select behavior in the real Wealthfolio shell (only
  jsdom-smoke-tested). A real `npm run dev:server` smoke test before tagging
  a release remains the open item both Stage 3 and Stage 4 flagged and this
  stage did not have tooling to close.
