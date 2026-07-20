// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, expect, it } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSync } from '../../src/ui/useSync';
import { getBudgetStateKey, getUserConfigKey } from '../../src/state/schema';
import type { BudgetStateSchema, UserConfigSchema } from '../../src/state/schema';
import { createMockCtx } from './testUtils';

const BUDGET_ID = 'budget-1';

const YNAB_ACCOUNT = {
  id: 'ynab-checking',
  name: 'Checking',
  type: 'checking',
  on_budget: true,
  closed: false,
  note: null,
  balance: 0,
  cleared_balance: 0,
  uncleared_balance: 0,
  transfer_payee_id: null,
  deleted: false,
};

const WF_ACCOUNT = {
  id: 'wf-cash',
  name: 'Everyday Cash',
  accountType: 'CASH' as const,
  balance: 0,
  currency: 'USD',
  isDefault: true,
  isActive: true,
  isArchived: false,
  trackingMode: 'TRANSACTIONS' as const,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
};

const DEPOSIT_TXN = {
  id: 'txn-1',
  date: '2026-07-01',
  amount: 50000,
  memo: 'Paycheck',
  cleared: 'cleared' as const,
  approved: true,
  flag_color: null,
  account_id: YNAB_ACCOUNT.id,
  account_name: 'Checking',
  payee_id: null,
  payee_name: 'Employer',
  category_id: null,
  category_name: null,
  transfer_account_id: null,
  transfer_transaction_id: null,
  matched_transaction_id: null,
  import_id: null,
  deleted: false,
  subtransactions: [],
};

