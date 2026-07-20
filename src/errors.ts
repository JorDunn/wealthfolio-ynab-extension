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
