// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Storage schema for persisting sync state and user configuration.
 * Values stored via `ctx.api.storage` (string values, ~250 KB ceiling per
 * key — see docs/SPEC.md §8 open question 4). Keys must match
 * `[A-Za-z0-9_.:-]{1,128}` and encode their scope (e.g. `budget:{id}:state`).
 *
 * Deviation note (Stage 3): the Stage 2 stub typed
 * `lastKnowledgeOfServer` as `string | null` and `transactionIdMap` as a
 * flat `Record<string, string>`. Two fixes:
 *  - YNAB's `server_knowledge` delta cursor is a **number**, not a string
 *    (see src/ynab/types.ts `YnabTransactionsData.server_knowledge`).
 *  - The id-map needs an `orphaned` bit per entry so a YNAB-side delete,
 *    once orphan-flagged (spec §3.4), is never re-flagged or recreated on a
 *    later sync — a bare `string` value can't carry that.
 */

/** One entry in the YNAB-txn-id -> Wealthfolio-activity-id map. */
export interface TransactionMapEntry {
  wealthfolioActivityId: string;
  /** True once the mapped activity has been comment/metadata orphan-flagged after a YNAB-side delete (spec §3.4). Never auto-deleted. */
  orphaned: boolean;
}

/** ynabTransactionId -> map entry. */
export type TransactionIdMap = Record<string, TransactionMapEntry>;

export interface SyncStateSchema {
  /** YNAB delta cursor (`server_knowledge`). Advances only after a full-batch success (CLAUDE.md hard rule). */
  lastKnowledgeOfServer: number | null;
  transactionIdMap: TransactionIdMap;
  lastSyncTimestamp: number | null;
}

/** ynabAccountId -> wealthfolioAccountId. Absence = unmapped = ignored (spec §3.2). */
export interface AccountMappingSchema {
  [ynabAccountId: string]: string;
}

export interface UserConfigSchema {
  activeBudgetId: string | null;
  autoSyncOnOpen: boolean;
  includeUnapproved: boolean;
  includeUncleared: boolean;
}

export interface BudgetStateSchema {
  syncState: SyncStateSchema;
  accountMappings: AccountMappingSchema;
  lastSyncError: string | null;
}

/** Get the storage key for a budget's state. */
export function getBudgetStateKey(budgetId: string): string {
  return `budget:${budgetId}:state`;
}

/** Get the storage key for user configuration. */
export function getUserConfigKey(): string {
  return 'user:config';
}
