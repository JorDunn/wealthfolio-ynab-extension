// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Storage schema for persisting sync state and user configuration.
 * Values stored via ctx.api.storage (string values, ≤250 KB total).
 */

export interface SyncStateSchema {
  lastKnowledgeOfServer: string | null;
  transactionIdMap: Record<string, string>;
  lastSyncTimestamp: number | null;
}

export interface AccountMappingSchema {
  [ynabAccountId: string]: string; // ynab account id -> wealthfolio account id
}

export interface UserConfigSchema {
  activebudgetId: string | null;
  autoSyncOnOpen: boolean;
  includeUnapproved: boolean;
  includeUncleared: boolean;
}

export interface BudgetStateSchema {
  syncState: SyncStateSchema;
  accountMappings: AccountMappingSchema;
  lastSyncError: string | null;
}

/**
 * Get the storage key for a budget's state.
 */
export function getBudgetStateKey(budgetId: string): string {
  return `budget:${budgetId}:state`;
}

/**
 * Get the storage key for user configuration.
 */
export function getUserConfigKey(): string {
  return 'user:config';
}
