// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect } from 'vitest';
import {
  mapTransaction,
  toActivityInput,
  WealthfolioActivityType,
  type MappingConfig,
  type MappingOutcome,
} from '../src/sync/mapping';
import type { YnabTransaction } from '../src/ynab/types';

const YNAB_CHECKING = 'ynab-checking';
const YNAB_SAVINGS = 'ynab-savings';
const YNAB_CREDIT_CARD_UNMAPPED = 'ynab-credit-card';
const WF_CHECKING = 'wf-checking';
const WF_SAVINGS = 'wf-savings';

function baseConfig(overrides: Partial<MappingConfig> = {}): MappingConfig {
  return {
    budgetId: 'budget-1',
    budgetCurrency: 'USD',
    accountMapping: {
      [YNAB_CHECKING]: WF_CHECKING,
      [YNAB_SAVINGS]: WF_SAVINGS,
    },
    includeUnapproved: false,
    includeUncleared: false,
    ...overrides,
  };
}

function baseTxn(overrides: Partial<YnabTransaction> = {}): YnabTransaction {
  return {
    id: 'txn-1',
    date: '2026-07-15',
    amount: 50000, // $50.00 inflow
    memo: 'Paycheck',
    cleared: 'cleared',
    approved: true,
    flag_color: null,
    account_id: YNAB_CHECKING,
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
    ...overrides,
  };
}

