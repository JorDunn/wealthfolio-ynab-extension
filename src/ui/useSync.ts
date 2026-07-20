// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Jordan Dunn / NodeTwo

/**
 * React hook for managing sync state and triggering sync operations.
 * UI-free: returns state and callbacks for components to consume.
 */

export interface UseSyncState {
  isSyncing: boolean;
  error: string | null;
  lastSyncTime: number | null;
  syncedCount: number;
}

export interface UseSyncCallbacks {
  triggerSync: () => Promise<void>;
  clearError: () => void;
}

/**
 * Hook placeholder - to be implemented with actual logic.
 */
export function useSync(): UseSyncState & UseSyncCallbacks {
  return {
    isSyncing: false,
    error: null,
    lastSyncTime: null,
    syncedCount: 0,
    triggerSync: async () => {},
    clearError: () => {},
  };
}
