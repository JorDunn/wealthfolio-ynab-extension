// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Core sync engine for orchestrating YNAB→Wealthfolio transaction imports.
 * Handles: budget selection, account mapping, transaction filtering, and batch writes.
 * Ensures idempotency via external IDs and cursor advancement.
 */

export interface SyncState {
  lastKnowledgeOfServer: string | null;
  knownTransactionIds: Set<string>;
}

export interface SyncResult {
  success: boolean;
  createdActivities: number;
  updatedActivities: number;
  warnings: string[];
  errors: string[];
}

/**
 * Sync engine placeholder - to be implemented with full logic.
 */
export class SyncEngine {
  /**
   * Execute a full sync cycle.
   */
  async sync(): Promise<SyncResult> {
    return {
      success: true,
      createdActivities: 0,
      updatedActivities: 0,
      warnings: [],
      errors: [],
    };
  }
}
