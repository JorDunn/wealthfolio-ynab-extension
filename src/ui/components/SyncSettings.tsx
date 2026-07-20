// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Eligibility toggles (docs/SPEC.md §3.3): both default off. Persisted via
 * `useSync` -> `StateStore` (`UserConfigSchema`).
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle, Label, Switch } from '@wealthfolio/ui';

export interface SyncSettingsProps {
  includeUnapproved: boolean;
  includeUncleared: boolean;
  disabled?: boolean;
  onChangeIncludeUnapproved: (value: boolean) => Promise<void>;
  onChangeIncludeUncleared: (value: boolean) => Promise<void>;
}

export function SyncSettings({
  includeUnapproved,
  includeUncleared,
  disabled,
  onChangeIncludeUnapproved,
  onChangeIncludeUncleared,
}: SyncSettingsProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sync settings</CardTitle>
        <CardDescription>
          By default only approved, cleared transactions sync — unapproved or uncleared entries
          in YNAB are still volatile and importing them early can churn.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <Label htmlFor="include-unapproved">Include unapproved transactions</Label>
          <Switch
            id="include-unapproved"
            checked={includeUnapproved}
            disabled={disabled}
            onCheckedChange={(checked) => void onChangeIncludeUnapproved(checked)}
          />
        </div>
        <div className="flex items-center justify-between">
          <Label htmlFor="include-uncleared">Include uncleared transactions</Label>
          <Switch
            id="include-uncleared"
            checked={includeUncleared}
            disabled={disabled}
            onCheckedChange={(checked) => void onChangeIncludeUncleared(checked)}
          />
        </div>
      </CardContent>
    </Card>
  );
}
