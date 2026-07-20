// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

import { describe, it, expect } from 'vitest';
import { YNABClient } from '../src/ynab/client';

describe('YNABClient', () => {
  it('should instantiate with a valid config', () => {
    const mockRequest = async (_url: string) => new Response('{}');
    const client = new YNABClient({
      apiKey: 'test-key',
      request: mockRequest,
    });

    expect(client).toBeDefined();
  });
});
