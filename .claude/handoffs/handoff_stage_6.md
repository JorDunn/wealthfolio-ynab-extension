# Stage 6 handoff — Package & install docs

## Artifact

`dist/wealthfolio-ynab-sync-addon-0.1.0.zip` (produced by `npm run bundle`),
containing `manifest.json`, `dist/addon.js`, `README.md`, `LICENSE`,
`CHANGELOG.md`. `dist/` is gitignored — rebuild with `npm run bundle` before
any release/publish step.

## Stage 5 findings — disposition

- **B1 (blocker, fixed, test-covered):** `manifest.json` `permissions` was
  an object map; changed to an array of `{ category, functions: string[],
  purpose }` matching `docs/SPEC.md` §6 verbatim. Confirmed against the
  SDK's own shipped `README.md` example (`node_modules/@wealthfolio/addon-sdk/README.md`),
  which also uses `functions: string[]` in manifest.json — note the SDK's
  strict `Permission` TS type (`permissions.d.ts`) declares
  `functions: FunctionPermission[]` (objects with `isDeclared`/`isDetected`),
  but that's the *installed/runtime* shape the host normalizes into; the
  *authored* manifest.json shape is the string-array form per the SDK's own
  docs and SPEC.md. New test: `tests/manifest.test.ts` (3 tests) — asserts
  `Array.isArray`, per-entry `category`/`functions[]`/`purpose` are
  non-empty strings, and the category set is exactly
  `accounts, activities, network, secrets`.
- **M1 (fixed):** `manifest.json` `sdkVersion`/`minWealthfolioVersion` bumped
  `3.6.1` → `3.6.2` to match the actually-installed SDK and `package.json`'s
  `^3.6.2` pin. Also bumped the stale `hostDependencies["@wealthfolio/addon-sdk"]`
  entry (`^3.6.1` → `^3.6.2`) for the same reason — same root cause, not
  called out separately in the review but directly adjacent.
- **M2 (fixed):** `package.json`'s `package` script now zips `LICENSE` and
  `CHANGELOG.md` alongside `manifest.json dist/ README.md`. Verified by
  unzipping the built artifact (see Evidence below).

## What else changed

- `CHANGELOG.md` `[0.1.0]` section rewritten from a generic "initial
  scaffolding" stub to reflect actual shipped functionality (sync engine,
  idempotency guarantees, YNAB client, mapping layer, reconciliation, state
  store, secrets handling, UI, manifest permission set, test suite). This is
  **not yet released** (no git tag, not published to npm) so editing it does
  not violate the release-please "don't hand-edit released changelog
  sections" rule.
- `README.md` expanded: what-it-does summary, screenshots placeholder,
  scope/limitations (one-way YNAB→Wealthfolio, cash accounts only, manual
  trigger, single budget), step-by-step YNAB token setup, install pointer to
  `docs/INSTALL.md`, and a License section naming AGPL-3.0-only + commercial
  licensing contact at nodetwo.io.
- `docs/INSTALL.md` written new (previously missing, expected by
  `docs/SPEC.md` §5). Covers: installing the packaged zip via Settings →
  Addons on the web edition; the `VITE_ENABLE_ADDON_DEV_MODE` + `npm run
  dev:server` dev-mode flow; where addon storage/secrets live relative to
  the host's persistent volume (commonly `/data` — flagged as
  deployment-dependent since I could not reach wealthfolio.app's live docs
  from this sandbox, no outbound network access — see Uncertain below);
  upgrade path (state/secrets persist across upgrades, permission changes
  re-trigger approval); uninstall notes.
- `LICENSE` (verbatim AGPL-3.0-only), `package.json`'s `license` field,
  `manifest.json`'s `license` field, and every `src/` file's SPDX header
  were **already present and correct** from a prior pass — verified, not
  re-done.

## Evidence

- `npm test -- --run` → `Test Files 9 passed (9)` / `Tests 85 passed (85)`,
  exit 0 (82 prior + 3 new `tests/manifest.test.ts`).
- `npm run type-check` (`tsc --noEmit`) → exit 0.
- `npm run build` → `dist/addon.js 29.78 kB │ gzip: 8.24 kB`, exit 0
  (matches Stage 5's figure — no core logic touched).
- `npm run bundle` (`clean && build && package`) → exit 0;
  `unzip -l dist/wealthfolio-ynab-sync-addon-0.1.0.zip` confirmed 6 entries:
  `manifest.json`, `dist/`, `dist/addon.js`, `README.md`, `LICENSE`,
  `CHANGELOG.md`.
- `python3 -m json.tool manifest.json` → valid JSON after the permissions
  shape edit.

## Install steps verified

Verified only the **build/package** side end-to-end (commands above and
artifact contents). The **install-into-a-running-Wealthfolio-instance** side
of `docs/INSTALL.md` (Settings → Addons upload flow, dev-mode connection,
actual `/data` volume path) is written from the SDK's shipped README
(`node_modules/@wealthfolio/addon-sdk/README.md`, "Install in Wealthfolio"
section) and CLAUDE.md/SPEC.md, **not** from a live self-hosted instance —
this sandbox has no outbound network access (`WebFetch`/`curl` to
wealthfolio.app both failed with a TLS cert error, no proxy available), so
I could not confirm the dev-server default port or the exact volume mount
path against current wealthfolio.app docs. `docs/INSTALL.md` flags these as
"confirm against your deployment" rather than asserting them as fact. A real
`npm run dev:server` smoke test against a live instance remains open (carried
forward from Stage 5).

## Remaining minor findings (deferred, from `docs/REVIEW.md` §2)

Not addressed this stage — out of scope for packaging/docs, no test
coverage requirement triggered, core logic untouched. See `docs/REVIEW.md`
§2 for the full list; nothing there blocks packaging or install docs.

## Carried-forward risks (unchanged from Stage 5)

- `metadata` round-trip fidelity on a real `ctx.api.activities`
  implementation — unverifiable without a live host.
- Radix `Select` behavior in the real shell (tests are jsdom-only).
- A real `npm run dev:server` smoke test against a live self-hosted instance
  before cutting a release — still open.
