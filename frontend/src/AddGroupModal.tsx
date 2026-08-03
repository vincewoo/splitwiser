import React, { useState, useEffect } from 'react';
import { X } from '@phosphor-icons/react';
import IconSelector from './components/expense/IconSelector';
import { useCurrencyPreferences } from './hooks/useCurrencyPreferences';
import { formatCurrencyDisplay } from './utils/currencyHelpers';
import { offlineGroupsApi } from './services/offlineApi';
import { useSync } from './contexts/SyncContext';
import { Button, Notice } from './components/ui';
import { CONTROL_CLASS } from './components/ui/controlClass';

interface AddGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onGroupAdded: () => void;
}

const AddGroupModal: React.FC<AddGroupModalProps> = ({ isOpen, onClose, onGroupAdded }) => {
    const { isOnline: _isOnline } = useSync();
    const { sortedCurrencies, recordCurrencyUsage } = useCurrencyPreferences();
    const [name, setName] = useState('');
    const [currency, setCurrency] = useState('USD');
    const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setName('');
            setCurrency('USD');
            setSelectedIcon(null);
            setError(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim()) {
            setError('Group name is required');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const result = await offlineGroupsApi.create(name.trim(), currency, selectedIcon);

            if (result.success) {
                // Record currency usage for sorting
                recordCurrencyUsage(currency);

                if (result.offline) {
                    console.log('Group created offline and queued for sync');
                }

                onGroupAdded();
                onClose();
            } else {
                setError('Failed to create group');
            }
        } catch {
            setError('Network error. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/55 z-50 flex items-end md:items-center justify-center font-sans"
            onClick={handleBackdropClick}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Create new group"
                className="bg-sw-surface text-sw-text w-full md:w-[400px] max-h-[90vh] overflow-y-auto rounded-t-sw-sheet md:rounded-sw-card-lg shadow-[0_0_0_1px_var(--sw-line)]"
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-sw-line">
                    <h2 className="sw-heading text-[17px]">Create new group</h2>
                    <button
                        type="button"
                        onClick={onClose}
                        className="text-sw-dim hover:text-sw-text p-2 -mr-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-sw-accent focus-visible:outline-offset-2 rounded-lg"
                        aria-label="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-5">
                    <div className="mb-6">
                        <label
                            className="block text-[12.5px] text-sw-muted mb-1.5"
                            htmlFor="new-group-name"
                        >
                            Group name
                        </label>
                        <div className="flex items-center gap-2">
                            <IconSelector
                                selectedIcon={selectedIcon}
                                onIconSelect={setSelectedIcon}
                            />
                            <input
                                id="new-group-name"
                                type="text"
                                className={CONTROL_CLASS}
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g., Weekend Trip, Roommates"
                                autoFocus
                                required
                            />
                        </div>
                    </div>

                    <div className="mb-6">
                        <label
                            className="block text-[12.5px] text-sw-muted mb-1.5"
                            htmlFor="new-group-currency"
                        >
                            Default currency
                        </label>
                        <select
                            id="new-group-currency"
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value)}
                            className={CONTROL_CLASS}
                        >
                            {sortedCurrencies.map(c => (
                                <option key={c.code} value={c.code}>
                                    {formatCurrencyDisplay(c.code)}
                                </option>
                            ))}
                        </select>
                        <p className="text-[11.5px] text-sw-dim mt-1.5">
                            New expenses will default to this currency
                        </p>
                    </div>

                    {error && (
                        <Notice tone="error" className="mb-4">
                            {error}
                        </Notice>
                    )}

                    <div className="flex flex-col-reverse md:flex-row gap-3">
                        <Button
                            variant="secondary"
                            onClick={onClose}
                            disabled={isSubmitting}
                            className="flex-1 py-3 min-h-[44px]"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            variant="primary"
                            disabled={isSubmitting}
                            className="flex-1 py-3 min-h-[44px]"
                        >
                            {isSubmitting ? 'Creating…' : 'Create group'}
                        </Button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddGroupModal;
