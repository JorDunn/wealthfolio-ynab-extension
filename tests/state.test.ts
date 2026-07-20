// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect } from 'vitest';
import { StateStore } from '../src/state/store';

describe('StateStore', () => {
  it('should instantiate with storage API', () => {
    const mockStorage = {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
    };

    const store = new StateStore(mockStorage);
    expect(store).toBeDefined();
  });

  it('should handle missing budget state', async () => {
    const mockStorage = {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
    };

    const store = new StateStore(mockStorage);
    const state = await store.getBudgetState('unknown-budget');
    expect(state).toBeNull();
  });

  it('should handle missing user config', async () => {
    const mockStorage = {
      get: async () => undefined,
      set: async () => {},
      remove: async () => {},
    };

    const store = new StateStore(mockStorage);
    const config = await store.getUserConfig();
    expect(config).toBeNull();
  });
});
