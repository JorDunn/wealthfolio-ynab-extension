// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect } from 'vitest';
import { mapActivityType, mapAmount, WealthfolioActivityType } from '../src/sync/mapping';

describe('Transaction Mapping', () => {
  it('should map inflow to DEPOSIT', () => {
    const type = mapActivityType(true, false);
    expect(type).toBe(WealthfolioActivityType.DEPOSIT);
  });

  it('should map outflow to WITHDRAWAL', () => {
    const type = mapActivityType(false, false);
    expect(type).toBe(WealthfolioActivityType.WITHDRAWAL);
  });

  it('should map transfer in to TRANSFER_IN', () => {
    const type = mapActivityType(true, true);
    expect(type).toBe(WealthfolioActivityType.TRANSFER_IN);
  });

  it('should map transfer out to TRANSFER_OUT', () => {
    const type = mapActivityType(false, true);
    expect(type).toBe(WealthfolioActivityType.TRANSFER_OUT);
  });

  it('should map milliunits to currency amount', () => {
    const result = mapAmount(100000, true);
    expect(result.amount).toBe(100);
    expect(result.isValid).toBe(true);
  });

  it('should handle zero amounts', () => {
    const result = mapAmount(0, true);
    expect(result.amount).toBe(0);
    expect(result.isValid).toBe(false);
  });
});
