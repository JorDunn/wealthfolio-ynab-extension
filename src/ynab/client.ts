// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Typed YNAB API v1 client.
 *
 * All requests go through the host's brokered network function
 * (`ctx.api.network.request`), the only way outbound HTTP can leave the
 * sandboxed addon iframe. Auth is delegated to the broker via `auth:
 * { type: 'bearer', secretKey }` — this client (and therefore the rest of
 * the addon) never reads, holds, or logs the plaintext YNAB personal access
 * token. The broker looks the secret up by name and injects the
 * `Authorization: Bearer <token>` header itself.
 *
 * Deviation note (Stage 3): the Stage 2 scaffold modeled the network call as
 * `request(url, init): Promise<Response>` (fetch-shaped) and had the client
 * build the `Authorization` header itself from a plaintext `apiKey` field.
 * The installed `@wealthfolio/addon-sdk` (3.6.2) `NetworkAPI` is actually
 * `request(request: NetworkRequest): Promise<NetworkResponse>`, a single
 * request object in, `{ status, headers, body: string }` out (not a fetch
 * `Response` — no `.ok`/`.json()`), with auth expressed via
 * `NetworkAuth.secretKey` rather than a caller-supplied header. Rebuilt
 * against the real shape; see docs/SPEC.md §8 open question 2.
 */

import type {
  YnabAccount,
  YnabBudgetSettings,
  YnabBudgetSummary,
  YnabTransaction,
  YnabTransactionsData,
} from './types';
import { InvalidTokenError, NetworkError, RateLimitError, ServerError, YNABSyncError } from '../errors';

export const YNAB_API_BASE_URL = 'https://api.ynab.com/v1';

/** Mirrors `@wealthfolio/addon-sdk`'s `NetworkAuth`. */
export interface NetworkAuth {
  type: 'bearer' | 'basic';
  secretKey: string;
}

/** Mirrors `@wealthfolio/addon-sdk`'s `NetworkRequest`. */
export interface NetworkRequest {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: string;
  auth?: NetworkAuth;
}

/** Mirrors `@wealthfolio/addon-sdk`'s `NetworkResponse`. */
export interface NetworkResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type NetworkRequestFn = (request: NetworkRequest) => Promise<NetworkResponse>;

export interface YNABClientConfig {
  /** `ctx.api.network.request`. */
  request: NetworkRequestFn;
  /** Name of the secret (as stored via `ctx.api.secrets`) holding the YNAB PAT. */
  secretKey: string;
}

export interface GetTransactionsOptions {
  /** ISO date (YYYY-MM-DD); only transactions on/after this date. Ignored if `lastKnowledgeOfServer` is set together with a prior sync — both may be sent per the YNAB API. */
  sinceDate?: string;
  /** Delta cursor from a previous call's `serverKnowledge`. Omit for a full sync. */
  lastKnowledgeOfServer?: number;
}

export interface TransactionsPage {
  transactions: YnabTransaction[];
  serverKnowledge: number;
}

interface YnabEnvelope<T> {
  data: T;
}

export class YNABClient {
  private readonly requestFn: NetworkRequestFn;
  private readonly secretKey: string;

  constructor(config: YNABClientConfig) {
    this.requestFn = config.request;
    this.secretKey = config.secretKey;
  }

  /** List all budgets visible to the token. */
  async getBudgets(): Promise<YnabBudgetSummary[]> {
    const data = await this.get<{ budgets: YnabBudgetSummary[] }>('/budgets');
    return data.budgets;
  }

  /** Budget settings, notably `currency_format.iso_code` (spec §3.3). */
  async getBudgetSettings(budgetId: string): Promise<YnabBudgetSettings> {
    const data = await this.get<{ settings: YnabBudgetSettings }>(
      `/budgets/${encodeURIComponent(budgetId)}/settings`,
    );
    return data.settings;
  }

  /** YNAB accounts for a budget, for the account-mapping UI (spec §3.2). */
  async getAccounts(budgetId: string): Promise<YnabAccount[]> {
    const data = await this.get<{ accounts: YnabAccount[] }>(
      `/budgets/${encodeURIComponent(budgetId)}/accounts`,
    );
    return data.accounts;
  }

  /**
   * Transactions for a budget, optionally as a delta since a prior
   * `serverKnowledge` cursor. Amounts are raw YNAB milliunits — convert with
   * `ynab/milliunits.ts` at the mapping boundary, not here.
   */
  async getTransactions(budgetId: string, options: GetTransactionsOptions = {}): Promise<TransactionsPage> {
    const params = new URLSearchParams();
    if (options.sinceDate) {
      params.set('since_date', options.sinceDate);
    }
    if (options.lastKnowledgeOfServer !== undefined) {
      params.set('last_knowledge_of_server', String(options.lastKnowledgeOfServer));
    }
    const qs = params.toString();
    const path = `/budgets/${encodeURIComponent(budgetId)}/transactions${qs ? `?${qs}` : ''}`;
    const data = await this.get<YnabTransactionsData>(path);
    return { transactions: data.transactions, serverKnowledge: data.server_knowledge };
  }

  /**
   * Validate the stored token by making a cheap authenticated call.
   * Returns `false` only for an auth failure (401); other errors
   * (network/5xx/429) are rethrown so callers can distinguish "bad token"
   * from "can't tell right now".
   */
  async validateToken(): Promise<boolean> {
    try {
      await this.getBudgets();
      return true;
    } catch (err) {
      if (err instanceof InvalidTokenError) {
        return false;
      }
      throw err;
    }
  }

  private async get<T>(path: string): Promise<T> {
    let response: NetworkResponse;
    try {
      response = await this.requestFn({
        url: `${YNAB_API_BASE_URL}${path}`,
        method: 'GET',
        auth: { type: 'bearer', secretKey: this.secretKey },
      });
    } catch {
      throw new NetworkError('Cannot reach api.ynab.com');
    }

    this.throwForStatus(response);

    try {
      const envelope = JSON.parse(response.body) as YnabEnvelope<T>;
      return envelope.data;
    } catch {
      throw new YNABSyncError('YNAB API returned an unparseable response body', 'YNAB_BAD_RESPONSE');
    }
  }

  private throwForStatus(response: NetworkResponse): void {
    if (response.status === 401) {
      throw new InvalidTokenError();
    }
    if (response.status === 429) {
      throw new RateLimitError(parseRetryAfterSeconds(response.headers));
    }
    if (response.status >= 500) {
      throw new ServerError(response.status);
    }
    if (response.status < 200 || response.status >= 300) {
      throw new YNABSyncError(`YNAB API error: HTTP ${response.status}`, 'YNAB_API_ERROR');
    }
  }
}

const DEFAULT_RETRY_AFTER_SECONDS = 3600;

function parseRetryAfterSeconds(headers: Record<string, string>): number {
  const key = Object.keys(headers).find((h) => h.toLowerCase() === 'retry-after');
  const raw = key ? headers[key] : undefined;
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : DEFAULT_RETRY_AFTER_SECONDS;
}
