// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect } from 'vitest';
import { Reconciler } from '../src/sync/reconcile';

describe('Reconciler', () => {
  it('should instantiate with state', () => {
    const reconciler = new Reconciler({
      lastKnowledgeOfServer: null,
      transactionIdMap: new Map(),
    });

    expect(reconciler).toBeDefined();
  });

  it('should detect unsynced transactions', () => {
    const reconciler = new Reconciler({
      lastKnowledgeOfServer: null,
      transactionIdMap: new Map(),
    });

    expect(reconciler.isAlreadySynced('txn-1')).toBe(false);
  });

  it('should detect already synced transactions', () => {
    const map = new Map<string, string>();
    map.set('txn-1', 'activity-1');

    const reconciler = new Reconciler({
      lastKnowledgeOfServer: null,
      transactionIdMap: map,
    });

    expect(reconciler.isAlreadySynced('txn-1')).toBe(true);
  });

  it('should record transaction mappings', () => {
    const reconciler = new Reconciler({
      lastKnowledgeOfServer: null,
      transactionIdMap: new Map(),
    });

    reconciler.recordMapping({
      ynabTransactionId: 'txn-1',
      wealthfolioActivityId: 'activity-1',
    });

    expect(reconciler.isAlreadySynced('txn-1')).toBe(true);
  });
});
