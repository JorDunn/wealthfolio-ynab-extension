// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import type { Budget } from './types';

/**
 * YNAB API client for fetching budget and transaction data.
 * Uses ctx.api.network for requests and ctx.api.secrets for token storage.
 */

export interface YNABClientConfig {
  apiKey: string;
  request: (url: string, options?: RequestInit) => Promise<Response>;
}

export class YNABClient {
  private apiKey: string;
  private request: (url: string, options?: RequestInit) => Promise<Response>;

  constructor(config: YNABClientConfig) {
    this.apiKey = config.apiKey;
    this.request = config.request;
  }

  /**
   * Fetch a budget by ID with full details including transactions.
   */
  async getBudget(budgetId: string): Promise<Budget> {
    const response = await this.request(`https://api.ynab.com/v1/budgets/${budgetId}`, {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`YNAB API error: ${response.status}`);
    }

    const data = await response.json() as { data: { budget: Budget } };
    return data.data.budget;
  }

  /**
   * List all available budgets.
   */
  async getBudgets(): Promise<Budget[]> {
    const response = await this.request('https://api.ynab.com/v1/budgets', {
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`YNAB API error: ${response.status}`);
    }

    const data = await response.json() as { data: { budgets: Budget[] } };
    return data.data.budgets;
  }

  /**
   * Verify the API key is valid by making a test request.
   */
  async validateToken(): Promise<boolean> {
    try {
      await this.getBudgets();
      return true;
    } catch {
      return false;
    }
  }
}
