// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Shared mock `AddonContext` builder for UI smoke tests. Fakes exactly the
 * `ctx.api` surface `useSync`/`SyncPage` touch (secrets, storage, network,
 * accounts, activities) — everything else on `HostAPI` is cast away rather
 * than stubbed, since nothing in this addon's UI calls it. No real network
 * or host is involved; `ctx.api.network.request` is answered entirely from
 * in-memory fixtures below, keyed by YNAB API path.
 */

import { vi } from 'vitest';
import type { Account, AddonContext, HostAPI } from '@wealthfolio/addon-sdk';
import { YNAB_TOKEN_SECRET_NAME } from '../../src/secrets/token';
import type { NetworkRequest, NetworkResponse } from '../../src/ynab/client';

type StoredActivity = { id: string; accountId: string } & Record<string, unknown>;

export interface MockYnabFixtures {
  budgets?: unknown[];
  budgetSettings?: unknown;
  accounts?: unknown[];
  transactions?: unknown[];
  serverKnowledge?: number;
}

function jsonResponse(status: number, data: unknown): NetworkResponse {
  return { status, headers: {}, body: JSON.stringify({ data }) };
}

/** Builds the `ctx.api.network.request` fake, routing by YNAB API v1 path. */
export function createMockNetworkRequest(fixtures: MockYnabFixtures = {}) {
  const {
    budgets = [],
    budgetSettings = { currency_format: { iso_code: 'USD' } },
    accounts = [],
    transactions = [],
    serverKnowledge = 1,
  } = fixtures;

  return vi.fn(async (req: NetworkRequest): Promise<NetworkResponse> => {
    const { pathname } = new URL(req.url);
    if (pathname === '/v1/budgets') {
      return jsonResponse(200, { budgets });
    }
    if (/\/v1\/budgets\/[^/]+\/settings$/.test(pathname)) {
      return jsonResponse(200, { settings: budgetSettings });
    }
    if (/\/v1\/budgets\/[^/]+\/accounts$/.test(pathname)) {
      return jsonResponse(200, { accounts });
    }
    if (/\/v1\/budgets\/[^/]+\/transactions$/.test(pathname)) {
      return jsonResponse(200, { transactions, server_knowledge: serverKnowledge });
    }
    return jsonResponse(404, { error: `unhandled mock path: ${pathname}` });
  });
}

export interface MockCtxOptions {
  /** Seed a token into the fake secrets store (never asserted-on by value in tests beyond existence). */
  token?: string;
  ynab?: MockYnabFixtures;
  wealthfolioAccounts?: Account[];
  /** Seed `ctx.api.storage` directly, e.g. to pre-select a budget/mapping without exercising the UI for it. */
  storage?: Record<string, string>;
}

export interface MockCtxHandles {
  ctx: AddonContext;
  network: ReturnType<typeof createMockNetworkRequest>;
  secretsData: Map<string, string>;
  storageData: Map<string, string>;
  activitiesByAccount: Map<string, StoredActivity[]>;
}

export function createMockCtx(options: MockCtxOptions = {}): MockCtxHandles {
  const storageData = new Map<string, string>(Object.entries(options.storage ?? {}));
  const secretsData = new Map<string, string>();
  if (options.token) {
    secretsData.set(YNAB_TOKEN_SECRET_NAME, options.token);
  }
  const activitiesByAccount = new Map<string, StoredActivity[]>();
  let nextActivityId = 1;

  const network = createMockNetworkRequest(options.ynab);

  const api: Partial<HostAPI> = {
    accounts: {
      getAll: vi.fn(async () => options.wealthfolioAccounts ?? []),
      create: vi.fn(),
    } as unknown as HostAPI['accounts'],
    activities: {
      getAll: vi.fn(async (accountId?: string) => {
        if (accountId) return activitiesByAccount.get(accountId) ?? [];
        return Array.from(activitiesByAccount.values()).flat();
      }),
      create: vi.fn(async (input: Record<string, unknown>) => {
        const id = `activity-${nextActivityId++}`;
        const record = { ...input, id, accountId: input.accountId as string } as StoredActivity;
        const list = activitiesByAccount.get(record.accountId) ?? [];
        list.push(record);
        activitiesByAccount.set(record.accountId, list);
        return record;
      }),
      update: vi.fn(async (input: Record<string, unknown> & { id: string }) => {
        const accountId = input.accountId as string;
        const list = activitiesByAccount.get(accountId) ?? [];
        const idx = list.findIndex((a) => a.id === input.id);
        const record = { ...(idx >= 0 ? list[idx] : {}), ...input } as StoredActivity;
        if (idx >= 0) {
          list[idx] = record;
        } else {
          list.push(record);
        }
        activitiesByAccount.set(accountId, list);
        return record;
      }),
      search: vi.fn(),
      saveMany: vi.fn(),
      import: vi.fn(),
      checkImport: vi.fn(),
      getImportMapping: vi.fn(),
      saveImportMapping: vi.fn(),
    } as unknown as HostAPI['activities'],
    storage: {
      get: vi.fn(async (key: string) => storageData.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        storageData.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        storageData.delete(key);
      }),
    },
    secrets: {
      get: vi.fn(async (key: string) => secretsData.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => {
        secretsData.set(key, value);
      }),
      delete: vi.fn(async (key: string) => {
        secretsData.delete(key);
      }),
    },
    network: { request: network },
    query: {
      getClient: vi.fn(() => ({})),
      invalidateQueries: vi.fn(),
      refetchQueries: vi.fn(),
    },
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), trace: vi.fn(), debug: vi.fn() },
    toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  };

  const ctx: AddonContext = {
    ui: { root: document.createElement('div') },
    sidebar: { addItem: vi.fn(() => ({ remove: vi.fn() })) },
    router: { add: vi.fn() },
    onDisable: vi.fn(),
    api: api as HostAPI,
  };

  return { ctx, network, secretsData, storageData, activitiesByAccount };
}
