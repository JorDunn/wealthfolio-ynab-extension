// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect } from 'vitest';
import { buildKnownSet, knownSetToTransactionIdMap, type ActivitiesLookupAPI, type ActivityRecord } from '../src/sync/reconcile';
import type { TransactionIdMap } from '../src/state/schema';

function activitiesApiFor(byAccount: Record<string, ActivityRecord[]>): ActivitiesLookupAPI {
  return {
    getAll: async (accountId?: string) => (accountId ? byAccount[accountId] ?? [] : Object.values(byAccount).flat()),
  };
}

describe('buildKnownSet', () => {
  it('returns an empty set when there is no persisted map and no live activities', async () => {
    const known = await buildKnownSet({}, ['wf-checking'], activitiesApiFor({ 'wf-checking': [] }));
    expect(known.size).toBe(0);
  });

  it('includes persisted-map entries not (yet) seen in the live scan', async () => {
    const persisted: TransactionIdMap = { 'txn-1': { wealthfolioActivityId: 'activity-1', orphaned: false } };
    const known = await buildKnownSet(persisted, ['wf-checking'], activitiesApiFor({ 'wf-checking': [] }));

    expect(known.get('txn-1')).toEqual({ wealthfolioActivityId: 'activity-1', orphaned: false });
    expect(known.get('txn-1')?.snapshot).toBeUndefined();
  });

  it('discovers activities via a live scan even when the persisted map is empty (partial-failure recovery path)', async () => {
    const known = await buildKnownSet(
      {},
      ['wf-checking'],
      activitiesApiFor({
        'wf-checking': [
          { id: 'activity-1', accountId: 'wf-checking', metadata: { source: 'ynab', ynabTransactionId: 'txn-1' } },
        ],
      }),
    );

    expect(known.get('txn-1')?.wealthfolioActivityId).toBe('activity-1');
    expect(known.get('txn-1')?.orphaned).toBe(false);
  });

  it('carries a full snapshot of the live activity for entries discovered via the live scan (needed to rebuild a full update payload when orphan-flagging)', async () => {
    const known = await buildKnownSet(
      {},
      ['wf-checking'],
      activitiesApiFor({
        'wf-checking': [
          {
            id: 'activity-1',
            accountId: 'wf-checking',
            activityType: 'WITHDRAWAL',
            activityDate: '2026-07-15',
            amount: '25.5',
            currency: 'USD',
            comment: 'Groceries',
            metadata: { source: 'ynab', ynabTransactionId: 'txn-1' },
          },
        ],
      }),
    );

    expect(known.get('txn-1')?.snapshot).toEqual({
      accountId: 'wf-checking',
      activityType: 'WITHDRAWAL',
      activityDate: '2026-07-15',
      amount: '25.5',
      currency: 'USD',
      comment: 'Groceries',
      metadata: { source: 'ynab', ynabTransactionId: 'txn-1' },
    });
  });

  it('the live scan wins over a stale persisted entry for the same YNAB transaction id', async () => {
    const persisted: TransactionIdMap = { 'txn-1': { wealthfolioActivityId: 'stale-activity-id', orphaned: false } };
    const known = await buildKnownSet(
      persisted,
      ['wf-checking'],
      activitiesApiFor({
        'wf-checking': [
          { id: 'fresh-activity-id', accountId: 'wf-checking', metadata: { source: 'ynab', ynabTransactionId: 'txn-1' } },
        ],
      }),
    );

    expect(known.get('txn-1')?.wealthfolioActivityId).toBe('fresh-activity-id');
  });

  it('ignores activities from other addons/sources (no metadata, or metadata.source !== "ynab")', async () => {
    const known = await buildKnownSet(
      {},
      ['wf-checking'],
      activitiesApiFor({
        'wf-checking': [
          { id: 'manual-activity', accountId: 'wf-checking' },
          { id: 'other-addon-activity', accountId: 'wf-checking', metadata: { source: 'some-other-importer', ynabTransactionId: 'txn-9' } },
        ],
      }),
    );

    expect(known.size).toBe(0);
  });

  it('scans every mapped account, not just one', async () => {
    const known = await buildKnownSet(
      {},
      ['wf-checking', 'wf-savings'],
      activitiesApiFor({
        'wf-checking': [{ id: 'activity-1', accountId: 'wf-checking', metadata: { source: 'ynab', ynabTransactionId: 'txn-1' } }],
        'wf-savings': [{ id: 'activity-2', accountId: 'wf-savings', metadata: { source: 'ynab', ynabTransactionId: 'txn-2' } }],
      }),
    );

    expect(known.get('txn-1')?.wealthfolioActivityId).toBe('activity-1');
    expect(known.get('txn-2')?.wealthfolioActivityId).toBe('activity-2');
  });

  it('marks an entry orphaned when the live activity carries metadata.ynabDeleted', async () => {
    const known = await buildKnownSet(
      {},
      ['wf-checking'],
      activitiesApiFor({
        'wf-checking': [
          { id: 'activity-1', accountId: 'wf-checking', metadata: { source: 'ynab', ynabTransactionId: 'txn-1', ynabDeleted: true } },
        ],
      }),
    );

    expect(known.get('txn-1')?.orphaned).toBe(true);
  });

  it('deduplicates mapped account ids before scanning (no double getAll for the same account)', async () => {
    let calls = 0;
    const api: ActivitiesLookupAPI = {
      getAll: async () => {
        calls += 1;
        return [];
      },
    };
    await buildKnownSet({}, ['wf-checking', 'wf-checking'], api);
    expect(calls).toBe(1);
  });
});

describe('knownSetToTransactionIdMap', () => {
  it('round-trips a known set back to the persisted-map shape', () => {
    const map = new Map([
      ['txn-1', { wealthfolioActivityId: 'activity-1', orphaned: false }],
      ['txn-2', { wealthfolioActivityId: 'activity-2', orphaned: true }],
    ]);

    expect(knownSetToTransactionIdMap(map)).toEqual({
      'txn-1': { wealthfolioActivityId: 'activity-1', orphaned: false },
      'txn-2': { wealthfolioActivityId: 'activity-2', orphaned: true },
    });
  });
});
