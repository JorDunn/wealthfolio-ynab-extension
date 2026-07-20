// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Reconciliation logic for idempotent sync.
 * Maintains mapping between YNAB transaction IDs and Wealthfolio activity IDs.
 * Ensures running sync multiple times produces no duplicates.
 */

export interface TransactionIdMapping {
  ynabTransactionId: string;
  wealthfolioActivityId: string;
}

export interface ReconciliationState {
  lastKnowledgeOfServer: string | null;
  transactionIdMap: Map<string, string>;
}

/**
 * Reconciliation placeholder - to be implemented.
 */
export class Reconciler {
  private state: ReconciliationState;

  constructor(state: ReconciliationState) {
    this.state = state;
  }

  /**
   * Check if a YNAB transaction was already synced.
   */
  isAlreadySynced(ynabTransactionId: string): boolean {
    return this.state.transactionIdMap.has(ynabTransactionId);
  }

  /**
   * Record a new YNAB→Wealthfolio transaction mapping.
   */
  recordMapping(mapping: TransactionIdMapping): void {
    this.state.transactionIdMap.set(mapping.ynabTransactionId, mapping.wealthfolioActivityId);
  }
}
