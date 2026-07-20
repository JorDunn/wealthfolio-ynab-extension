// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect } from 'vitest';
import { StateStore, type StorageAPI } from '../src/state/store';
import type { BudgetStateSchema, UserConfigSchema } from '../src/state/schema';

function mockStorage(initial: Record<string, string> = {}): StorageAPI {
  const data = new Map(Object.entries(initial));
  return {
    get: async (key: string) => data.get(key) ?? null,
    set: async (key: string, value: string) => {
      data.set(key, value);
    },
    delete: async (key: string) => {
      data.delete(key);
    },
  };
}

describe('StateStore', () => {
  it('instantiates with a storage API', () => {
    const store = new StateStore(mockStorage());
    expect(store).toBeDefined();
  });

  it('returns null for a budget with no persisted state', async () => {
    const store = new StateStore(mockStorage());
    const state = await store.getBudgetState('unknown-budget');
    expect(state).toBeNull();
  });

  it('returns null for missing user config', async () => {
    const store = new StateStore(mockStorage());
    const config = await store.getUserConfig();
    expect(config).toBeNull();
  });

  it('round-trips a budget state with a numeric cursor and a per-entry orphaned flag', async () => {
    const store = new StateStore(mockStorage());
    const state: BudgetStateSchema = {
      syncState: {
        lastKnowledgeOfServer: 42,
        transactionIdMap: {
          'txn-1': { wealthfolioActivityId: 'activity-1', orphaned: false },
          'txn-2': { wealthfolioActivityId: 'activity-2', orphaned: true },
        },
        lastSyncTimestamp: 1_700_000_000_000,
      },
      accountMappings: { 'ynab-checking': 'wf-checking' },
      lastSyncError: null,
    };

    await store.setBudgetState('budget-1', state);
    const roundTripped = await store.getBudgetState('budget-1');

    expect(roundTripped).toEqual(state);
  });

  it('scopes state storage per budget id', async () => {
    const storage = mockStorage();
    const store = new StateStore(storage);
    const stateA: BudgetStateSchema = {
      syncState: { lastKnowledgeOfServer: 1, transactionIdMap: {}, lastSyncTimestamp: null },
      accountMappings: {},
      lastSyncError: null,
    };
    const stateB: BudgetStateSchema = {
      syncState: { lastKnowledgeOfServer: 2, transactionIdMap: {}, lastSyncTimestamp: null },
      accountMappings: {},
      lastSyncError: null,
    };

    await store.setBudgetState('budget-a', stateA);
    await store.setBudgetState('budget-b', stateB);

    expect((await store.getBudgetState('budget-a'))?.syncState.lastKnowledgeOfServer).toBe(1);
    expect((await store.getBudgetState('budget-b'))?.syncState.lastKnowledgeOfServer).toBe(2);
  });

  it('round-trips user configuration', async () => {
    const store = new StateStore(mockStorage());
    const config: UserConfigSchema = {
      activeBudgetId: 'budget-1',
      autoSyncOnOpen: false,
      includeUnapproved: true,
      includeUncleared: false,
    };

    await store.setUserConfig(config);

    expect(await store.getUserConfig()).toEqual(config);
  });

  it('treats malformed persisted JSON as absent state rather than throwing', async () => {
    const store = new StateStore(mockStorage({ 'budget:broken:state': '{not json' }));
    await expect(store.getBudgetState('broken')).resolves.toBeNull();
  });
});
