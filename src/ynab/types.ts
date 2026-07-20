// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * YNAB API types and interfaces.
 */

export interface Budget {
  id: string;
  name: string;
  lastModifiedOn: string;
  dateFormat: {
    format: string;
  };
  currencyFormat: {
    iso_code: string;
    example_format: string;
    decimal_digits: number;
    decimal_separator: string;
    thousands_separator: string;
    symbol_first: boolean;
    symbol: string;
    display_symbol: boolean;
  };
  accounts: Account[];
  payees: Payee[];
  categoryGroups: CategoryGroup[];
  categories: Category[];
  months: MonthDetail[];
  transactions: Transaction[];
}

export interface Account {
  id: string;
  name: string;
  type: string;
  onBudget: boolean;
  closed: boolean;
  note: string | null;
  balance: number;
  clearedBalance: number;
  unclearedBalance: number;
  transferPayeeId: string;
  directImportLinked: boolean;
  directImportInProgress: boolean;
  lastReconciliationDate: string | null;
  deleted: boolean;
}

export interface Payee {
  id: string;
  name: string;
  transferAccountId: string | null;
  deleted: boolean;
}

export interface CategoryGroup {
  id: string;
  name: string;
  hidden: boolean;
  deleted: boolean;
  categories: Category[];
}

export interface Category {
  id: string;
  categoryGroupId: string;
  name: string;
  hidden: boolean;
  originalCategoryGroupId: string | null;
  note: string | null;
  budgeted: number;
  activity: number;
  balance: number;
  goalType: string | null;
  goalDay: number | null;
  goalCadenceFrequency: number | null;
  goalCadence: string | null;
  goalTarget: number | null;
  goalUnderFunded: number | null;
  isClosed: boolean;
  deleted: boolean;
}

export interface MonthDetail {
  month: string;
  note: string | null;
  income: number;
  budgeted: number;
  activity: number;
  balance: number;
  toBeBudgeted: number;
  ageOfMoney: number | null;
}

export interface Transaction {
  id: string;
  date: string;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  approved: boolean;
  cleared: 'cleared' | 'uncleared' | 'reconciled';
  flaggedColor: string | null;
  amount: number;
  memo: string | null;
  accountId: string;
  accountName: string;
  transferAccountId: string | null;
  transferTransactionId: string | null;
  matchedTransactionId: string | null;
  importId: string | null;
  importPayeeOriginalName: string | null;
  importPayeeName: string | null;
  importPayeeNameOriginal: string | null;
  deleted: boolean;
  subtransactions: Subtransaction[];
}

export interface Subtransaction {
  id: string;
  transactionId: string;
  amount: number;
  memo: string | null;
  payeeId: string | null;
  payeeName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  transferAccountId: string | null;
  transferTransactionId: string | null;
  matchedTransactionId: string | null;
  deleted: boolean;
}
