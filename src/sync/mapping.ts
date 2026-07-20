// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Pure YNAB-transaction -> Wealthfolio-activity mapping (docs/SPEC.md §3.3).
 *
 * No I/O, no state — every function here is a straight data transform so it
 * is exhaustively table-tested (tests/mapping.test.ts). The sync engine
 * (src/sync/engine.ts) is the only caller and owns everything stateful
 * (dedup, cursor advancement, applying to `ctx.api.activities`).
 */

import type { YnabTransaction } from '../ynab/types';
import { milliunitsToCurrency } from '../ynab/milliunits';

export enum WealthfolioActivityType {
  DEPOSIT = 'DEPOSIT',
  WITHDRAWAL = 'WITHDRAWAL',
  TRANSFER_IN = 'TRANSFER_IN',
  TRANSFER_OUT = 'TRANSFER_OUT',
}

export type SkipReason = 'zero-amount' | 'unmapped-account' | 'unapproved' | 'uncleared';

/** ynabAccountId -> wealthfolioAccountId. Absence = "ignored" (spec §3.2). */
export type AccountMapping = Record<string, string>;

export interface MappingConfig {
  budgetId: string;
  /** The YNAB budget's ISO currency code (`currency_format.iso_code`). */
  budgetCurrency: string;
  accountMapping: AccountMapping;
  /** wealthfolioAccountId -> that account's currency, for the mismatch warning (spec §3.3). */
  wealthfolioAccountCurrencies?: Record<string, string>;
  /** Default false: only `approved === true` transactions sync. */
  includeUnapproved: boolean;
  /** Default false: only non-"uncleared" transactions sync. */
  includeUncleared: boolean;
}

export interface ActivityDraft {
  ynabTransactionId: string;
  ynabAccountId: string;
  wealthfolioAccountId: string;
  budgetId: string;
  activityType: WealthfolioActivityType;
  /** Absolute decimal amount; direction is carried by activityType. */
  amount: number;
  currency: string;
  /** YNAB's `date` (YYYY-MM-DD), passed through as-is. */
  date: string;
  comment: string | null;
  /** True when the mapped WF account's currency differs from the budget currency (spec §3.3: warn, still record). */
  currencyMismatch: boolean;
}

export type MappingOutcome =
  | { kind: 'skip'; reason: SkipReason; ynabTransactionId: string }
  | { kind: 'mapped'; draft: ActivityDraft };

/**
 * Map one non-deleted YNAB transaction to either a skip reason or an
 * `ActivityDraft`. Deleted-transaction (orphan-flag) handling is stateful
 * (needs the known-id map) and lives in the engine, not here.
 *
 * Split transactions: only the parent's own `amount` and `transfer_account_id`
 * are read; `subtransactions[]` are never inspected. This is intentional —
 * per spec §3.3 a split syncs as one activity for the parent total. Known
 * limitation carried over from the spec: a split containing a transfer
 * subtransaction still maps via the plain DEPOSIT/WITHDRAWAL path below,
 * because YNAB only puts `transfer_account_id` on the leaf subtransaction,
 * never on the split parent — it will not produce a matched TRANSFER pair.
 */
