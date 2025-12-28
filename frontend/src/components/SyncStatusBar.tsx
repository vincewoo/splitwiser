import React from 'react';
import { useSync } from '../contexts/SyncContext';

const SyncStatusBar: React.FC = () => {
  const { isOnline, syncStatus, pendingCount, conflicts } = useSync();

  // Hide when online and everything is synced
  if (isOnline && syncStatus === 'idle' && pendingCount === 0) {
    return null;
  }

  return (
    <div
      className={`fixed bottom-0 left-0 right-0 p-2 text-sm text-center z-40 ${
        !isOnline
          ? 'bg-yellow-500 text-yellow-900'
          : syncStatus === 'error' || conflicts.length > 0
          ? 'bg-red-500 text-white'
          : syncStatus === 'syncing'
          ? 'bg-blue-500 text-white'
          : 'bg-teal-500 text-white'
      }`}
    >
      {!isOnline && (
        <span className="flex items-center justify-center gap-2">
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          Offline - {pendingCount} change{pendingCount !== 1 ? 's' : ''}{' '}
          pending
        </span>
      )}

      {isOnline && syncStatus === 'syncing' && (
        <span className="flex items-center justify-center gap-2">
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          Syncing changes...
        </span>
      )}

      {isOnline && conflicts.length > 0 && (
        <span>
          {conflicts.length} sync conflict{conflicts.length !== 1 ? 's' : ''}{' '}
          detected
        </span>
      )}

      {isOnline && syncStatus === 'idle' && pendingCount > 0 && (
        <span>
          {pendingCount} change{pendingCount !== 1 ? 's' : ''} pending sync
        </span>
      )}
    </div>
  );
};

export default SyncStatusBar;
