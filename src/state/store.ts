// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import type { BudgetStateSchema, UserConfigSchema } from './schema';
import { getBudgetStateKey, getUserConfigKey } from './schema';

/**
 * State store for managing sync state and user configuration.
 * Uses ctx.api.storage for persistence.
 *
 * Deviation note (Stage 3): the Stage 2 stub's `StorageAPI` had `get():
 * Promise<string | undefined>` and a `remove()` method. The installed
 * `@wealthfolio/addon-sdk` (3.6.2) `StorageAPI` returns `string | null` from
 * `get()` and calls the delete method `delete()`, not `remove()`. Matched to
 * the real shape below.
 */

export interface StorageAPI {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class StateStore {
  constructor(private storage: StorageAPI) {}

  /**
   * Get the sync state for a budget.
   */
  async getBudgetState(budgetId: string): Promise<BudgetStateSchema | null> {
    const key = getBudgetStateKey(budgetId);
    const data = await this.storage.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as BudgetStateSchema;
    } catch {
      return null;
    }
  }

  /**
   * Save the sync state for a budget.
   */
  async setBudgetState(budgetId: string, state: BudgetStateSchema): Promise<void> {
    const key = getBudgetStateKey(budgetId);
    await this.storage.set(key, JSON.stringify(state));
  }

  /**
   * Get user configuration.
   */
  async getUserConfig(): Promise<UserConfigSchema | null> {
    const key = getUserConfigKey();
    const data = await this.storage.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as UserConfigSchema;
    } catch {
      return null;
    }
  }

  /**
   * Save user configuration.
   */
  async setUserConfig(config: UserConfigSchema): Promise<void> {
    const key = getUserConfigKey();
    await this.storage.set(key, JSON.stringify(config));
  }
}
