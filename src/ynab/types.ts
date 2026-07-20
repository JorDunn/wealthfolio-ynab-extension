// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * YNAB API v1 wire types (https://api.ynab.com/v1).
 *
 * These mirror the *actual* JSON field names YNAB returns (snake_case,
 * milliunit amounts, numeric server_knowledge cursor) rather than a
 * camelCased re-interpretation. Keeping the wire shape here means the
 * client (src/ynab/client.ts) can parse a response body with a direct
 * `JSON.parse` + type assertion, with zero silent field-name drift between
 * what YNAB sends and what this addon reads.
 *
 * Deviation note (Stage 3): the Stage 2 scaffold's `types.ts` used camelCase
 * field names (`lastModifiedOn`, `categoryGroupId`, ...) that do not match
 * YNAB's actual API response shape at all. Replaced wholesale.
 */

export interface YnabCurrencyFormat {
  iso_code: string;
  example_format: string;
  decimal_digits: number;
  decimal_separator: string;
  symbol_first: boolean;
  group_separator: string;
  currency_symbol: string;
  display_symbol: boolean;
}

/** GET /budgets summary entry (and the shape embedded in /budgets/{id}). */
export interface YnabBudgetSummary {
  id: string;
  name: string;
  last_modified_on: string | null;
  first_month: string | null;
  last_month: string | null;
  currency_format: YnabCurrencyFormat | null;
}

export type YnabAccountType =
  | 'checking'
  | 'savings'
  | 'cash'
  | 'creditCard'
  | 'lineOfCredit'
  | 'otherAsset'
  | 'otherLiability'
  | 'mortgage'
  | 'autoLoan'
  | 'studentLoan'
  | 'personalLoan'
  | 'medicalDebt'
  | 'otherDebt';

export interface YnabAccount {
  id: string;
  name: string;
  type: YnabAccountType;
  on_budget: boolean;
  closed: boolean;
  note: string | null;
  balance: number;
  cleared_balance: number;
  uncleared_balance: number;
  transfer_payee_id: string | null;
  deleted: boolean;
}

export type YnabClearedStatus = 'cleared' | 'uncleared' | 'reconciled';

export interface YnabSubtransaction {
  id: string;
  transaction_id: string;
  amount: number;
  memo: string | null;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  transfer_account_id: string | null;
  transfer_transaction_id: string | null;
  deleted: boolean;
}

/** A YNAB transaction as returned by the transactions delta endpoint. */
export interface YnabTransaction {
  id: string;
  date: string;
  /** Milliunits, signed: negative = outflow, positive = inflow. */
  amount: number;
  memo: string | null;
  cleared: YnabClearedStatus;
  approved: boolean;
  flag_color: string | null;
  account_id: string;
  account_name: string;
  payee_id: string | null;
  payee_name: string | null;
  category_id: string | null;
  category_name: string | null;
  transfer_account_id: string | null;
  transfer_transaction_id: string | null;
  matched_transaction_id: string | null;
  import_id: string | null;
  deleted: boolean;
  subtransactions: YnabSubtransaction[];
}

/** GET /budgets/{id}/transactions response payload (`data`). */
export interface YnabTransactionsData {
  transactions: YnabTransaction[];
  server_knowledge: number;
}

export interface YnabBudgetSettings {
  currency_format: YnabCurrencyFormat | null;
}
