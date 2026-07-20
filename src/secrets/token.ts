// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * YNAB personal access token management via ctx.api.secrets.
 * Token is never logged, rendered, or stored in persistent state.
 * Only existence check and retrieval via the SDK secrets API.
 *
 * Deviation note (Stage 3): the Stage 2 stub's `SecretsAPI` declared an
 * `exists(name)` method and had `get()` return `string | undefined`. The
 * installed `@wealthfolio/addon-sdk` (3.6.2) `SecretsAPI` has only
 * `set`/`get`/`delete` — no `exists` — and `get()` returns `string | null`.
 * `hasYNABToken` below is reimplemented as `get(...) !== null`, matching the
 * spec's own description of the existence check ("Reads are existence-only
 * (`get(...) !== null`)", docs/SPEC.md §3.5).
 *
 * IMPORTANT for callers: the actual outbound request path
 * (src/ynab/client.ts) never calls `getYNABToken` at all — the network
 * broker resolves the secret by name itself via `NetworkAuth.secretKey`.
 * `getYNABToken` exists only for the narrow, spec-mandated case of an
 * addon-initiated `validateToken()`-style check that must still avoid ever
 * rendering the value; today nothing in this addon needs the plaintext, so
 * prefer NOT calling this function unless you have a concrete need — every
 * call is a chance to accidentally log or render it.
 */

export const YNAB_TOKEN_SECRET_NAME = 'ynab-personal-access-token';

/**
 * Secrets API interface (from ctx.api.secrets).
 */
export interface SecretsAPI {
  set(name: string, value: string): Promise<void>;
  get(name: string): Promise<string | null>;
  delete(name: string): Promise<void>;
}

/**
 * Check if a YNAB token is stored, without ever returning its value.
 */
export async function hasYNABToken(secrets: SecretsAPI): Promise<boolean> {
  return (await secrets.get(YNAB_TOKEN_SECRET_NAME)) !== null;
}

/**
 * Retrieve the stored YNAB token.
 * WARNING: Only call when token is needed for API requests.
 * Do not log or render this value.
 */
export async function getYNABToken(secrets: SecretsAPI): Promise<string | null> {
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
