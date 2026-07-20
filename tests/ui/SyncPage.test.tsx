// @vitest-environment jsdom
// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SyncPage } from '../../src/ui/SyncPage';
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

function userConfigWith(overrides: Partial<UserConfigSchema>): string {
  const base: UserConfigSchema = {
    activeBudgetId: null,
    autoSyncOnOpen: false,
    includeUnapproved: false,
    includeUncleared: false,
  };
  return JSON.stringify({ ...base, ...overrides });
}

function budgetStateWith(overrides: Partial<BudgetStateSchema>): string {
  const base: BudgetStateSchema = {
    syncState: { lastKnowledgeOfServer: null, transactionIdMap: {}, lastSyncTimestamp: null },
    accountMappings: {},
    lastSyncError: null,
  };
  return JSON.stringify({ ...base, ...overrides });
}

describe('SyncPage', () => {
  it('renders the no-token connection state and never renders a token value', async () => {
    const { ctx } = createMockCtx();
    render(<SyncPage ctx={ctx} />);

    await waitFor(() => expect(screen.getByText('No token saved')).toBeInTheDocument());
    expect(screen.queryByText(/select a budget/i)).not.toBeInTheDocument();
  });

  it('saving a token calls ctx.api.secrets.set and flips to connected', async () => {
    const user = userEvent.setup();
    const { ctx } = createMockCtx({
      ynab: {
        budgets: [
          { id: BUDGET_ID, name: 'My Budget', last_modified_on: null, first_month: null, last_month: null, currency_format: null },
        ],
      },
    });
    render(<SyncPage ctx={ctx} />);
    await waitFor(() => expect(screen.getByText('No token saved')).toBeInTheDocument());

    await user.type(screen.getByLabelText(/ynab personal access token/i), 'a-fake-token-value');
    await user.click(screen.getByRole('button', { name: /save token/i }));

    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());
    expect(ctx.api.secrets.set).toHaveBeenCalledWith('ynab-personal-access-token', 'a-fake-token-value');
    // The input is cleared after save — the token is never left rendered anywhere.
    expect(screen.getByLabelText(/ynab personal access token/i)).toHaveValue('');
  });

  it('removing the token calls ctx.api.secrets.delete and returns to the no-token state', async () => {
    const user = userEvent.setup();
    const { ctx } = createMockCtx({ token: 'existing-token', ynab: { budgets: [] } });
    render(<SyncPage ctx={ctx} />);
    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: /remove token/i }));

    await waitFor(() => expect(screen.getByText('No token saved')).toBeInTheDocument());
    expect(ctx.api.secrets.delete).toHaveBeenCalledWith('ynab-personal-access-token');
  });

  it('shows the account mapping table once a budget is preselected, and running sync twice creates the activity only once', async () => {
    const user = userEvent.setup();
    const { ctx, activitiesByAccount } = createMockCtx({
      token: 'fake-token',
      ynab: {
        budgets: [
          { id: BUDGET_ID, name: 'My Budget', last_modified_on: null, first_month: null, last_month: null, currency_format: null },
        ],
        accounts: [YNAB_ACCOUNT],
        budgetSettings: { currency_format: { iso_code: 'USD' } },
        transactions: [DEPOSIT_TXN],
      },
      wealthfolioAccounts: [WF_ACCOUNT],
      storage: {
        [getUserConfigKey()]: userConfigWith({ activeBudgetId: BUDGET_ID }),
        [getBudgetStateKey(BUDGET_ID)]: budgetStateWith({
          accountMappings: { [YNAB_ACCOUNT.id]: WF_ACCOUNT.id },
        }),
      },
    });

    render(<SyncPage ctx={ctx} />);

    await waitFor(() => expect(screen.getByText('Checking')).toBeInTheDocument());
    const syncButton = await screen.findByRole('button', { name: /sync now/i });
    expect(syncButton).toBeEnabled();

    await user.click(syncButton);
    await waitFor(() => expect(screen.getByText('Created 1')).toBeInTheDocument());
    expect(activitiesByAccount.get(WF_ACCOUNT.id)).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: /sync now/i }));
    await waitFor(() => expect(screen.getByText('Created 0')).toBeInTheDocument());
    expect(activitiesByAccount.get(WF_ACCOUNT.id)).toHaveLength(1);
  });

  it('surfaces a friendly message and disables further data loss when the token turns out to be invalid mid-sync', async () => {
    const user = userEvent.setup();
    const { ctx, network } = createMockCtx({
      token: 'fake-token',
      ynab: {
        budgets: [
          { id: BUDGET_ID, name: 'My Budget', last_modified_on: null, first_month: null, last_month: null, currency_format: null },
        ],
        accounts: [YNAB_ACCOUNT],
      },
      wealthfolioAccounts: [WF_ACCOUNT],
      storage: {
        [getUserConfigKey()]: userConfigWith({ activeBudgetId: BUDGET_ID }),
        [getBudgetStateKey(BUDGET_ID)]: budgetStateWith({
          accountMappings: { [YNAB_ACCOUNT.id]: WF_ACCOUNT.id },
        }),
      },
    });

    render(<SyncPage ctx={ctx} />);
    const syncButton = await screen.findByRole('button', { name: /sync now/i });

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

    await user.click(syncButton);

    await waitFor(() =>
      expect(
        screen.getByText(/invalid token — re-enter your ynab personal access token/i),
      ).toBeInTheDocument(),
    );
    expect(ctx.api.activities.create).not.toHaveBeenCalled();
  });
});
