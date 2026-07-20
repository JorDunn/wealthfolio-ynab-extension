// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Error log + warnings (docs/SPEC.md §3.6 item 6, §3.7 failure model).
 * `summary.errorKind` drives the copy per the Stage 3 handoff's table
 * (.claude/handoffs/handoff_stage_3.md §3); `persistedError` is
 * `BudgetStateSchema.lastSyncError`, shown when no summary exists yet this
 * session (i.e. right after a reload) so the error survives navigation.
 */

import { Alert, AlertDescription, AlertTitle } from '@wealthfolio/ui';
import type { SyncSummary } from '../../sync/engine';

export interface ErrorLogProps {
  persistedError: string | null;
  summary: SyncSummary | null;
}

function friendlyErrorMessage(summary: SyncSummary): string {
  switch (summary.errorKind) {
    case 'invalid_token':
      return 'Invalid token — re-enter your YNAB personal access token.';
    case 'rate_limited':
      return `Rate-limited by YNAB — retry after ${summary.retryAfterSeconds ?? 3600}s.`;
    case 'network':
      return 'Cannot reach api.ynab.com — check your connection and retry.';
    case 'partial_batch':
    case 'unknown':
    default:
      return summary.errors[0] ?? 'Sync failed for an unknown reason.';
  }
}

export function ErrorLog({ persistedError, summary }: ErrorLogProps) {
  const hasCurrentError = summary !== null && !summary.success;
  const hasWarnings = summary !== null && summary.warnings.length > 0;

  if (!hasCurrentError && !hasWarnings && !persistedError) {
    return null;
  }

  return (
    <div className="space-y-3">
      {hasCurrentError && summary && (
        <Alert variant="destructive">
          <AlertTitle>Sync failed</AlertTitle>
          <AlertDescription>{friendlyErrorMessage(summary)}</AlertDescription>
        </Alert>
      )}
      {!hasCurrentError && persistedError && (
        <Alert variant="destructive">
          <AlertTitle>Last sync error</AlertTitle>
          <AlertDescription>{persistedError}</AlertDescription>
        </Alert>
      )}
      {hasWarnings && summary && (
        <Alert variant="warning">
          <AlertTitle>Warnings</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {summary.warnings.map((warning, index) => (
                // Warnings are plain, non-reorderable strings from one sync run — index is a stable key here.
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
