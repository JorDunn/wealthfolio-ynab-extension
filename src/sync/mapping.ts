// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Transaction type and amount mapping logic.
 * Maps YNAB transaction properties to Wealthfolio activity types and amounts.
 */

export enum WealthfolioActivityType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  TRANSFER_IN = 'TRANSFER_IN',
  TRANSFER_OUT = 'TRANSFER_OUT',
}

export interface MappingResult {
  activityType: WealthfolioActivityType;
  amount: number;
  isValid: boolean;
}

/**
 * Map a YNAB transaction to a Wealthfolio activity type.
 */
export function mapActivityType(
  isInflow: boolean,
  isTransfer: boolean,
): WealthfolioActivityType {
  if (isTransfer) {
    return isInflow ? WealthfolioActivityType.TRANSFER_IN : WealthfolioActivityType.TRANSFER_OUT;
  }
  return isInflow ? WealthfolioActivityType.DEPOSIT : WealthfolioActivityType.WITHDRAWAL;
}

/**
 * Validate and convert transaction amount.
 */
export function mapAmount(milliunits: number, isInflow: boolean): MappingResult {
  const amount = Math.abs(milliunits) / 1000;

  return {
    activityType: isInflow ? WealthfolioActivityType.DEPOSIT : WealthfolioActivityType.WITHDRAWAL,
    amount,
    isValid: amount > 0,
  };
}
