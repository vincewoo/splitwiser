import React, { useState, useEffect } from 'react';
import { getApiUrl } from './api';
import IconSelector from './components/expense/IconSelector';
import { useCurrencyPreferences } from './hooks/useCurrencyPreferences';
import { formatCurrencyDisplay } from './utils/currencyHelpers';

interface Group {
    id: number;
    name: string;
    created_by_id: number;
    default_currency: string;
    icon?: string | null;
}

interface EditGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    group: Group;
    onGroupUpdated: (group: { id: number; name: string; created_by_id: number; default_currency: string; icon?: string | null }) => void;
}

const EditGroupModal: React.FC<EditGroupModalProps> = ({ isOpen, onClose, group, onGroupUpdated }) => {
    const { sortedCurrencies, recordCurrencyUsage } = useCurrencyPreferences();
    const [name, setName] = useState(group.name);
    const [currency, setCurrency] = useState(group.default_currency || 'USD');
    const [selectedIcon, setSelectedIcon] = useState<string | null>(group.icon || null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setName(group.name);
        setCurrency(group.default_currency || 'USD');
        setSelectedIcon(group.icon || null);
        setError(null);
    }, [group, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        const token = localStorage.getItem('token');
        const response = await fetch(getApiUrl(`groups/${group.id}`), {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, default_currency: currency, icon: selectedIcon })
        });

        setIsSubmitting(false);

        if (response.ok) {
            // Record currency usage for sorting
            recordCurrencyUsage(currency);
            const updatedGroup = await response.json();
            onGroupUpdated({ ...group, ...updatedGroup });
        } else {
            const err = await response.json();
            setError(err.detail || 'Failed to update group');
        }
    };

    return (
        <div className="fixed inset-0 bg-gray-600 dark:bg-gray-900/75 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50">
            <div className="bg-white dark:bg-gray-800 p-5 rounded-lg shadow-xl dark:shadow-gray-900/50 w-96">
                <h2 className="text-xl font-bold mb-4 dark:text-gray-100">Edit Group</h2>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">
                            Group Name
                        </label>
                        <div className="flex items-center gap-2">
                            <IconSelector
                                selectedIcon={selectedIcon}
                                onIconSelect={setSelectedIcon}
                            />
                            <input
                                type="text"
                                className="flex-1 border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 dark:bg-gray-800 dark:text-gray-100"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                required
                            />
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="block text-gray-700 dark:text-gray-300 text-sm font-bold mb-2">
                            Default Currency
                        </label>
                        <select
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value)}
                            className="w-full border-b border-gray-300 dark:border-gray-600 py-2 focus:outline-none focus:border-teal-500 bg-white dark:bg-gray-700 dark:text-gray-100"
                        >
                            {sortedCurrencies.map(c => (
                                <option key={c.code} value={c.code}>
                                    {formatCurrencyDisplay(c.code)}
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            New expenses will default to this currency
                        </p>
                    </div>

                    {error && (
                        <p className="mb-4 text-sm text-red-500 dark:text-red-400">{error}</p>
                    )}

                    <div className="flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 disabled:opacity-50"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default EditGroupModal;