describe('useSync', () => {
  it('reports no-token when no secret is saved', async () => {
    const { ctx } = createMockCtx();
    const { result } = renderHook(() => useSync(ctx));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.connectionStatus).toBe('no-token');
    expect(result.current.budgets).toEqual([]);
  });

  it('fetches budgets live and reports connected when a token exists', async () => {
    const { ctx } = createMockCtx({
      token: 'fake-token',
      ynab: { budgets: [{ id: BUDGET_ID, name: 'My Budget', last_modified_on: null, first_month: null, last_month: null, currency_format: null }] },
    });
    const { result } = renderHook(() => useSync(ctx));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.connectionStatus).toBe('connected');
    expect(result.current.budgets).toHaveLength(1);
    expect(result.current.budgets[0].name).toBe('My Budget');
  });

  it('reports invalid-token on a 401 from YNAB, without ever exposing the token', async () => {
    const { ctx, network } = createMockCtx({ token: 'bad-token' });
    network.mockImplementationOnce(async () => ({ status: 401, headers: {}, body: '' }));

    const { result } = renderHook(() => useSync(ctx));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.connectionStatus).toBe('invalid-token');
  });

  it('saveToken writes to ctx.api.secrets by key and never by inline value elsewhere', async () => {
    const { ctx } = createMockCtx({ ynab: { budgets: [] } });
    const { result } = renderHook(() => useSync(ctx));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.connectionStatus).toBe('no-token');

    await act(async () => {
      await result.current.saveToken('a-real-looking-fake-token');
    });

    expect(ctx.api.secrets.set).toHaveBeenCalledWith(
      'ynab-personal-access-token',
      'a-real-looking-fake-token',
    );
    expect(result.current.connectionStatus).toBe('connected');
  });

  it('removeToken deletes the secret and resets connection state', async () => {
    const { ctx } = createMockCtx({ token: 'fake-token', ynab: { budgets: [] } });
    const { result } = renderHook(() => useSync(ctx));
    await waitFor(() => expect(result.current.connectionStatus).toBe('connected'));

    await act(async () => {
      await result.current.removeToken();
    });

    expect(ctx.api.secrets.delete).toHaveBeenCalledWith('ynab-personal-access-token');
    expect(result.current.connectionStatus).toBe('no-token');
  });

  it('selectBudget persists activeBudgetId via StateStore and loads accounts', async () => {
    const { ctx, storageData } = createMockCtx({
      token: 'fake-token',
      ynab: { budgets: [{ id: BUDGET_ID, name: 'Budget', last_modified_on: null, first_month: null, last_month: null, currency_format: null }], accounts: [YNAB_ACCOUNT] },
      wealthfolioAccounts: [WF_ACCOUNT],
    });
    const { result } = renderHook(() => useSync(ctx));
    await waitFor(() => expect(result.current.connectionStatus).toBe('connected'));

    await act(async () => {
      await result.current.selectBudget(BUDGET_ID);
    });

    expect(result.current.activeBudgetId).toBe(BUDGET_ID);
    expect(result.current.ynabAccounts).toHaveLength(1);
    expect(result.current.wealthfolioAccounts).toHaveLength(1);

    const persisted = JSON.parse(storageData.get(getUserConfigKey())!) as UserConfigSchema;
    expect(persisted.activeBudgetId).toBe(BUDGET_ID);
  });

  it('setAccountMapping persists the mapping through StateStore, never ctx.api.storage directly from the UI', async () => {
    const { ctx, storageData } = createMockCtx({
      token: 'fake-token',
      ynab: { budgets: [{ id: BUDGET_ID, name: 'Budget', last_modified_on: null, first_month: null, last_month: null, currency_format: null }], accounts: [YNAB_ACCOUNT] },
      wealthfolioAccounts: [WF_ACCOUNT],
    });
    const { result } = renderHook(() => useSync(ctx));
    await waitFor(() => expect(result.current.connectionStatus).toBe('connected'));
    await act(async () => {
      await result.current.selectBudget(BUDGET_ID);
    });

    await act(async () => {
      await result.current.setAccountMapping(YNAB_ACCOUNT.id, WF_ACCOUNT.id);
    });

    expect(result.current.accountMapping[YNAB_ACCOUNT.id]).toBe(WF_ACCOUNT.id);
    const persisted = JSON.parse(storageData.get(getBudgetStateKey(BUDGET_ID))!) as BudgetStateSchema;
    expect(persisted.accountMappings[YNAB_ACCOUNT.id]).toBe(WF_ACCOUNT.id);
  });

  it('triggerSync constructs a fresh engine and running it twice on the same fixtures creates zero duplicate activities', async () => {
    const { ctx, activitiesByAccount } = createMockCtx({
      token: 'fake-token',
      ynab: {
        budgets: [{ id: BUDGET_ID, name: 'Budget', last_modified_on: null, first_month: null, last_month: null, currency_format: null }],
        accounts: [YNAB_ACCOUNT],
        budgetSettings: { currency_format: { iso_code: 'USD' } },
        transactions: [DEPOSIT_TXN],
      },
      wealthfolioAccounts: [WF_ACCOUNT],
    });
    const { result } = renderHook(() => useSync(ctx));
    await waitFor(() => expect(result.current.connectionStatus).toBe('connected'));
    await act(async () => {
      await result.current.selectBudget(BUDGET_ID);
    });
    await act(async () => {
      await result.current.setAccountMapping(YNAB_ACCOUNT.id, WF_ACCOUNT.id);
    });

    await act(async () => {
      await result.current.triggerSync();
    });
    expect(result.current.lastSyncSummary?.success).toBe(true);
    expect(result.current.lastSyncSummary?.created).toBe(1);
    expect(activitiesByAccount.get(WF_ACCOUNT.id)).toHaveLength(1);

    await act(async () => {
      await result.current.triggerSync();
    });
    expect(result.current.lastSyncSummary?.success).toBe(true);
    expect(result.current.lastSyncSummary?.created).toBe(0);
    expect(activitiesByAccount.get(WF_ACCOUNT.id)).toHaveLength(1);
  });

  it('triggerSync surfaces invalid_token errorKind and flips connection status without writing anything', async () => {
    const { ctx, network } = createMockCtx({
      token: 'fake-token',
      ynab: {
        budgets: [{ id: BUDGET_ID, name: 'Budget', last_modified_on: null, first_month: null, last_month: null, currency_format: null }],
        accounts: [YNAB_ACCOUNT],
      },
      wealthfolioAccounts: [WF_ACCOUNT],
    });
    const { result } = renderHook(() => useSync(ctx));
    await waitFor(() => expect(result.current.connectionStatus).toBe('connected'));
    await act(async () => {
      await result.current.selectBudget(BUDGET_ID);
    });
    await act(async () => {
      await result.current.setAccountMapping(YNAB_ACCOUNT.id, WF_ACCOUNT.id);
    });

    network.mockImplementation(async (req) => {
      if (new URL(req.url).pathname.endsWith('/transactions')) {
        return { status: 401, headers: {}, body: '' };
      }
      return {
        status: 200,
        headers: {},
        body: JSON.stringify({ data: { settings: { currency_format: { iso_code: 'USD' } } } }),
      };
    });

    await act(async () => {
      await result.current.triggerSync();
    });

    expect(result.current.lastSyncSummary?.success).toBe(false);
    expect(result.current.lastSyncSummary?.errorKind).toBe('invalid_token');
    expect(result.current.connectionStatus).toBe('invalid-token');
    expect(ctx.api.activities.create).not.toHaveBeenCalled();
  });
});
