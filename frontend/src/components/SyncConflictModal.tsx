import React from 'react';
import type { PendingOperation } from '../db';

interface SyncConflictModalProps {
  conflict: PendingOperation;
  onResolve: (action: 'discard' | 'retry') => void;
}

const SyncConflictModal: React.FC<SyncConflictModalProps> = ({
  conflict,
  onResolve
}) => {
  const getConflictMessage = () => {
    switch (conflict.type) {
      case 'CREATE_EXPENSE':
        return 'An expense you created offline could not be synced. It may already exist or the group has been modified.';
      case 'UPDATE_EXPENSE':
        return 'An expense you edited offline was also modified by someone else.';
      case 'DELETE_EXPENSE':
        return 'An expense you deleted offline was already deleted or modified.';
      case 'CREATE_GROUP':
        return 'A group you created offline could not be synced.';
      case 'UPDATE_GROUP':
        return 'A group you edited offline was also modified by someone else.';
      default:
        return 'There was a sync conflict with your offline changes.';
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white dark:bg-gray-800 rounded-lg p-6 max-w-md mx-4">
        <h3 className="text-lg font-semibold mb-4 dark:text-white">
          Sync Conflict
        </h3>

        <p className="text-gray-600 dark:text-gray-300 mb-4">
          {getConflictMessage()}
        </p>

        <div className="bg-gray-100 dark:bg-gray-700 rounded p-3 mb-4 text-sm">
          <p className="dark:text-gray-200">
            <strong>Operation:</strong> {conflict.type}
          </p>
          <p className="dark:text-gray-200">
            <strong>Created:</strong>{' '}
            {new Date(conflict.created_at).toLocaleString()}
          </p>
          {conflict.last_error && (
            <p className="text-red-500 mt-2">
              <strong>Error:</strong> {conflict.last_error}
            </p>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={() => onResolve('discard')}
            className="px-4 py-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
          >
            Discard Local
          </button>
          <button
            onClick={() => onResolve('retry')}
            className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600"
          >
            Retry Sync
          </button>
        </div>
      </div>
    </div>
  );
};

export default SyncConflictModal;
