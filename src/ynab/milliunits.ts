// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * YNAB stores amounts as milliunits (1/1000th of the currency unit).
 * This module provides utilities to convert between milliunits and standard amounts.
 */

/**
 * Convert milliunits to standard currency amount.
 * @param milliunits Amount in milliunits (YNAB format)
 * @returns Amount in standard currency units (e.g., dollars, euros)
 */
export function milliunitsToCurrency(milliunits: number): number {
  return milliunits / 1000;
}

/**
 * Convert standard currency amount to milliunits.
 * @param amount Amount in standard currency units (e.g., dollars, euros)
 * @returns Amount in milliunits (YNAB format)
 */
export function currencyToMilliunits(amount: number): number {
  return Math.round(amount * 1000);
}