describe('mapTransaction — table-driven', () => {
  const cases: Array<{
    name: string;
    txn: Partial<YnabTransaction>;
    config?: Partial<MappingConfig>;
    expect: (outcome: MappingOutcome) => void;
  }> = [
    {
      name: 'inflow, non-transfer -> DEPOSIT',
      txn: { amount: 50000, transfer_account_id: null },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.activityType).toBe(WealthfolioActivityType.DEPOSIT);
          expect(o.draft.amount).toBe(50);
        }
      },
    },
    {
      name: 'outflow, non-transfer -> WITHDRAWAL (absolute amount)',
      txn: { amount: -25500, transfer_account_id: null },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.activityType).toBe(WealthfolioActivityType.WITHDRAWAL);
          expect(o.draft.amount).toBe(25.5);
        }
      },
    },
    {
      name: 'transfer, both accounts mapped, outflow leg -> TRANSFER_OUT (not WITHDRAWAL)',
      txn: {
        account_id: YNAB_CHECKING,
        amount: -30000,
        transfer_account_id: YNAB_SAVINGS,
        transfer_transaction_id: 'txn-2',
      },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.activityType).toBe(WealthfolioActivityType.TRANSFER_OUT);
          expect(o.draft.wealthfolioAccountId).toBe(WF_CHECKING);
        }
      },
    },
    {
      name: 'transfer, both accounts mapped, inflow leg -> TRANSFER_IN (not DEPOSIT)',
      txn: {
        id: 'txn-2',
        account_id: YNAB_SAVINGS,
        amount: 30000,
        transfer_account_id: YNAB_CHECKING,
        transfer_transaction_id: 'txn-1',
      },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.activityType).toBe(WealthfolioActivityType.TRANSFER_IN);
          expect(o.draft.wealthfolioAccountId).toBe(WF_SAVINGS);
        }
      },
    },
    {
      name: 'transfer whose counterpart is unmapped, outflow -> WITHDRAWAL (no dangling half-transfer)',
      txn: {
        account_id: YNAB_CHECKING,
        amount: -10000,
        transfer_account_id: YNAB_CREDIT_CARD_UNMAPPED,
        transfer_transaction_id: 'txn-cc-1',
      },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.activityType).toBe(WealthfolioActivityType.WITHDRAWAL);
        }
      },
    },
    {
      name: 'transfer whose counterpart is unmapped, inflow -> DEPOSIT',
      txn: {
        account_id: YNAB_CHECKING,
        amount: 10000,
        transfer_account_id: YNAB_CREDIT_CARD_UNMAPPED,
        transfer_transaction_id: 'txn-cc-2',
      },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.activityType).toBe(WealthfolioActivityType.DEPOSIT);
        }
      },
    },
    {
      name: 'split parent -> total only; subtransactions (even a fake transfer one) are never inspected',
      txn: {
        amount: -12000,
        transfer_account_id: null,
        subtransactions: [
          { id: 'sub-1', transaction_id: 'txn-1', amount: -7000, memo: null, payee_id: null, payee_name: null, category_id: null, category_name: null, transfer_account_id: YNAB_SAVINGS, transfer_transaction_id: 'sub-transfer', deleted: false },
          { id: 'sub-2', transaction_id: 'txn-1', amount: -5000, memo: null, payee_id: null, payee_name: null, category_id: null, category_name: null, transfer_account_id: null, transfer_transaction_id: null, deleted: false },
        ],
      },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.activityType).toBe(WealthfolioActivityType.WITHDRAWAL);
          expect(o.draft.amount).toBe(12);
        }
      },
    },
    {
      name: 'zero amount -> skip (zero-amount), even if otherwise eligible',
      txn: { amount: 0 },
      expect: (o) => {
        expect(o).toEqual({ kind: 'skip', reason: 'zero-amount', ynabTransactionId: 'txn-1' });
      },
    },
    {
      name: 'unapproved -> skip by default',
      txn: { approved: false },
      expect: (o) => {
        expect(o).toEqual({ kind: 'skip', reason: 'unapproved', ynabTransactionId: 'txn-1' });
      },
    },
    {
      name: 'unapproved -> mapped when includeUnapproved is on',
      txn: { approved: false },
      config: { includeUnapproved: true },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
      },
    },
    {
      name: 'uncleared -> skip by default',
      txn: { cleared: 'uncleared' },
      expect: (o) => {
        expect(o).toEqual({ kind: 'skip', reason: 'uncleared', ynabTransactionId: 'txn-1' });
      },
    },
    {
      name: 'uncleared -> mapped when includeUncleared is on',
      txn: { cleared: 'uncleared' },
      config: { includeUncleared: true },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
      },
    },
    {
      name: 'reconciled counts as cleared (not "uncleared") -> mapped by default',
      txn: { cleared: 'reconciled' },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
      },
    },
    {
      name: "transaction on an unmapped YNAB account -> skip (unmapped-account), account is never synced",
      txn: { account_id: YNAB_CREDIT_CARD_UNMAPPED, transfer_account_id: null },
      expect: (o) => {
        expect(o).toEqual({ kind: 'skip', reason: 'unmapped-account', ynabTransactionId: 'txn-1' });
      },
    },
    {
      name: 'milliunits convert precisely (123930 -> 123.93)',
      txn: { amount: 123930 },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.amount).toBe(123.93);
        }
      },
    },
    {
      name: 'activity currency is always the YNAB budget currency, not the WF account currency',
      txn: { amount: 50000 },
      config: { budgetCurrency: 'CAD' },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.currency).toBe('CAD');
        }
      },
    },
    {
      name: 'currency mismatch flagged when mapped WF account currency differs from budget currency',
      txn: { amount: 50000, account_id: YNAB_CHECKING },
      config: { budgetCurrency: 'USD', wealthfolioAccountCurrencies: { [WF_CHECKING]: 'EUR' } },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.currencyMismatch).toBe(true);
        }
      },
    },
    {
      name: 'no currency mismatch when WF account currency matches the budget currency',
      txn: { amount: 50000, account_id: YNAB_CHECKING },
      config: { budgetCurrency: 'USD', wealthfolioAccountCurrencies: { [WF_CHECKING]: 'USD' } },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.currencyMismatch).toBe(false);
        }
      },
    },
    {
      name: 'no currency mismatch flagged when WF account currency is unknown to the mapper',
      txn: { amount: 50000, account_id: YNAB_CHECKING },
      config: { budgetCurrency: 'USD' },
      expect: (o) => {
        expect(o.kind).toBe('mapped');
        if (o.kind === 'mapped') {
          expect(o.draft.currencyMismatch).toBe(false);
        }
      },
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      const outcome = mapTransaction(baseTxn(testCase.txn), baseConfig(testCase.config));
      testCase.expect(outcome);
    });
  }
});

describe('toActivityInput', () => {
  it('tags the activity with metadata.source=ynab and the YNAB transaction id (the externalId substitute — see mapping.ts deviation note)', () => {
    const outcome = mapTransaction(baseTxn({ amount: 50000, memo: 'Paycheck' }), baseConfig());
    expect(outcome.kind).toBe('mapped');
    if (outcome.kind !== 'mapped') return;

    const input = toActivityInput(outcome.draft);

    expect(input.accountId).toBe(WF_CHECKING);
    expect(input.activityType).toBe(WealthfolioActivityType.DEPOSIT);
    expect(input.amount).toBe(50);
    expect(input.currency).toBe('USD');
    expect(input.comment).toBe('Paycheck');
    expect(input.metadata).toEqual({
      source: 'ynab',
      budgetId: 'budget-1',
      ynabAccountId: YNAB_CHECKING,
      ynabTransactionId: 'txn-1',
    });
  });
});
