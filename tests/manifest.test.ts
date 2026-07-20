// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect } from 'vitest';
import manifest from '../manifest.json';

describe('manifest.json permissions', () => {
  it('declares permissions as an array (not the legacy category->functions map shape)', () => {
    expect(Array.isArray(manifest.permissions)).toBe(true);
  });

  it('gives every permission entry a category, a functions array, and a purpose', () => {
    for (const permission of manifest.permissions) {
      expect(typeof permission.category).toBe('string');
      expect(permission.category.length).toBeGreaterThan(0);

      expect(Array.isArray(permission.functions)).toBe(true);
      expect(permission.functions.length).toBeGreaterThan(0);
      for (const fn of permission.functions) {
        expect(typeof fn).toBe('string');
        expect(fn.length).toBeGreaterThan(0);
      }

      expect(typeof permission.purpose).toBe('string');
      expect(permission.purpose.length).toBeGreaterThan(0);
    }
  });

  it('declares only the expected permission categories', () => {
    const categories = manifest.permissions.map((p) => p.category).sort();
    expect(categories).toEqual(['accounts', 'activities', 'network', 'secrets']);
  });
});
