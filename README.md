# wealthfolio-ynab-sync

A [Wealthfolio](https://wealthfolio.app) addon that syncs transactions from a
YNAB budget into mapped Wealthfolio cash accounts, so your Wealthfolio cash
balances and performance figures stay accurate without re-entering every
transaction by hand.

## What it does

- Reads transactions from a single YNAB budget via the YNAB API (delta
  requests only — it never re-fetches transactions it has already seen).
- Creates/updates matching cash **activities** (`DEPOSIT`, `WITHDRAWAL`,
  `TRANSFER_IN`, `TRANSFER_OUT`) on Wealthfolio accounts you explicitly map
  to YNAB accounts. Unmapped YNAB accounts are never read.
- Is **idempotent**: every synced activity carries the YNAB transaction id,
  and sync state only advances after a batch fully applies — running sync
  twice never creates duplicates.
- Keeps your YNAB personal access token out of Wealthfolio's addon storage
  and logs entirely; it's stored only through the SDK's encrypted secrets
  API, and the UI only ever shows whether a token exists, never its value.

## Screenshots

_placeholder — screenshots of the sync page (connection status, account
mapping, sync summary) go here once captured from a running instance._

## Scope & limitations

- **One-way sync, YNAB → Wealthfolio only.** Nothing is ever written back to
  YNAB; the YNAB API is used read-only.
- **Cash accounts only.** This addon does not touch investment activity
  (buys/sells/dividends/splits, quantities, or prices) — only cash inflows,
  outflows, and transfers between mapped accounts.
- **Manually triggered.** The addon runtime has no background scheduler;
  sync only runs when you click "Sync now" (see `docs/SPEC.md` §3.1 for the
  full rationale).
- **A single YNAB budget at a time.** Multi-budget support is out of scope
  for this version.
- Full design rationale and acceptance criteria live in `docs/SPEC.md`.

## YNAB token setup

1. In YNAB, go to **Account Settings → Developer Settings** and click **New
   Token** to generate a personal access token. Copy it — YNAB only shows it
   once.
2. Open the addon's sync page in Wealthfolio (sidebar → **YNAB Sync**).
3. Paste the token into the connection card and save. The addon stores it
   via Wealthfolio's secrets API (never in addon storage, never logged) and
   the UI switches to "Connected" once the token is verified against the
   YNAB API.
4. Pick the YNAB budget to sync from, then map each YNAB account you want
   synced to a Wealthfolio cash account in the mapping table. Unmapped YNAB
   accounts are ignored.
5. Click **Sync now**.

To revoke access, remove the token from the connection card (deletes it from
the secrets store) and/or delete the token in YNAB's Developer Settings.

## Installation

See [`docs/INSTALL.md`](docs/INSTALL.md) for installing this addon on a
self-hosted Wealthfolio Docker (web edition) instance, including the
dev-mode workflow and the upgrade path.

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev:server

# Build for production
npm run build

# Run tests
npm test -- --run

# Package addon
npm run bundle
```

## License

AGPL-3.0-only — Copyright Jordan Dunn / NodeTwo. See [`LICENSE`](LICENSE) for
the full text. For commercial licensing inquiries (use outside the terms of
the AGPL-3.0), contact [nodetwo.io](https://nodetwo.io).
