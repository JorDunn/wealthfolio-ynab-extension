<!--
SPDX-License-Identifier: AGPL-3.0-only
Copyright (C) 2026 Jordan Dunn / NodeTwo
-->

# Install guide — self-hosted Wealthfolio Docker (web edition)

This addon targets the **self-hosted Wealthfolio Docker deployment, web
edition** (addon SDK 3.6.2+, sandboxed-iframe runtime). It is not written or
tested against the desktop (Tauri) build.

There are two ways to run it against a self-hosted instance: the **dev-mode
flow** (live-reloading, for development/testing against your own instance)
and **installing the packaged build** (the normal path for end users).

---

## 1. Installing the packaged build (recommended for normal use)

1. Build the distributable zip from this repo:
   ```bash
   npm install
   npm run bundle   # clean && build && package
   ```
   This produces `dist/wealthfolio-ynab-sync-addon-<version>.zip`, containing
   `manifest.json`, `dist/addon.js`, `README.md`, `LICENSE`, and
   `CHANGELOG.md`.
2. In your browser, open your self-hosted Wealthfolio web instance and sign
   in.
3. Go to **Settings → Addons**.
4. Click **Install Addon** and select the zip from step 1.
5. Review the requested permissions (accounts: `getAll`; activities:
   `getAll`/`search`/`create`/`update`; network: `request` scoped to
   `api.ynab.com` only; secrets: `set`/`get`/`delete`) and approve.
6. Restart/reload the Wealthfolio web app if prompted, so the addon runtime
   picks it up.
7. **YNAB Sync** appears in the sidebar. Follow the *YNAB token setup* steps
   in the repo `README.md` to connect a budget and map accounts.

Because this is the web edition, the addon zip is uploaded through the
browser UI — there's no addon directory on the container filesystem you need
to touch by hand.

---

## 2. Dev-mode flow (live addon dev server)

Use this when developing or testing changes against a real self-hosted
instance instead of the packaged zip.

1. Start (or restart) the Wealthfolio web container with addon dev mode
   enabled — set the `VITE_ENABLE_ADDON_DEV_MODE=true` environment variable
   on the Wealthfolio web container/service (e.g. in your `docker-compose`
   file's `environment:` block for the Wealthfolio service, or via
   `docker run -e VITE_ENABLE_ADDON_DEV_MODE=true ...`). This flag gates a
   dev-mode UI in Settings → Addons that lets the app connect to a local
   addon dev server instead of only accepting uploaded zips.
2. In this repo, run the addon dev server:
   ```bash
   npm run dev:server   # wealthfolio-addon dev
   ```
   This serves the manifest and built addon bundle with hot reload (health
   check, manifest, and built-file endpoints — see
   `@wealthfolio/addon-dev-tools`).
3. In the Wealthfolio web UI, go to **Settings → Addons**, use the dev-mode
   connection option, and point it at the dev server's address (default
   `http://localhost:5173` unless configured otherwise — confirm the actual
   port/host printed by `npm run dev:server` in your environment, since the
   dev-tools server picks an available port).
4. Edits under `src/` rebuild automatically; reload the addon in the
   Wealthfolio UI to pick up changes without reinstalling a zip.

Dev mode is for testing only — do not leave `VITE_ENABLE_ADDON_DEV_MODE=true`
set on a production instance you don't control, since it changes what the
addon UI will accept.

---

## 3. Where addon data and secrets live

Addon code never touches the container filesystem directly — all persistence
goes through the Wealthfolio host APIs (`ctx.api.storage` and
`ctx.api.secrets`), which the host implements as part of its own backing
store. For a self-hosted Docker deployment, that means:

- Whatever volume you mount for Wealthfolio's own persistent data (commonly
  a `/data` volume mount in the container, holding the application database
  and configuration — check your specific `docker-compose.yml`/deployment
  for the exact mount point) is also where this addon's persisted state
  lives: the sync cursor (`last_knowledge_of_server`), the YNAB
  transaction-id → Wealthfolio activity-id map, account mappings, and sync
  settings (via `ctx.api.storage`), and the encrypted YNAB personal access
  token (via `ctx.api.secrets`, encrypted and scoped to this addon's id).
- **Back up that volume** before upgrading Wealthfolio itself or this addon,
  the same way you'd back up any other Wealthfolio data — addon storage and
  secrets are not stored anywhere separate from the rest of the app's data.
- The addon never writes files of its own outside of these host-managed
  APIs, and never uses `localStorage`/`sessionStorage` (both throw inside
  the addon's sandboxed iframe).

If your deployment's volume layout differs from the common `/data`
convention, the same principle holds: addon storage/secrets live wherever
Wealthfolio's own application data lives, not in a separate location.

---

## 4. Upgrading

1. Pull/build the new version of this addon (`npm run bundle` against the
   updated source, or download the new release zip).
2. In **Settings → Addons**, install the new zip over the existing addon (or
   use the app's addon-update flow if the version differs from what's
   installed — Wealthfolio compares `manifest.json` versions and treats a
   higher version as an update rather than a fresh permission-approval
   flow, though a **permission-set change** — e.g. a new `permissions`
   entry — re-triggers the approval/review step).
3. Sync state, account mappings, and the stored YNAB token are **not**
   reset by an addon upgrade — they persist via `ctx.api.storage` /
   `ctx.api.secrets` exactly as described in §3 above, keyed by this
   addon's id. No re-authentication or re-mapping is needed after a normal
   version bump.
4. If a release changes the manifest's `permissions` array (see
   `CHANGELOG.md`), you'll be asked to review and re-approve the new
   permission set on install — this is expected and is not addon data loss.
5. Confirm the sidebar's **YNAB Sync** page still shows "Connected" and that
   account mappings are intact after upgrading; if not, treat it as a bug
   and check `docs/REVIEW.md` / open an issue rather than re-entering the
   token, since the token should have carried over.

---

## Uninstalling

Removing the addon from **Settings → Addons** removes its code and its
manifest registration. Depending on the host version, this may or may not
also delete its `ctx.api.storage`/`ctx.api.secrets` data — if you plan to
reinstall later and want a clean slate, explicitly remove the YNAB token
from the connection card first (see the repo `README.md`) before
uninstalling.
