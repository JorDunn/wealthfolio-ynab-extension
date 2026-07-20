// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Core sync engine — orchestrates docs/SPEC.md §4's data flow:
 *
 *   1. load persisted state (cursor + id-map)
 *   2. fetch YNAB transactions (delta since the cursor)
 *   3. reconcile: known set = persisted map ∪ live metadata scan
 *   4. map each eligible transaction to an activity draft (or a skip reason)
 *   5. apply creates/updates via the injected activities API
 *   6. persist the new cursor + id-map — ONLY if the whole batch applied
 *   7. return a SyncSummary for the UI
 *
 * State-advance invariant (CLAUDE.md hard rule, spec §3.4/§3.7): the cursor
 * only moves on full-batch success. A fetch-stage error (401/429/network)
 * writes nothing. A mid-batch apply error stops immediately and writes
 * nothing either — the already-applied items are safe from duplication on
 * retry because the live scan (src/sync/reconcile.ts) re-discovers them
 * independent of whether the cursor advanced.
 */

import type { YnabTransaction } from '../ynab/types';
import {
  mapTransaction,
  toActivityInput,
  type AccountMapping,
  type MappingConfig,
} from './mapping';
import {
  buildKnownSet,
  knownSetToTransactionIdMap,
  type ActivitiesLookupAPI,
  type ActivitySnapshot,
  type KnownSet,
} from './reconcile';
import type { StateStore } from '../state/store';
import { InvalidTokenError, NetworkError, RateLimitError } from '../errors';

/** Structural subset of `YNABClient` — lets tests supply a lightweight mock instead of constructing a real client. */
export interface TransactionsFetcher {
  getTransactions(
    budgetId: string,
    options?: { sinceDate?: string; lastKnowledgeOfServer?: number },
  ): Promise<{ transactions: YnabTransaction[]; serverKnowledge: number }>;
}

/** The subset of `ActivityCreate`/`ActivityUpdate` this engine writes. */
export interface ActivityWriteInput {
  id?: string;
  accountId: string;
  activityType: string;
  activityDate: string | Date;
  amount?: string | number | null;
  currency?: string;
  comment?: string | null;
  metadata?: string | Record<string, unknown>;
}

export interface WrittenActivity {
  id: string;
}

/** Structural subset of `ctx.api.activities` this engine needs — exactly the manifest's declared functions (getAll, create, update); no `delete`/`saveMany`/`import`. */
export interface EngineActivitiesAPI extends ActivitiesLookupAPI {
  create(input: ActivityWriteInput): Promise<WrittenActivity>;
  update(input: ActivityWriteInput & { id: string }): Promise<WrittenActivity>;
}

export interface SyncEngineConfig {
  budgetId: string;
  /** YNAB budget's ISO currency (`currency_format.iso_code`). */
  budgetCurrency: string;
  /** ynabAccountId -> wealthfolioAccountId. Unmapped YNAB accounts are ignored entirely (spec §3.2). */
  accountMapping: AccountMapping;
  /** wealthfolioAccountId -> currency, for the currency-mismatch warning. */
  wealthfolioAccountCurrencies?: Record<string, string>;
  includeUnapproved: boolean;
  includeUncleared: boolean;
  /** Optional floor date for a first-ever sync; omitted on subsequent delta syncs. */
  sinceDate?: string;
}

export interface SyncEngineDeps {
  ynabClient: TransactionsFetcher;
  activitiesApi: EngineActivitiesAPI;
  stateStore: StateStore;
  config: SyncEngineConfig;
  /** Injectable clock for deterministic tests; defaults to `Date.now`. */
  now?: () => number;
}

export type SyncErrorKind = 'invalid_token' | 'rate_limited' | 'network' | 'partial_batch' | 'unknown';

export interface SyncSummary {
  success: boolean;
  created: number;
  updated: number;
  skipped: number;
  orphaned: number;
  warnings: string[];
  errors: string[];
  errorKind?: SyncErrorKind;
  /** Set only when `errorKind === 'rate_limited'` (spec §3.7). */
  retryAfterSeconds?: number;
}

const ORPHAN_TAG_PREFIX = '[ynab:deleted';

export class SyncEngine {
  constructor(private readonly deps: SyncEngineDeps) {}

