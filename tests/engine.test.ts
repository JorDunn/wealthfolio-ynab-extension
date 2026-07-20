// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect } from 'vitest';
import {
  SyncEngine,
  type ActivityWriteInput,
  type EngineActivitiesAPI,
  type SyncEngineConfig,
  type TransactionsFetcher,
  type WrittenActivity,
} from '../src/sync/engine';
import { StateStore, type StorageAPI } from '../src/state/store';
import { WealthfolioActivityType } from '../src/sync/mapping';
import type { ActivityRecord } from '../src/sync/reconcile';
import type { YnabTransaction } from '../src/ynab/types';
import { InvalidTokenError, RateLimitError, NetworkError } from '../src/errors';
import rawTransactionsFixture from './fixtures/transactions.json';

const transactionsFixture = rawTransactionsFixture as unknown as YnabTransaction[];

const FIXED_NOW = 1_753_000_000_000;

const BASE_CONFIG: SyncEngineConfig = {
  budgetId: 'budget-1',
  budgetCurrency: 'USD',
  accountMapping: {
    'ynab-checking': 'wf-checking',
    'ynab-savings': 'wf-savings',
  },
  includeUnapproved: false,
  includeUncleared: false,
};

function mockStorage(): StorageAPI {
  const data = new Map<string, string>();
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

/** A fetcher whose responses are pre-scripted per call (last response repeats once exhausted). */
function scriptedFetcher(
  responses: Array<{ transactions: YnabTransaction[]; serverKnowledge: number }>,
): TransactionsFetcher {
  let call = 0;
  return {
    getTransactions: async () => {
      const response = responses[Math.min(call, responses.length - 1)];
      call += 1;
      return response;
    },
  };
}

/** A fetcher that always returns the same page, ignoring the cursor — the strongest test of engine-side dedup (spec §3.4). */
function fixedFetcher(transactions: YnabTransaction[], serverKnowledge = 100): TransactionsFetcher {
  return scriptedFetcher([{ transactions, serverKnowledge }]);
}

function throwingFetcher(err: unknown): TransactionsFetcher {
  return {
    getTransactions: async () => {
      throw err;
    },
  };
}

interface MockActivitiesApi extends EngineActivitiesAPI {
  records: Map<string, ActivityRecord>;
  createCallCount: number;
}

/** In-memory stand-in for the host's `ctx.api.activities` (only getAll/create/update — the manifest's declared functions). */
function createMockActivitiesApi(opts: { failCreateOnCallNumber?: number } = {}): MockActivitiesApi {
  const records = new Map<string, ActivityRecord>();
  let nextId = 1;
  let createCallCount = 0;

  function toRecord(id: string, input: ActivityWriteInput): ActivityRecord {
    return {
      id,
      accountId: input.accountId,
      activityType: input.activityType,
      activityDate: input.activityDate,
      amount: input.amount ?? null,
      currency: input.currency,
      comment: input.comment ?? undefined,
      metadata: typeof input.metadata === 'string' ? (JSON.parse(input.metadata) as Record<string, unknown>) : input.metadata,
    };
  }

  return {
    records,
    get createCallCount() {
      return createCallCount;
    },
    async getAll(accountId?: string): Promise<ActivityRecord[]> {
      const all = Array.from(records.values());
      return accountId ? all.filter((a) => a.accountId === accountId) : all;
    },
    async create(input: ActivityWriteInput): Promise<WrittenActivity> {
      createCallCount += 1;
      if (opts.failCreateOnCallNumber !== undefined && createCallCount === opts.failCreateOnCallNumber) {
        throw new Error('simulated create failure');
      }
      const id = `activity-${nextId++}`;
      records.set(id, toRecord(id, input));
      return { id };
    },
    async update(input: ActivityWriteInput & { id: string }): Promise<WrittenActivity> {
      const existing = records.get(input.id);
      if (!existing) {
        throw new Error(`update: no such activity ${input.id}`);
      }
      records.set(input.id, toRecord(input.id, input));
      return { id: input.id };
    },
  };
}

function baseTxn(overrides: Partial<YnabTransaction> = {}): YnabTransaction {
  return {
    id: 'txn-solo',
    date: '2026-07-10',
    amount: 40000,
    memo: 'Solo txn',
    cleared: 'cleared',
    approved: true,
    flag_color: null,
    account_id: 'ynab-checking',
    account_name: 'Checking',
    payee_id: null,
    payee_name: null,
    category_id: null,
    category_name: null,
    transfer_account_id: null,
    transfer_transaction_id: null,
    matched_transaction_id: null,
    import_id: null,
    deleted: false,
    subtransactions: [],
    ...overrides,
  };
}

function activityByTxnId(records: Map<string, ActivityRecord>, ynabTxnId: string): ActivityRecord | undefined {
  return Array.from(records.values()).find((a) => a.metadata?.ynabTransactionId === ynabTxnId);
}

describe('SyncEngine — first sync over the fixture budget', () => {
  it('maps every scenario in the fixture correctly and creates exactly one activity per eligible transaction', async () => {
    const activitiesApi = createMockActivitiesApi();
    const stateStore = new StateStore(mockStorage());
    const engine = new SyncEngine({
      ynabClient: fixedFetcher(transactionsFixture, 111),
      activitiesApi,
      stateStore,
      config: BASE_CONFIG,
      now: () => FIXED_NOW,
    });

    const summary = await engine.sync();

    expect(summary.success).toBe(true);
    expect(summary.created).toBe(5);
    expect(summary.updated).toBe(0);
    expect(summary.skipped).toBe(0);
    expect(summary.orphaned).toBe(0);
    expect(activitiesApi.records.size).toBe(5);

    expect(activityByTxnId(activitiesApi.records, 'txn-deposit')?.activityType).toBe(WealthfolioActivityType.DEPOSIT);
    expect(activityByTxnId(activitiesApi.records, 'txn-withdrawal')?.activityType).toBe(WealthfolioActivityType.WITHDRAWAL);
    expect(activityByTxnId(activitiesApi.records, 'txn-transfer-out')?.activityType).toBe(WealthfolioActivityType.TRANSFER_OUT);
    expect(activityByTxnId(activitiesApi.records, 'txn-transfer-in')?.activityType).toBe(WealthfolioActivityType.TRANSFER_IN);
    expect(activityByTxnId(activitiesApi.records, 'txn-transfer-unmapped-counterpart')?.activityType).toBe(
      WealthfolioActivityType.WITHDRAWAL,
    );

    for (const activity of activitiesApi.records.values()) {
      expect(activity.metadata?.source).toBe('ynab');
      expect(typeof activity.metadata?.ynabTransactionId).toBe('string');
    }

    const persisted = await stateStore.getBudgetState('budget-1');
    expect(persisted?.syncState.lastKnowledgeOfServer).toBe(111);
    expect(persisted?.syncState.lastSyncTimestamp).toBe(FIXED_NOW);
    expect(Object.keys(persisted?.syncState.transactionIdMap ?? {})).toHaveLength(5);
  });

  it('MANDATORY: running sync twice on the same fixtures creates zero new activities the second time (spec §7 idempotency)', async () => {
    const activitiesApi = createMockActivitiesApi();
    const stateStore = new StateStore(mockStorage());
    // Same fetcher instance ignores the cursor and returns the identical full
    // page both times — the strongest version of this test, since dedup must
    // come from the engine's known-set logic, not from YNAB's delta filtering.
    const ynabClient = fixedFetcher(transactionsFixture, 111);
    const engine = new SyncEngine({ ynabClient, activitiesApi, stateStore, config: BASE_CONFIG, now: () => FIXED_NOW });

    const first = await engine.sync();
    expect(first.created).toBe(5);
    expect(activitiesApi.records.size).toBe(5);

    const second = await engine.sync();

    expect(second.success).toBe(true);
    expect(second.created).toBe(0);
    expect(activitiesApi.records.size).toBe(5);
  });
});

describe('SyncEngine — YNAB edit', () => {
  it('updates the existing Wealthfolio activity instead of creating a duplicate when a YNAB transaction is edited', async () => {
    const activitiesApi = createMockActivitiesApi();
    const stateStore = new StateStore(mockStorage());
    const original = baseTxn({ id: 'txn-edit', amount: -20000, memo: 'Original memo' });
    const edited = baseTxn({ id: 'txn-edit', amount: -25000, memo: 'Edited memo' });

    const engine = new SyncEngine({
      ynabClient: scriptedFetcher([
        { transactions: [original], serverKnowledge: 1 },
        { transactions: [edited], serverKnowledge: 2 },
      ]),
      activitiesApi,
      stateStore,
      config: BASE_CONFIG,
      now: () => FIXED_NOW,
    });

    const first = await engine.sync();
    expect(first.created).toBe(1);
    const activityId = activityByTxnId(activitiesApi.records, 'txn-edit')?.id;
    expect(activityId).toBeDefined();

    const second = await engine.sync();

    expect(second.created).toBe(0);
    expect(second.updated).toBe(1);
    expect(activitiesApi.records.size).toBe(1);
    const updatedActivity = activitiesApi.records.get(activityId!);
    expect(updatedActivity?.amount).toBe(25);
    expect(updatedActivity?.comment).toBe('Edited memo');
  });
});

describe('SyncEngine — YNAB delete (orphan-flag, never auto-delete)', () => {
  it('flags the matching activity (comment + metadata.ynabDeleted) instead of deleting it, and reports it in warnings', async () => {
    const activitiesApi = createMockActivitiesApi();
    const stateStore = new StateStore(mockStorage());
    const live = baseTxn({ id: 'txn-delete-me', amount: -5000, date: '2026-07-11' });
    const tombstone = baseTxn({ id: 'txn-delete-me', deleted: true });

    const engine = new SyncEngine({
      ynabClient: scriptedFetcher([
        { transactions: [live], serverKnowledge: 1 },
        { transactions: [tombstone], serverKnowledge: 2 },
      ]),
      activitiesApi,
      stateStore,
      config: BASE_CONFIG,
      now: () => FIXED_NOW,
    });

    await engine.sync();
    const activityId = activityByTxnId(activitiesApi.records, 'txn-delete-me')?.id;
    expect(activityId).toBeDefined();

    const second = await engine.sync();

    expect(second.success).toBe(true);
    expect(second.orphaned).toBe(1);
    expect(second.warnings.some((w) => w.includes('txn-delete-me'))).toBe(true);
    // Never deleted — still present, same id, just flagged.
    expect(activitiesApi.records.has(activityId!)).toBe(true);
    const flagged = activitiesApi.records.get(activityId!);
    expect(flagged?.metadata?.ynabDeleted).toBe(true);
    expect(flagged?.comment).toContain('[ynab:deleted');
  });

  it('does not re-flag or duplicate-warn an already orphan-flagged activity on a later sync', async () => {
    const activitiesApi = createMockActivitiesApi();
    const stateStore = new StateStore(mockStorage());
    const live = baseTxn({ id: 'txn-delete-twice', amount: -5000 });
    const tombstone = baseTxn({ id: 'txn-delete-twice', deleted: true });

    const engine = new SyncEngine({
      ynabClient: scriptedFetcher([
        { transactions: [live], serverKnowledge: 1 },
        { transactions: [tombstone], serverKnowledge: 2 },
        { transactions: [tombstone], serverKnowledge: 2 },
      ]),
      activitiesApi,
      stateStore,
      config: BASE_CONFIG,
      now: () => FIXED_NOW,
    });

    await engine.sync(); // create
    await engine.sync(); // orphan-flag
    const third = await engine.sync(); // repeat delete delta

    expect(third.orphaned).toBe(0);
    expect(third.warnings).toHaveLength(0);
    expect(activitiesApi.records.size).toBe(1);
  });
});

describe('SyncEngine — eligibility flip', () => {
  it('leaves an already-synced activity in place with a warning when its transaction becomes unapproved (no auto-remove)', async () => {
    const activitiesApi = createMockActivitiesApi();
    const stateStore = new StateStore(mockStorage());
    const approved = baseTxn({ id: 'txn-flip', approved: true });
    const flippedToUnapproved = baseTxn({ id: 'txn-flip', approved: false });

    const engine = new SyncEngine({
      ynabClient: scriptedFetcher([
        { transactions: [approved], serverKnowledge: 1 },
        { transactions: [flippedToUnapproved], serverKnowledge: 2 },
      ]),
      activitiesApi,
      stateStore,
      config: BASE_CONFIG,
      now: () => FIXED_NOW,
    });

    await engine.sync();
    const activityId = activityByTxnId(activitiesApi.records, 'txn-flip')?.id;

    const second = await engine.sync();

    expect(second.success).toBe(true);
    expect(second.skipped).toBe(1);
    expect(second.warnings.some((w) => w.includes('txn-flip'))).toBe(true);
    expect(activitiesApi.records.has(activityId!)).toBe(true);
  });
});

describe('SyncEngine — currency mismatch', () => {
  it('still records the activity but adds a warning when the mapped WF account currency differs from the budget currency', async () => {
    const activitiesApi = createMockActivitiesApi();
    const stateStore = new StateStore(mockStorage());
    const engine = new SyncEngine({
      ynabClient: fixedFetcher([baseTxn({ id: 'txn-fx', amount: 10000 })], 1),
      activitiesApi,
      stateStore,
      config: { ...BASE_CONFIG, wealthfolioAccountCurrencies: { 'wf-checking': 'EUR' } },
      now: () => FIXED_NOW,
    });

    const summary = await engine.sync();

    expect(summary.created).toBe(1);
    expect(summary.warnings.some((w) => w.includes('currency'))).toBe(true);
  });
});

describe('SyncEngine — fetch-stage failures (nothing written)', () => {
  it('401 -> errorKind invalid_token, no activities created, cursor not persisted', async () => {
    const activitiesApi = createMockActivitiesApi();
    const stateStore = new StateStore(mockStorage());
    const engine = new SyncEngine({
      ynabClient: throwingFetcher(new InvalidTokenError()),
      activitiesApi,
      stateStore,
      config: BASE_CONFIG,
    });

    const summary = await engine.sync();

    expect(summary.success).toBe(false);
    expect(summary.errorKind).toBe('invalid_token');
    expect(activitiesApi.records.size).toBe(0);
    expect(await stateStore.getBudgetState('budget-1')).toBeNull();
  });

  it('429 -> errorKind rate_limited with retryAfterSeconds surfaced, no auto-retry, nothing written', async () => {
    const activitiesApi = createMockActivitiesApi();
    const stateStore = new StateStore(mockStorage());
    const engine = new SyncEngine({
      ynabClient: throwingFetcher(new RateLimitError(120)),
      activitiesApi,
      stateStore,
      config: BASE_CONFIG,
    });

    const summary = await engine.sync();

    expect(summary.success).toBe(false);
    expect(summary.errorKind).toBe('rate_limited');
    expect(summary.retryAfterSeconds).toBe(120);
    expect(activitiesApi.records.size).toBe(0);
  });

  it('network error -> errorKind network, nothing written', async () => {
    const activitiesApi = createMockActivitiesApi();
    const stateStore = new StateStore(mockStorage());
    const engine = new SyncEngine({
      ynabClient: throwingFetcher(new NetworkError()),
      activitiesApi,
      stateStore,
      config: BASE_CONFIG,
    });

    const summary = await engine.sync();

    expect(summary.success).toBe(false);
    expect(summary.errorKind).toBe('network');
    expect(activitiesApi.records.size).toBe(0);
  });
});

describe('SyncEngine — partial batch failure', () => {
  it('stops the batch, reports succeeded vs failed, and does NOT advance the cursor; a retry finishes the rest without duplicating what already applied', async () => {
    const activitiesApi = createMockActivitiesApi({ failCreateOnCallNumber: 2 });
    const stateStore = new StateStore(mockStorage());
    const txnA = baseTxn({ id: 'txn-a', amount: 10000 });
    const txnB = baseTxn({ id: 'txn-b', amount: 20000 });
    const txnC = baseTxn({ id: 'txn-c', amount: 30000 });
    const ynabClient = fixedFetcher([txnA, txnB, txnC], 500);

    const engine = new SyncEngine({ ynabClient, activitiesApi, stateStore, config: BASE_CONFIG, now: () => FIXED_NOW });

    const first = await engine.sync();

    expect(first.success).toBe(false);
    expect(first.errorKind).toBe('partial_batch');
    expect(first.created).toBe(1); // txn-a got through before the 2nd create call failed on txn-b
    expect(first.errors[0]).toMatch(/1 item\(s\) applied/);
    expect(await stateStore.getBudgetState('budget-1')).toBeNull(); // cursor NOT advanced

    const second = await engine.sync();

    expect(second.success).toBe(true);
    expect(second.created).toBe(2); // txn-b and txn-c, the ones that hadn't applied yet
    expect(second.updated).toBe(1); // txn-a, recognized via the live scan, not recreated
    expect(activitiesApi.records.size).toBe(3); // still exactly one activity per transaction
    expect((await stateStore.getBudgetState('budget-1'))?.syncState.lastKnowledgeOfServer).toBe(500);
  });
});

describe('SyncEngine — unmapped YNAB accounts', () => {
  it('never creates activities for transactions on an unmapped YNAB account', async () => {
    const activitiesApi = createMockActivitiesApi();
    const stateStore = new StateStore(mockStorage());
    const txn = baseTxn({ id: 'txn-unmapped', account_id: 'ynab-credit-card' });

    const engine = new SyncEngine({
      ynabClient: fixedFetcher([txn], 1),
      activitiesApi,
      stateStore,
      config: BASE_CONFIG,
      now: () => FIXED_NOW,
    });

    const summary = await engine.sync();

    expect(summary.created).toBe(0);
    expect(summary.skipped).toBe(1);
    expect(activitiesApi.records.size).toBe(0);
  });
});
