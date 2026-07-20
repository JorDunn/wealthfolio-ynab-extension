// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect } from 'vitest';
import {
  YNAB_TOKEN_SECRET_NAME,
  hasYNABToken,
  getYNABToken,
  setYNABToken,
  deleteYNABToken,
  type SecretsAPI,
} from '../src/secrets/token';

function mockSecrets(initial: Record<string, string> = {}): SecretsAPI {
  const store = new Map(Object.entries(initial));
  return {
    set: async (name: string, value: string) => {
      store.set(name, value);
    },
    get: async (name: string) => store.get(name) ?? null,
    delete: async (name: string) => {
      store.delete(name);
    },
  };
}

describe('YNAB token secrets', () => {
  it('reports no token stored as false, without needing to read a value', async () => {
    const secrets = mockSecrets();
    await expect(hasYNABToken(secrets)).resolves.toBe(false);
  });

  it('reports a token stored as true purely from existence (get !== null), never exposing it', async () => {
    const secrets = mockSecrets({ [YNAB_TOKEN_SECRET_NAME]: 'fake-token-value' });
    await expect(hasYNABToken(secrets)).resolves.toBe(true);
  });

  it('stores the token under the fixed secret name via set()', async () => {
    const secrets = mockSecrets();
    await setYNABToken(secrets, 'fake-token-value');
    await expect(getYNABToken(secrets)).resolves.toBe('fake-token-value');
  });

  it('deletes the token', async () => {
    const secrets = mockSecrets({ [YNAB_TOKEN_SECRET_NAME]: 'fake-token-value' });
    await deleteYNABToken(secrets);
    await expect(hasYNABToken(secrets)).resolves.toBe(false);
  });
});
