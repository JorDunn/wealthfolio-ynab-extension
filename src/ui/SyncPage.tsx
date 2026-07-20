// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import type { AddonContext } from '@wealthfolio/addon-sdk';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@wealthfolio/ui';

/**
 * Main UI component for the YNAB sync addon.
 * Displays: status, token entry, budget selector, account mappings, sync button, and error log.
 */

export interface SyncPageProps {
  ctx: AddonContext;
}

export function SyncPage({ ctx }: SyncPageProps) {
  return (
    <div className="space-y-6 p-6">
      <Card>
        <CardHeader>
          <CardTitle>YNAB Sync</CardTitle>
          <CardDescription>
            Sync transactions from YNAB into Wealthfolio cash accounts
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Configure your YNAB personal access token and account mappings to begin syncing transactions.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
