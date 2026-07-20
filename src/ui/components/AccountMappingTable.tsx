// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Account mapping table (docs/SPEC.md §3.2, §3.6 item 3). One row per YNAB
 * account with a dropdown of Wealthfolio accounts; an unmapped row means
 * that YNAB account's transactions are never read into Wealthfolio.
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@wealthfolio/ui';
import type { Account } from '@wealthfolio/addon-sdk';
import type { YnabAccount } from '../../ynab/types';
import type { AccountMappingSchema } from '../../state/schema';

export const UNMAPPED_VALUE = '__unmapped__';

export interface AccountMappingTableProps {
  ynabAccounts: YnabAccount[];
  wealthfolioAccounts: Account[];
  mapping: AccountMappingSchema;
  disabled?: boolean;
  onChange: (ynabAccountId: string, wealthfolioAccountId: string | null) => Promise<void>;
}

export function AccountMappingTable({
  ynabAccounts,
  wealthfolioAccounts,
  mapping,
  disabled,
  onChange,
}: AccountMappingTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account mapping</CardTitle>
        <CardDescription>
          Map each YNAB account to a Wealthfolio account. Unmapped YNAB accounts are ignored
          entirely — their transactions are never imported.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {ynabAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No YNAB accounts to map yet.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>YNAB account</TableHead>
                <TableHead>Wealthfolio account</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ynabAccounts.map((account) => {
                const currentMapping = mapping[account.id] ?? UNMAPPED_VALUE;
                return (
                  <TableRow key={account.id}>
                    <TableCell>{account.name}</TableCell>
                    <TableCell>
                      <Select
                        value={currentMapping}
                        disabled={disabled}
                        onValueChange={(value) =>
                          void onChange(account.id, value === UNMAPPED_VALUE ? null : value)
                        }
                      >
                        <SelectTrigger aria-label={`Map ${account.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={UNMAPPED_VALUE}>Not synced</SelectItem>
                          {wealthfolioAccounts.map((wfAccount) => (
                            <SelectItem key={wfAccount.id} value={wfAccount.id}>
                              {wfAccount.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
