// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * React hook wiring the UI to the Stage 3 sync core.
 *
 * UI-free logic lives here so `SyncPage.tsx` and `src/ui/components/*` stay
 * thin (CLAUDE.md code conventions). This hook owns:
 *  - connection status (token existence + live validation via a cheap
 *    `getBudgets()` call, per docs/SPEC.md §3.6 item 1),
 *  - the budget list/selection and the per-budget account mapping/settings
 *    (persisted exclusively through `StateStore`, never `ctx.api.storage`
 *    directly — CLAUDE.md hard rule),
 *  - constructing a fresh `SyncEngine` per "Sync now" click, exactly per the
 *    handoff's wiring snippet (`.claude/handoffs/handoff_stage_3.md` §1),
 *  - persisting `lastSyncError` on failure so the error log survives reload
 *    even though the engine itself only touches `BudgetStateSchema` on a
 *    full-batch success (spec §3.4 state-advance invariant).
 *
 * The YNAB personal access token itself never passes through this hook's
 * state — only `hasYNABToken()` existence checks and `setYNABToken`/
 * `deleteYNABToken` calls that write straight to `ctx.api.secrets`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Account, AddonContext } from '@wealthfolio/addon-sdk';
import { YNABClient, type NetworkRequestFn } from '../ynab/client';
import type { YnabAccount, YnabBudgetSummary } from '../ynab/types';
import { SyncEngine, type SyncSummary } from '../sync/engine';
import { StateStore } from '../state/store';
import {
  deleteYNABToken,
  hasYNABToken,
  setYNABToken,
  YNAB_TOKEN_SECRET_NAME,
} from '../secrets/token';
import type { AccountMappingSchema, BudgetStateSchema, UserConfigSchema } from '../state/schema';
import { InvalidTokenError } from '../errors';

export type ConnectionStatus = 'checking' | 'no-token' | 'invalid-token' | 'connected';

export interface UseSyncState {
  connectionStatus: ConnectionStatus;
  /** Set only when connectionStatus differs from 'invalid-token' but a background check still failed (e.g. network). Never the token value. */
  connectionError: string | null;
  budgets: YnabBudgetSummary[];
  activeBudgetId: string | null;
  ynabAccounts: YnabAccount[];
  wealthfolioAccounts: Account[];
  accountMapping: AccountMappingSchema;
  includeUnapproved: boolean;
  includeUncleared: boolean;
  isLoading: boolean;
  isSyncing: boolean;
  lastSyncSummary: SyncSummary | null;
  lastSyncTimestamp: number | null;
  /** Persisted `BudgetStateSchema.lastSyncError` — survives reload (spec §3.6 item 6). */
  persistedError: string | null;
}

export interface UseSyncActions {
  saveToken: (token: string) => Promise<void>;
  removeToken: () => Promise<void>;
  selectBudget: (budgetId: string) => Promise<void>;
  setAccountMapping: (ynabAccountId: string, wealthfolioAccountId: string | null) => Promise<void>;
  setIncludeUnapproved: (value: boolean) => Promise<void>;
  setIncludeUncleared: (value: boolean) => Promise<void>;
  triggerSync: () => Promise<void>;
}

function emptyBudgetState(): BudgetStateSchema {
  return {
    syncState: { lastKnowledgeOfServer: null, transactionIdMap: {}, lastSyncTimestamp: null },
    accountMappings: {},
    lastSyncError: null,
  };
}

