import React, { useState } from 'react';
import { getApiUrl } from './api';

interface Group {
    id: number;
    name: string;
    created_by_id: number;
}

interface DeleteGroupConfirmProps {
    isOpen: boolean;
    onClose: () => void;
    group: Group;
    onDeleted: () => void;
}

const DeleteGroupConfirm: React.FC<DeleteGroupConfirmProps> = ({ isOpen, onClose, group, onDeleted }) => {
    const [isDeleting, setIsDeleting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!isOpen) return null;

    const handleDelete = async () => {
        setIsDeleting(true);
        setError(null);

        const token = localStorage.getItem('token');
        const response = await fetch(getApiUrl(`groups/${group.id}`), {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` }
        });

        setIsDeleting(false);

        if (response.ok) {
            onDeleted();
        } else {
            const err = await response.json();
            setError(err.detail || 'Failed to delete group');
        }
    };

    return (
        <div className="fixed inset-0 bg-gray-600 dark:bg-gray-900/75 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 p-5 rounded-lg shadow-xl dark:shadow-gray-900/50 w-96">
                <h2 className="text-xl font-bold mb-4 text-red-600 dark:text-red-400">Delete Group</h2>

                <p className="text-gray-700 dark:text-gray-300 mb-4">
                    Are you sure you want to delete <strong>{group.name}</strong>?
                </p>

                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    This action cannot be undone. Existing expenses will be preserved but will no longer be associated with this group.
                </p>

                {error && (
                    <p className="mb-4 text-sm text-red-500 dark:text-red-400">{error}</p>
                )}

                <div className="flex justify-end space-x-3">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                        disabled={isDeleting}
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={handleDelete}
                        className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                        disabled={isDeleting}
                    >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default DeleteGroupConfirm;
