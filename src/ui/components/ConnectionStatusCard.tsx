// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Connection status + token entry (docs/SPEC.md §3.6 item 1).
 *
 * Thin display component: all persistence and validation happens in
 * `useSync`. The token field is write-only — it never receives an initial
 * value from props, is cleared immediately after a successful save, and
 * nothing here ever reads `getYNABToken()`. The "connected" state is purely
 * an existence check surfaced by the hook.
 */

import { useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@wealthfolio/ui';
import type { ConnectionStatus } from '../useSync';

export interface ConnectionStatusCardProps {
  status: ConnectionStatus;
  connectionError: string | null;
  busy: boolean;
  onSaveToken: (token: string) => Promise<void>;
  onRemoveToken: () => Promise<void>;
}

const STATUS_COPY: Record<ConnectionStatus, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'success' }> = {
  checking: { label: 'Checking…', variant: 'secondary' },
  'no-token': { label: 'No token saved', variant: 'secondary' },
  'invalid-token': { label: 'Invalid token', variant: 'destructive' },
  connected: { label: 'Connected', variant: 'success' },
};

export function ConnectionStatusCard({
  status,
  connectionError,
  busy,
  onSaveToken,
  onRemoveToken,
}: ConnectionStatusCardProps) {
  const [tokenInput, setTokenInput] = useState('');

  const handleSave = async () => {
    const token = tokenInput.trim();
    if (!token) return;
    await onSaveToken(token);
    setTokenInput('');
  };

  const copy = STATUS_COPY[status];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Connection
          <Badge variant={copy.variant}>{copy.label}</Badge>
        </CardTitle>
        <CardDescription>
          Your YNAB personal access token is stored via Wealthfolio&apos;s secrets API and is
          never shown once saved.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {status === 'invalid-token' && (
          <p className="text-sm text-destructive">
            Invalid token — re-enter your YNAB personal access token.
          </p>
        )}
        {connectionError && status !== 'invalid-token' && (
          <p className="text-sm text-destructive">{connectionError}</p>
        )}
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="ynab-token-input">YNAB personal access token</Label>
            <Input
              id="ynab-token-input"
              type="password"
              autoComplete="off"
              placeholder={status === 'connected' ? 'A token is saved' : 'Paste your token'}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              disabled={busy}
            />
          </div>
          <Button onClick={() => void handleSave()} disabled={busy || tokenInput.trim().length === 0}>
            Save token
          </Button>
          {status === 'connected' || status === 'invalid-token' ? (
            <Button variant="outline" onClick={() => void onRemoveToken()} disabled={busy}>
              Remove token
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
