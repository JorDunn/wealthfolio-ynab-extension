// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * YNAB personal access token management via ctx.api.secrets.
 * Token is never logged, rendered, or stored in persistent state.
 * Only existence check and retrieval via the SDK secrets API.
 */

export const YNAB_TOKEN_SECRET_NAME = 'ynab-personal-access-token';

/**
 * Secrets API interface (from ctx.api.secrets).
 */
export interface SecretsAPI {
  set(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | undefined>;
  delete(name: string): Promise<void>;
  exists(name: string): Promise<boolean>;
}

/**
 * Check if a YNAB token is stored.
 */
export async function hasYNABToken(secrets: SecretsAPI): Promise<boolean> {
  return await secrets.exists(YNAB_TOKEN_SECRET_NAME);
}

/**
 * Retrieve the stored YNAB token.
 * WARNING: Only call when token is needed for API requests.
 * Do not log or render this value.
 */
export async function getYNABToken(secrets: SecretsAPI): Promise<string | undefined> {
  return await secrets.get(YNAB_TOKEN_SECRET_NAME);
}

/**
 * Store a YNAB personal access token.
 */
export async function setYNABToken(secrets: SecretsAPI, token: string): Promise<void> {
  await secrets.set(YNAB_TOKEN_SECRET_NAME, token);
}

/**
 * Delete the stored YNAB token.
 */
export async function deleteYNABToken(secrets: SecretsAPI): Promise<void> {
  await secrets.delete(YNAB_TOKEN_SECRET_NAME);
}