export function mapTransaction(txn: YnabTransaction, config: MappingConfig): MappingOutcome {
  if (!(txn.account_id in config.accountMapping)) {
    return { kind: 'skip', reason: 'unmapped-account', ynabTransactionId: txn.id };
  }
  if (txn.amount === 0) {
    return { kind: 'skip', reason: 'zero-amount', ynabTransactionId: txn.id };
  }
  if (!config.includeUnapproved && !txn.approved) {
    return { kind: 'skip', reason: 'unapproved', ynabTransactionId: txn.id };
  }
  if (!config.includeUncleared && txn.cleared === 'uncleared') {
    return { kind: 'skip', reason: 'uncleared', ynabTransactionId: txn.id };
  }

  const isInflow = txn.amount > 0;
  const counterpartMapped =
    txn.transfer_account_id !== null && txn.transfer_account_id in config.accountMapping;

  const activityType = counterpartMapped
    ? mapTransferType(isInflow)
    : mapExternalFlowType(isInflow);

  const wealthfolioAccountId = config.accountMapping[txn.account_id];
  const wfCurrency = config.wealthfolioAccountCurrencies?.[wealthfolioAccountId];
  const currencyMismatch = wfCurrency !== undefined && wfCurrency !== config.budgetCurrency;

  return {
    kind: 'mapped',
    draft: {
      ynabTransactionId: txn.id,
      ynabAccountId: txn.account_id,
      wealthfolioAccountId,
      budgetId: config.budgetId,
      activityType,
      amount: milliunitsToCurrency(Math.abs(txn.amount)),
      currency: config.budgetCurrency,
      date: txn.date,
      comment: txn.memo,
      currencyMismatch,
    },
  };
}

function mapTransferType(isInflow: boolean): WealthfolioActivityType {
  return isInflow ? WealthfolioActivityType.TRANSFER_IN : WealthfolioActivityType.TRANSFER_OUT;
}

function mapExternalFlowType(isInflow: boolean): WealthfolioActivityType {
  return isInflow ? WealthfolioActivityType.DEPOSIT : WealthfolioActivityType.WITHDRAWAL;
}

/** `metadata.source` tag written on every activity this addon creates/updates. */
export const YNAB_METADATA_SOURCE = 'ynab';

/**
 * The metadata shape this addon round-trips through `ctx.api.activities`.
 *
 * Deviation note (Stage 3, important): docs/SPEC.md assumed an `externalId`
 * field ("third-party transaction reference") on the Wealthfolio Activity
 * model, settable on create/update, to carry the YNAB transaction id for
 * idempotency. The installed `@wealthfolio/addon-sdk` (3.6.2) type
 * declarations have no such field. `sourceSystem` / `sourceRecordId` /
 * `idempotencyKey` DO exist — but only on the read models (`Activity`,
 * `ActivityDetails`); `ActivityCreate`/`ActivityUpdate` (what `create`/
 * `update` actually accept) do not include them, so an addon cannot author
 * them. The only field that both (a) is accepted by `create`/`update` and
 * (b) round-trips back out on `ActivityDetails.metadata` for the dedup live
 * scan is `metadata`. Idempotency is therefore implemented by embedding the
 * YNAB transaction id in `metadata.ynabTransactionId`, tagged with
 * `metadata.source = "ynab"` so the live scan (src/sync/reconcile.ts) can
 * cheaply filter to this addon's own activities. See handoff for the
 * localized-fix note if a future SDK version reintroduces `externalId`.
 */
export interface YnabActivityMetadata extends Record<string, unknown> {
  source: 'ynab';
  budgetId: string;
  ynabAccountId: string;
  ynabTransactionId: string;
  /** Set only on orphan-flagged activities (spec §3.4) — never auto-deleted. */
  ynabDeleted?: true;
}

/** The subset of `ActivityCreate`/`ActivityUpdate` fields this addon writes. */
export interface WealthfolioActivityInput {
  accountId: string;
  activityType: string;
  activityDate: string;
  amount: number;
  currency: string;
  comment: string | null;
  metadata: YnabActivityMetadata;
}

/** Build the create/update payload (minus `id`) for a mapped draft. */
export function toActivityInput(draft: ActivityDraft): WealthfolioActivityInput {
  return {
    accountId: draft.wealthfolioAccountId,
    activityType: draft.activityType,
    activityDate: draft.date,
    amount: draft.amount,
    currency: draft.currency,
    comment: draft.comment,
    metadata: {
      source: YNAB_METADATA_SOURCE,
      budgetId: draft.budgetId,
      ynabAccountId: draft.ynabAccountId,
      ynabTransactionId: draft.ynabTransactionId,
    },
  };
}
