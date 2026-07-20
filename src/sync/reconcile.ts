// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * Reconciliation: builds the "known set" that keeps sync idempotent
 * (docs/SPEC.md §3.4).
 *
 * known set = persisted id-map ∪ live `metadata`-tagged scan of every mapped
 * Wealthfolio account via `ctx.api.activities.getAll(accountId)`.
 *
 * The live scan is the load-bearing half: because the sync cursor only
 * advances after a full-batch success, a run that fails partway through
 * leaves the *persisted* map stale (missing the items that DID get created
 * before the failure). The live scan re-discovers those from the host's own
 * activity records regardless of whether the persisted map caught up, so a
 * retried sync recognizes them and does not recreate them — this is what
 * keeps "run sync twice / after a partial failure -> zero duplicates" true.
 *
 * Deviation note (Stage 3, carries the same root cause as mapping.ts's
 * note): the spec assumed dedup would scan `externalId` on each activity.
 * The installed SDK's `ActivityDetails` has no `externalId`; the durable,
 * readable identifier this addon actually writes is `metadata` (see
 * mapping.ts `YnabActivityMetadata`). The live scan below reads
 * `activity.metadata.source === 'ynab'` and
 * `activity.metadata.ynabTransactionId` instead.
 */

import type { TransactionIdMap, TransactionMapEntry } from '../state/schema';
import { YNAB_METADATA_SOURCE } from './mapping';

/**
 * The shape this module reads from `ActivityDetails`. Only `id`/`accountId`
 * are required by the dedup logic itself; the rest are carried through into
 * `KnownSetEntry.snapshot` purely so the engine can rebuild a full
 * `ActivityUpdate` (a full-replace API, not a patch) when orphan-flagging a
 * YNAB-side delete without needing a second scan.
 */
export interface ActivityRecord {
  id: string;
  accountId: string;
  activityType?: string;
  activityDate?: string | Date;
  amount?: string | number | null;
  currency?: string;
  comment?: string;
  metadata?: Record<string, unknown>;
}

/** The minimal shape this module needs from `ctx.api.activities`. */
export interface ActivitiesLookupAPI {
  getAll(accountId?: string): Promise<ActivityRecord[]>;
}

/** A read-back snapshot of the currently-live activity, for rebuilding a full update payload (orphan-flagging). Never persisted. */
export interface ActivitySnapshot {
  accountId: string;
  activityType?: string;
  activityDate?: string | Date;
  amount?: string | number | null;
  currency?: string;
  comment?: string;
  metadata?: Record<string, unknown>;
}

export interface KnownSetEntry extends TransactionMapEntry {
  /** Present only when this entry was (re)discovered via the live scan this run. Absent for entries known only from the stale persisted map (e.g. the account is no longer mapped). */
  snapshot?: ActivitySnapshot;
}

/**
 * `Map<ynabTransactionId, KnownSetEntry>` — a fully-merged view combining
 * the persisted map with a live scan. Live entries win when both exist.
 */
export type KnownSet = Map<string, KnownSetEntry>;

/**
 * Build the known set for one budget's sync run.
 *
 * @param persistedMap   The budget's persisted `transactionIdMap`.
 * @param mappedWealthfolioAccountIds  Every Wealthfolio account currently
 *   mapped from this YNAB budget (spec §3.2 — only mapped accounts are ever
 *   scanned or synced).
 * @param activitiesApi  `ctx.api.activities` (or a subset/mock of it).
 */
export async function buildKnownSet(
  persistedMap: TransactionIdMap,
  mappedWealthfolioAccountIds: string[],
  activitiesApi: ActivitiesLookupAPI,
): Promise<KnownSet> {
  const known: KnownSet = new Map();

  for (const [ynabTxnId, entry] of Object.entries(persistedMap)) {
    known.set(ynabTxnId, { ...entry });
  }

  const uniqueAccountIds = Array.from(new Set(mappedWealthfolioAccountIds));
  const accountActivities = await Promise.all(
    uniqueAccountIds.map((accountId) => activitiesApi.getAll(accountId)),
  );

  for (const activities of accountActivities) {
    for (const activity of activities) {
      const ynabTxnId = extractYnabTransactionId(activity);
      if (ynabTxnId === null) {
        continue;
      }
      known.set(ynabTxnId, {
        wealthfolioActivityId: activity.id,
        orphaned: activity.metadata?.ynabDeleted === true,
        snapshot: {
          accountId: activity.accountId,
          activityType: activity.activityType,
          activityDate: activity.activityDate,
          amount: activity.amount,
          currency: activity.currency,
          comment: activity.comment,
          metadata: activity.metadata,
        },
      });
    }
  }

  return known;
}

function extractYnabTransactionId(activity: ActivityRecord): string | null {
  const metadata = activity.metadata;
  if (!metadata || metadata.source !== YNAB_METADATA_SOURCE) {
    return null;
  }
  const txnId = metadata.ynabTransactionId;
  return typeof txnId === 'string' ? txnId : null;
}

/**
 * Convert a `KnownSet` back into the plain-object shape storage persists —
 * strictly `{ wealthfolioActivityId, orphaned }`, dropping the runtime-only
 * `snapshot` so it never ends up in `ctx.api.storage`.
 */
export function knownSetToTransactionIdMap(knownSet: KnownSet): TransactionIdMap {
  const map: TransactionIdMap = {};
  for (const [ynabTxnId, entry] of knownSet.entries()) {
    map[ynabTxnId] = { wealthfolioActivityId: entry.wealthfolioActivityId, orphaned: entry.orphaned };
  }
  return map;
}
