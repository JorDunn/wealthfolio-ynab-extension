// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect, vi } from 'vitest';
import { YNABClient, YNAB_API_BASE_URL, type NetworkRequest, type NetworkResponse } from '../src/ynab/client';
import { InvalidTokenError, NetworkError, RateLimitError, ServerError, YNABSyncError } from '../src/errors';
import budgetFixture from './fixtures/budget.json';

const FAKE_SECRET_KEY = 'ynab-personal-access-token';

function jsonResponse(status: number, data: unknown, headers: Record<string, string> = {}): NetworkResponse {
  return { status, headers, body: JSON.stringify({ data }) };
}

describe('YNABClient', () => {
  it('instantiates with a request function and a secret key (never a raw token)', () => {
    const client = new YNABClient({ request: async () => jsonResponse(200, {}), secretKey: FAKE_SECRET_KEY });
    expect(client).toBeDefined();
  });

  it('requests budgets via the brokered network call with bearer auth by secretKey, never an inline Authorization header', async () => {
    const request = vi.fn(async (_req: NetworkRequest) => jsonResponse(200, { budgets: [budgetFixture] }));
    const client = new YNABClient({ request, secretKey: FAKE_SECRET_KEY });

    const budgets = await client.getBudgets();

    expect(budgets).toEqual([budgetFixture]);
    expect(request).toHaveBeenCalledTimes(1);
    const [sentRequest] = request.mock.calls[0] as [NetworkRequest];
    expect(sentRequest.url).toBe(`${YNAB_API_BASE_URL}/budgets`);
    expect(sentRequest.auth).toEqual({ type: 'bearer', secretKey: FAKE_SECRET_KEY });
    expect(sentRequest.headers?.Authorization).toBeUndefined();
    expect(JSON.stringify(sentRequest)).not.toContain('Bearer');
  });

  it('fetches budget settings (currency_format) for a budget', async () => {
    const request = vi.fn(async (_req: NetworkRequest) =>
      jsonResponse(200, { settings: { currency_format: budgetFixture.currency_format } }),
    );
    const client = new YNABClient({ request, secretKey: FAKE_SECRET_KEY });

    const settings = await client.getBudgetSettings('fake-budget-id');

    expect(settings.currency_format?.iso_code).toBe('USD');
    const [sentRequest] = request.mock.calls[0] as [NetworkRequest];
    expect(sentRequest.url).toBe(`${YNAB_API_BASE_URL}/budgets/fake-budget-id/settings`);
  });

  it('fetches accounts for a budget', async () => {
    const account = { id: 'acct-1', name: 'Checking', type: 'checking', on_budget: true, closed: false, note: null, balance: 100000, cleared_balance: 100000, uncleared_balance: 0, transfer_payee_id: null, deleted: false };
    const request = vi.fn(async () => jsonResponse(200, { accounts: [account] }));
    const client = new YNABClient({ request, secretKey: FAKE_SECRET_KEY });

    const accounts = await client.getAccounts('fake-budget-id');

    expect(accounts).toEqual([account]);
  });

  it('requests transactions with since_date and last_knowledge_of_server as query params, and returns the server_knowledge cursor', async () => {
    const request = vi.fn(async (_req: NetworkRequest) => jsonResponse(200, { transactions: [], server_knowledge: 42 }));
    const client = new YNABClient({ request, secretKey: FAKE_SECRET_KEY });

    const page = await client.getTransactions('fake-budget-id', { sinceDate: '2026-01-01', lastKnowledgeOfServer: 10 });

    expect(page).toEqual({ transactions: [], serverKnowledge: 42 });
    const [sentRequest] = request.mock.calls[0] as [NetworkRequest];
    const url = new URL(sentRequest.url);
    expect(url.pathname).toBe('/v1/budgets/fake-budget-id/transactions');
    expect(url.searchParams.get('since_date')).toBe('2026-01-01');
    expect(url.searchParams.get('last_knowledge_of_server')).toBe('10');
  });

  it('omits query params entirely for a first-ever (no cursor) sync', async () => {
    const request = vi.fn(async (_req: NetworkRequest) => jsonResponse(200, { transactions: [], server_knowledge: 1 }));
    const client = new YNABClient({ request, secretKey: FAKE_SECRET_KEY });

    await client.getTransactions('fake-budget-id');

    const [sentRequest] = request.mock.calls[0] as [NetworkRequest];
    expect(sentRequest.url).toBe(`${YNAB_API_BASE_URL}/budgets/fake-budget-id/transactions`);
  });

  it('throws InvalidTokenError on 401', async () => {
    const client = new YNABClient({ request: async () => jsonResponse(401, null), secretKey: FAKE_SECRET_KEY });

    await expect(client.getBudgets()).rejects.toBeInstanceOf(InvalidTokenError);
  });

  it('throws RateLimitError with retryAfter parsed from a case-insensitive Retry-After header on 429', async () => {
    const client = new YNABClient({
      request: async () => ({ status: 429, headers: { 'retry-after': '120' }, body: '{}' }),
      secretKey: FAKE_SECRET_KEY,
    });

    const err = await client.getBudgets().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBe(120);
  });

  it('falls back to a safe default retryAfter when 429 has no Retry-After header', async () => {
    const client = new YNABClient({ request: async () => jsonResponse(429, null), secretKey: FAKE_SECRET_KEY });

    const err = await client.getBudgets().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RateLimitError);
    expect((err as RateLimitError).retryAfter).toBeGreaterThan(0);
  });

  it('throws ServerError (a NetworkError) on 5xx', async () => {
    const client = new YNABClient({ request: async () => jsonResponse(503, null), secretKey: FAKE_SECRET_KEY });

    const err = await client.getBudgets().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServerError);
    expect(err).toBeInstanceOf(NetworkError);
  });

  it('throws NetworkError when the brokered request itself rejects (host unreachable)', async () => {
    const client = new YNABClient({
      request: async () => {
        throw new Error('DNS resolution failed');
      },
      secretKey: FAKE_SECRET_KEY,
    });

    await expect(client.getBudgets()).rejects.toBeInstanceOf(NetworkError);
  });

  it('throws a generic YNABSyncError for other non-2xx statuses', async () => {
    const client = new YNABClient({ request: async () => jsonResponse(403, null), secretKey: FAKE_SECRET_KEY });

    await expect(client.getBudgets()).rejects.toBeInstanceOf(YNABSyncError);
  });

  describe('validateToken', () => {
    it('returns true when getBudgets succeeds', async () => {
      const client = new YNABClient({ request: async () => jsonResponse(200, { budgets: [] }), secretKey: FAKE_SECRET_KEY });
      await expect(client.validateToken()).resolves.toBe(true);
    });

    it('returns false on InvalidTokenError (401)', async () => {
      const client = new YNABClient({ request: async () => jsonResponse(401, null), secretKey: FAKE_SECRET_KEY });
      await expect(client.validateToken()).resolves.toBe(false);
    });

    it('rethrows non-auth errors (e.g. network down) rather than reporting them as an invalid token', async () => {
      const client = new YNABClient({
        request: async () => {
          throw new Error('offline');
        },
        secretKey: FAKE_SECRET_KEY,
      });
      await expect(client.validateToken()).rejects.toBeInstanceOf(NetworkError);
    });
  });
});
