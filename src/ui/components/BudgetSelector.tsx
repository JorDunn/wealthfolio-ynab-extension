// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Budget selector (docs/SPEC.md §3.6 item 2). Budgets are fetched live from
 * YNAB by `useSync`; selection is persisted via `StateStore` (never
 * `ctx.api.storage` directly).
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@wealthfolio/ui';
import type { YnabBudgetSummary } from '../../ynab/types';

export interface BudgetSelectorProps {
  budgets: YnabBudgetSummary[];
  activeBudgetId: string | null;
  disabled?: boolean;
  onSelect: (budgetId: string) => Promise<void>;
}

export function BudgetSelector({ budgets, activeBudgetId, disabled, onSelect }: BudgetSelectorProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Budget</CardTitle>
        <CardDescription>Choose the YNAB budget to sync transactions from.</CardDescription>
      </CardHeader>
      <CardContent>
        {budgets.length === 0 ? (
          <p className="text-sm text-muted-foreground">No budgets found for this token.</p>
        ) : (
          <Select
            value={activeBudgetId ?? undefined}
            onValueChange={(value) => void onSelect(value)}
            disabled={disabled}
          >
            <SelectTrigger aria-label="Select YNAB budget">
              <SelectValue placeholder="Select a budget" />
            </SelectTrigger>
            <SelectContent>
              {budgets.map((budget) => (
                <SelectItem key={budget.id} value={budget.id}>
                  {budget.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardContent>
    </Card>
  );
}
