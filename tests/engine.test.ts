// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect } from 'vitest';
import { SyncEngine } from '../src/sync/engine';

describe('SyncEngine', () => {
  it('should instantiate', () => {
    const engine = new SyncEngine();
    expect(engine).toBeDefined();
  });

  it('should return a sync result', async () => {
    const engine = new SyncEngine();
    const result = await engine.sync();

    expect(result).toHaveProperty('success');
    expect(result).toHaveProperty('createdActivities');
    expect(result).toHaveProperty('updatedActivities');
    expect(result).toHaveProperty('warnings');
    expect(result).toHaveProperty('errors');
  });
});
