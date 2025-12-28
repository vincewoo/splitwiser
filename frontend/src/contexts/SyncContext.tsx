import React, { createContext, useContext, useEffect, useState } from 'react';
import { syncManager, type SyncStatus } from '../services/syncManager';
import type { PendingOperation } from '../db';

interface SyncContextType {
  isOnline: boolean;
  syncStatus: SyncStatus;
  pendingCount: number;
  lastSync: number | null;
  conflicts: PendingOperation[];
  sync: () => void;
  retryFailed: () => void;
  discardConflict: (id: string) => void;
}

const SyncContext = createContext<SyncContextType | null>(null);

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({
  children
}) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [syncState, setSyncState] = useState({
    status: 'idle' as SyncStatus,
    pendingCount: 0,
    lastSync: null as number | null,
    conflicts: [] as PendingOperation[]
  });

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    return syncManager.subscribe((state) => {
      setSyncState({
        status: state.status,
        pendingCount: state.pendingCount,
        lastSync: state.lastSync,
        conflicts: state.conflicts
      });
    });
  }, []);

  return (
    <SyncContext.Provider
      value={{
        isOnline,
        syncStatus: syncState.status,
        pendingCount: syncState.pendingCount,
        lastSync: syncState.lastSync,
        conflicts: syncState.conflicts,
        sync: () => syncManager.sync(),
        retryFailed: () => syncManager.retryFailed(),
        discardConflict: (id) => syncManager.discardOperation(id)
      }}
    >
      {children}
    </SyncContext.Provider>
  );
};

export const useSync = () => {
  const context = useContext(SyncContext);
  if (!context) throw new Error('useSync must be used within SyncProvider');
  return context;
};