function defaultUserConfig(): UserConfigSchema {
  return {
    activeBudgetId: null,
    autoSyncOnOpen: false,
    includeUnapproved: false,
    includeUncleared: false,
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Build a `YNABClient` from `ctx`, exactly per the Stage 3 handoff's wiring
 * snippet. The client never reads the token itself — the network broker
 * resolves `secretKey` and injects the `Authorization` header.
 */
function createYNABClient(ctx: AddonContext): YNABClient {
  const request: NetworkRequestFn = (req) => ctx.api.network.request(req);
  return new YNABClient({ request, secretKey: YNAB_TOKEN_SECRET_NAME });
}

export function useSync(ctx: AddonContext): UseSyncState & UseSyncActions {
  const stateStore = useMemo(() => new StateStore(ctx.api.storage), [ctx]);

  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('checking');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [budgets, setBudgets] = useState<YnabBudgetSummary[]>([]);
  const [activeBudgetId, setActiveBudgetId] = useState<string | null>(null);
  const [ynabAccounts, setYnabAccounts] = useState<YnabAccount[]>([]);
  const [wealthfolioAccounts, setWealthfolioAccounts] = useState<Account[]>([]);
  const [accountMapping, setAccountMappingState] = useState<AccountMappingSchema>({});
  const [includeUnapproved, setIncludeUnapprovedState] = useState(false);
  const [includeUncleared, setIncludeUnclearedState] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncSummary, setLastSyncSummary] = useState<SyncSummary | null>(null);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState<number | null>(null);
  const [persistedError, setPersistedError] = useState<string | null>(null);

  const loadBudgetDetails = useCallback(
    async (budgetId: string) => {
      const client = createYNABClient(ctx);
      const [fetchedYnabAccounts, fetchedWfAccounts, budgetState] = await Promise.all([
        client.getAccounts(budgetId),
        ctx.api.accounts.getAll(),
        stateStore.getBudgetState(budgetId),
      ]);
      setYnabAccounts(fetchedYnabAccounts.filter((a) => !a.closed && !a.deleted));
      setWealthfolioAccounts(fetchedWfAccounts);
      setAccountMappingState(budgetState?.accountMappings ?? {});
      setPersistedError(budgetState?.lastSyncError ?? null);
      setLastSyncTimestamp(budgetState?.syncState.lastSyncTimestamp ?? null);
    },
    [ctx, stateStore],
  );

  useEffect(() => {
    let cancelled = false;

    async function init() {
      setIsLoading(true);
      const tokenExists = await hasYNABToken(ctx.api.secrets);
      if (cancelled) return;
      if (!tokenExists) {
        setConnectionStatus('no-token');
        setIsLoading(false);
        return;
      }

      const client = createYNABClient(ctx);
      let fetchedBudgets: YnabBudgetSummary[];
      try {
        fetchedBudgets = await client.getBudgets();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof InvalidTokenError) {
          setConnectionStatus('invalid-token');
        } else {
          setConnectionStatus('connected');
          setConnectionError(errorMessage(err));
        }
        setIsLoading(false);
        return;
      }
      if (cancelled) return;
      setBudgets(fetchedBudgets);
      setConnectionStatus('connected');
      setConnectionError(null);

      const userConfig = (await stateStore.getUserConfig()) ?? defaultUserConfig();
      if (cancelled) return;
      setIncludeUnapprovedState(userConfig.includeUnapproved);
      setIncludeUnclearedState(userConfig.includeUncleared);
      if (userConfig.activeBudgetId) {
        setActiveBudgetId(userConfig.activeBudgetId);
        await loadBudgetDetails(userConfig.activeBudgetId);
      }
      if (!cancelled) setIsLoading(false);
    }

    void init();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per ctx identity; loadBudgetDetails is stable via useCallback([ctx, stateStore])
  }, [ctx]);

  const saveToken = useCallback(
    async (token: string) => {
      setIsLoading(true);
      await setYNABToken(ctx.api.secrets, token);
      const client = createYNABClient(ctx);
      try {
        const fetchedBudgets = await client.getBudgets();
        setBudgets(fetchedBudgets);
        setConnectionStatus('connected');
        setConnectionError(null);
      } catch (err) {
        if (err instanceof InvalidTokenError) {
          setConnectionStatus('invalid-token');
        } else {
          setConnectionStatus('connected');
          setConnectionError(errorMessage(err));
        }
      } finally {
        setIsLoading(false);
      }
    },
    [ctx],
  );

  const removeToken = useCallback(async () => {
    await deleteYNABToken(ctx.api.secrets);
    setConnectionStatus('no-token');
    setConnectionError(null);
    setBudgets([]);
    setActiveBudgetId(null);
    setYnabAccounts([]);
    setWealthfolioAccounts([]);
    setAccountMappingState({});
    setLastSyncSummary(null);
    setLastSyncTimestamp(null);
    setPersistedError(null);
  }, [ctx]);

  const selectBudget = useCallback(
    async (budgetId: string) => {
      setIsLoading(true);
      const userConfig = (await stateStore.getUserConfig()) ?? defaultUserConfig();
      await stateStore.setUserConfig({ ...userConfig, activeBudgetId: budgetId });
      setActiveBudgetId(budgetId);
      setLastSyncSummary(null);
      await loadBudgetDetails(budgetId);
      setIsLoading(false);
    },
    [stateStore, loadBudgetDetails],
  );

  const persistAccountMapping = useCallback(
    async (ynabAccountId: string, wealthfolioAccountId: string | null) => {
      if (!activeBudgetId) return;
      const current = (await stateStore.getBudgetState(activeBudgetId)) ?? emptyBudgetState();
      const nextMapping: AccountMappingSchema = { ...current.accountMappings };
      if (wealthfolioAccountId) {
        nextMapping[ynabAccountId] = wealthfolioAccountId;
      } else {
        delete nextMapping[ynabAccountId];
      }
      await stateStore.setBudgetState(activeBudgetId, { ...current, accountMappings: nextMapping });
      setAccountMappingState(nextMapping);
    },
    [activeBudgetId, stateStore],
  );

  const persistIncludeUnapproved = useCallback(
    async (value: boolean) => {
      const userConfig = (await stateStore.getUserConfig()) ?? defaultUserConfig();
      await stateStore.setUserConfig({ ...userConfig, includeUnapproved: value });
      setIncludeUnapprovedState(value);
    },
    [stateStore],
  );

  const persistIncludeUncleared = useCallback(
    async (value: boolean) => {
      const userConfig = (await stateStore.getUserConfig()) ?? defaultUserConfig();
      await stateStore.setUserConfig({ ...userConfig, includeUncleared: value });
      setIncludeUnclearedState(value);
    },
    [stateStore],
  );

  const triggerSync = useCallback(async () => {
    if (!activeBudgetId) return;
    setIsSyncing(true);
    try {
      const client = createYNABClient(ctx);
      const [budgetSettings, wfAccounts] = await Promise.all([
        client.getBudgetSettings(activeBudgetId),
        ctx.api.accounts.getAll(),
      ]);
      const budgetCurrency = budgetSettings?.currency_format?.iso_code ?? 'USD';
      const wealthfolioAccountCurrencies: Record<string, string> = {};
      for (const account of wfAccounts) {
        wealthfolioAccountCurrencies[account.id] = account.currency;
      }

      // Fresh engine per click (handoff §1: "construct fresh per sync click").
      const engine = new SyncEngine({
        ynabClient: client,
        activitiesApi: ctx.api.activities,
        stateStore,
        config: {
          budgetId: activeBudgetId,
          budgetCurrency,
          accountMapping,
          wealthfolioAccountCurrencies,
          includeUnapproved,
          includeUncleared,
        },
      });

      const summary = await engine.sync();
      setLastSyncSummary(summary);

      if (summary.success) {
        const newState = await stateStore.getBudgetState(activeBudgetId);
        setLastSyncTimestamp(newState?.syncState.lastSyncTimestamp ?? Date.now());
        setPersistedError(null);
      } else {
        const message = summary.errors[0] ?? 'Sync failed for an unknown reason.';
        // The engine never writes BudgetStateSchema on failure (state-advance
        // invariant, CLAUDE.md) — persist just the error field ourselves so
        // the error log survives a reload, without touching the cursor/map.
        const current = await stateStore.getBudgetState(activeBudgetId);
        if (current) {
          await stateStore.setBudgetState(activeBudgetId, { ...current, lastSyncError: message });
        }
        setPersistedError(message);
        if (summary.errorKind === 'invalid_token') {
          setConnectionStatus('invalid-token');
        }
      }
    } finally {
      setIsSyncing(false);
    }
  }, [ctx, activeBudgetId, accountMapping, includeUnapproved, includeUncleared, stateStore]);

  return {
    connectionStatus,
    connectionError,
    budgets,
    activeBudgetId,
    ynabAccounts,
    wealthfolioAccounts,
    accountMapping,
    includeUnapproved,
    includeUncleared,
    isLoading,
    isSyncing,
    lastSyncSummary,
    lastSyncTimestamp,
    persistedError,
    saveToken,
    removeToken,
    selectBudget,
    setAccountMapping: persistAccountMapping,
    setIncludeUnapproved: persistIncludeUnapproved,
    setIncludeUncleared: persistIncludeUncleared,
    triggerSync,
  };
}
