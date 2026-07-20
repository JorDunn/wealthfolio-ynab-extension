// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Custom error types for the YNAB sync addon.
 */

export class YNABSyncError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'YNABSyncError';
  }
}

export class InvalidTokenError extends YNABSyncError {
  constructor() {
    super('Invalid YNAB personal access token', 'INVALID_TOKEN');
    this.name = 'InvalidTokenError';
  }
}

export class NetworkError extends YNABSyncError {
  constructor(message: string = 'Cannot reach api.ynab.com') {
    super(message, 'NETWORK_ERROR');
    this.name = 'NetworkError';
  }
}

/**
 * YNAB responded but with a 5xx status. Modeled as a `NetworkError` subclass
 * (rather than a sibling) so existing `instanceof NetworkError` handling in
 * the UI (per the spec's failure model, 5xx has no distinct user-facing copy
 * from "cannot reach api.ynab.com") already covers it, while still being
 * distinguishable via `instanceof ServerError` / `.status` for logging.
 */
export class ServerError extends NetworkError {
  constructor(public readonly status: number) {
    super(`YNAB API server error (HTTP ${status})`);
    this.name = 'ServerError';
  }
}

export class RateLimitError extends YNABSyncError {
  constructor(public readonly retryAfter: number) {
    super(`Rate limited. Retry after ${retryAfter}s`, 'RATE_LIMITED');
    this.name = 'RateLimitError';
  }
}

export class SyncError extends YNABSyncError {
  constructor(message: string, code: string = 'SYNC_ERROR') {
    super(message, code);
    this.name = 'SyncError';
  }
}

/**
 * A batch of activity creates/updates stopped partway through. Carries the
 * counts already applied so the engine can report "succeeded vs failed"
 * without the caller needing to re-derive it. The state-advance invariant
 * (CLAUDE.md hard rule) means the sync cursor must NOT move when this is
 * thrown/returned.
 */
export class PartialBatchError extends YNABSyncError {
  constructor(
    message: string,
    public readonly succeededCount: number,
    public readonly cause?: unknown,
  ) {
    super(message, 'PARTIAL_BATCH');
    this.name = 'PartialBatchError';
  }
}
