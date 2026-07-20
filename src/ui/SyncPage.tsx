// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Main UI component for the YNAB sync addon (docs/SPEC.md §3.6).
 * Displays: connection status + token entry, budget selector, account
 * mapping table, sync settings, "Sync now" + last-sync summary, and the
 * error/warning log. All logic lives in `useSync`; this component is a thin
 * layout shell.
 */

import type { AddonContext } from '@wealthfolio/addon-sdk';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wealthfolio/ui';
import { useSync } from './useSync';
import { ConnectionStatusCard } from './components/ConnectionStatusCard';
import { BudgetSelector } from './components/BudgetSelector';
import { AccountMappingTable } from './components/AccountMappingTable';
import { SyncSettings } from './components/SyncSettings';
import { SyncControls } from './components/SyncControls';
import { ErrorLog } from './components/ErrorLog';

export interface SyncPageProps {
  ctx: AddonContext;
}

export function SyncPage({ ctx }: SyncPageProps) {
  const sync = useSync(ctx);

  const hasMappedAccount = Object.keys(sync.accountMapping).length > 0;

  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>YNAB Sync</CardTitle>
          <CardDescription>
            Sync transactions from YNAB into Wealthfolio cash accounts
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Connect your YNAB budget, map YNAB accounts to Wealthfolio cash accounts, and sync
            on demand. This is a one-way import — nothing is ever written back to YNAB.
          </p>
        </CardContent>
      </Card>

      <ConnectionStatusCard
        status={sync.connectionStatus}
        connectionError={sync.connectionError}
        busy={sync.isLoading}
        onSaveToken={sync.saveToken}
        onRemoveToken={sync.removeToken}
      />

      {sync.connectionStatus === 'connected' && (
        <>
          <BudgetSelector
            budgets={sync.budgets}
            activeBudgetId={sync.activeBudgetId}
            disabled={sync.isLoading}
            onSelect={sync.selectBudget}
          />

          {sync.activeBudgetId && (
            <>
              <AccountMappingTable
                ynabAccounts={sync.ynabAccounts}
                wealthfolioAccounts={sync.wealthfolioAccounts}
                mapping={sync.accountMapping}
                disabled={sync.isLoading || sync.isSyncing}
                onChange={sync.setAccountMapping}
              />

              <SyncSettings
                includeUnapproved={sync.includeUnapproved}
                includeUncleared={sync.includeUncleared}
                disabled={sync.isLoading || sync.isSyncing}
                onChangeIncludeUnapproved={sync.setIncludeUnapproved}
                onChangeIncludeUncleared={sync.setIncludeUncleared}
              />

              <SyncControls
                isSyncing={sync.isSyncing}
                disabled={sync.isLoading || !hasMappedAccount}
                lastSyncTimestamp={sync.lastSyncTimestamp}
                summary={sync.lastSyncSummary}
                onSync={sync.triggerSync}
              />

              <ErrorLog persistedError={sync.persistedError} summary={sync.lastSyncSummary} />
            </>
          )}
        </>
      )}
    </div>
  );
}
