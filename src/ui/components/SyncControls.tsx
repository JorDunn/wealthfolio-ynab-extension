// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * "Sync now" button + last-sync summary (docs/SPEC.md §3.6 items 4-5).
 * Purely a display + click-wiring component — `useSync.triggerSync`
 * constructs a fresh `SyncEngine` per click and owns all engine state.
 */

import { Loader2 } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@wealthfolio/ui';
import type { SyncSummary } from '../../sync/engine';

export interface SyncControlsProps {
  isSyncing: boolean;
  disabled?: boolean;
  lastSyncTimestamp: number | null;
  summary: SyncSummary | null;
  onSync: () => Promise<void>;
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString();
}

export function SyncControls({ isSyncing, disabled, lastSyncTimestamp, summary, onSync }: SyncControlsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync</CardTitle>
        <CardDescription>
          {lastSyncTimestamp
            ? `Last synced ${formatTimestamp(lastSyncTimestamp)}`
            : 'Never synced yet.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={() => void onSync()} disabled={disabled || isSyncing}>
          {isSyncing ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Syncing…
            </>
          ) : (
            'Sync now'
          )}
        </Button>

        {summary && summary.success && (
          <div className="flex flex-wrap gap-2" data-testid="sync-summary-counts">
            <Badge variant="success">Created {summary.created}</Badge>
            <Badge variant="secondary">Updated {summary.updated}</Badge>
            <Badge variant="secondary">Skipped {summary.skipped}</Badge>
            {summary.orphaned > 0 && <Badge variant="warning">Orphaned {summary.orphaned}</Badge>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