  async sync(): Promise<SyncSummary> {
    const { budgetId, accountMapping } = this.deps.config;

    const persistedState = await this.deps.stateStore.getBudgetState(budgetId);
    const cursor = persistedState?.syncState.lastKnowledgeOfServer ?? null;
    const persistedMap = persistedState?.syncState.transactionIdMap ?? {};

    let page: { transactions: YnabTransaction[]; serverKnowledge: number };
    try {
      page = await this.deps.ynabClient.getTransactions(budgetId, {
        sinceDate: this.deps.config.sinceDate,
        lastKnowledgeOfServer: cursor ?? undefined,
      });
    } catch (err) {
      // Fetch-stage failure: nothing has been read or written. Cursor untouched.
      return failureSummary(err);
    }

    const mappedWealthfolioAccountIds = Object.values(accountMapping);
    const knownSet = await buildKnownSet(persistedMap, mappedWealthfolioAccountIds, this.deps.activitiesApi);

    const mappingConfig: MappingConfig = {
      budgetId,
      budgetCurrency: this.deps.config.budgetCurrency,
      accountMapping,
      wealthfolioAccountCurrencies: this.deps.config.wealthfolioAccountCurrencies,
      includeUnapproved: this.deps.config.includeUnapproved,
      includeUncleared: this.deps.config.includeUncleared,
    };

    const warnings: string[] = [];
    let skipped = 0;

    const toCreate: Array<{ txnId: string; input: ActivityWriteInput }> = [];
    const toUpdate: Array<{ txnId: string; wfActivityId: string; input: ActivityWriteInput & { id: string } }> = [];
    const toOrphan: Array<{ txnId: string; wfActivityId: string; input: ActivityWriteInput & { id: string } }> = [];

    for (const txn of page.transactions) {
      const entry = knownSet.get(txn.id);

      if (txn.deleted) {
        if (!entry || entry.orphaned) {
          // Never synced, or already orphan-flagged in a prior run: nothing to do.
          continue;
        }
        if (!entry.snapshot) {
          warnings.push(
            `YNAB transaction ${txn.id} was deleted, but its Wealthfolio activity could not be re-located to flag it (its account may no longer be mapped).`,
          );
          continue;
        }
        toOrphan.push({
          txnId: txn.id,
          wfActivityId: entry.wealthfolioActivityId,
          input: buildOrphanUpdateInput(entry.wealthfolioActivityId, entry.snapshot, txn),
        });
        warnings.push(
          `YNAB transaction ${txn.id} was deleted in YNAB. The matching Wealthfolio activity was flagged (comment + metadata.ynabDeleted), not deleted — remove it manually if appropriate.`,
        );
        continue;
      }

      const outcome = mapTransaction(txn, mappingConfig);

      if (outcome.kind === 'skip') {
        skipped += 1;
        if (entry && (outcome.reason === 'unapproved' || outcome.reason === 'uncleared')) {
          warnings.push(
            `YNAB transaction ${txn.id} is no longer eligible to sync (${outcome.reason}); its existing Wealthfolio activity was left unchanged.`,
          );
        }
        continue;
      }

      if (outcome.draft.currencyMismatch) {
        warnings.push(
          `YNAB transaction ${txn.id}: budget currency (${outcome.draft.currency}) differs from the mapped Wealthfolio account's currency; recorded anyway (no FX conversion).`,
        );
      }

      const input = toActivityInput(outcome.draft);
      if (entry) {
        toUpdate.push({ txnId: txn.id, wfActivityId: entry.wealthfolioActivityId, input: { ...input, id: entry.wealthfolioActivityId } });
      } else {
        toCreate.push({ txnId: txn.id, input });
      }
    }

    const touched: KnownSet = new Map(knownSet);
    let created = 0;
    let updated = 0;
    let orphaned = 0;
    let batchError: unknown;

    try {
      for (const item of toCreate) {
        const activity = await this.deps.activitiesApi.create(item.input);
        touched.set(item.txnId, { wealthfolioActivityId: activity.id, orphaned: false });
        created += 1;
      }
      for (const item of toUpdate) {
        await this.deps.activitiesApi.update(item.input);
        touched.set(item.txnId, { wealthfolioActivityId: item.wfActivityId, orphaned: false });
        updated += 1;
      }
      for (const item of toOrphan) {
        await this.deps.activitiesApi.update(item.input);
        touched.set(item.txnId, { wealthfolioActivityId: item.wfActivityId, orphaned: true });
        orphaned += 1;
      }
    } catch (err) {
      batchError = err;
    }

    if (batchError !== undefined) {
      const appliedCount = created + updated + orphaned;
      const remaining = toCreate.length + toUpdate.length + toOrphan.length - appliedCount;
      return {
        success: false,
        created,
        updated,
        skipped,
        orphaned,
        warnings,
        errors: [
          `Sync batch stopped partway through: ${errorMessage(batchError)}. ${appliedCount} item(s) applied before the failure, ${remaining} not yet attempted. The sync cursor was not advanced; the next sync will re-fetch the same delta and retry what's left without duplicating what already applied.`,
        ],
        errorKind: 'partial_batch',
      };
    }

    await this.deps.stateStore.setBudgetState(budgetId, {
      syncState: {
        lastKnowledgeOfServer: page.serverKnowledge,
        transactionIdMap: knownSetToTransactionIdMap(touched),
        lastSyncTimestamp: (this.deps.now ?? Date.now)(),
      },
      accountMappings: accountMapping,
      lastSyncError: null,
    });

    return {
      success: true,
      created,
      updated,
      skipped,
      orphaned,
      warnings,
      errors: [],
    };
  }
}

function buildOrphanUpdateInput(
  wfActivityId: string,
  snapshot: ActivitySnapshot,
  txn: YnabTransaction,
): ActivityWriteInput & { id: string } {
  const existingComment = snapshot.comment ?? '';
  const alreadyTagged = existingComment.includes(ORPHAN_TAG_PREFIX);
  const comment = alreadyTagged
    ? existingComment
    : `${existingComment}${existingComment ? ' ' : ''}${ORPHAN_TAG_PREFIX} ${txn.date}]`;

  return {
    id: wfActivityId,
    accountId: snapshot.accountId,
    activityType: snapshot.activityType ?? 'WITHDRAWAL',
    activityDate: snapshot.activityDate ?? txn.date,
    amount: snapshot.amount ?? null,
    currency: snapshot.currency,
    comment,
    metadata: { ...(snapshot.metadata ?? {}), ynabDeleted: true },
  };
}

function failureSummary(err: unknown): SyncSummary {
  const base: SyncSummary = {
    success: false,
    created: 0,
    updated: 0,
    skipped: 0,
    orphaned: 0,
    warnings: [],
    errors: [errorMessage(err)],
  };
  if (err instanceof InvalidTokenError) {
    return { ...base, errorKind: 'invalid_token' };
  }
  if (err instanceof RateLimitError) {
    return { ...base, errorKind: 'rate_limited', retryAfterSeconds: err.retryAfter };
  }
  if (err instanceof NetworkError) {
    return { ...base, errorKind: 'network' };
  }
  return { ...base, errorKind: 'unknown' };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
