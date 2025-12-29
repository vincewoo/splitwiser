import React, { useState, useEffect } from 'react';
import { getApiUrl } from './api';

interface GroupMember {
    id: number;
    user_id: number;
    full_name: string;
    email: string;
    managed_by_id: number | null;
    managed_by_name: string | null;
}

interface GuestMember {
    id: number;
    name: string;
}

interface ManageMemberModalProps {
    isOpen: boolean;
    onClose: () => void;
    member: GroupMember | null;
    groupId: string;
    groupMembers: GroupMember[];
    groupGuests: GuestMember[];
    onMemberUpdated: () => void;
}

const ManageMemberModal: React.FC<ManageMemberModalProps> = ({
    isOpen,
    onClose,
    member,
    groupId,
    groupMembers,
    groupGuests,
    onMemberUpdated
}) => {
    const [selectedManagerId, setSelectedManagerId] = useState<number | null>(null);
    const [selectedIsGuest, setSelectedIsGuest] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen && member) {
            setSelectedManagerId(member.managed_by_id);
            setSelectedIsGuest(false);  // Reset, will be set by dropdown
            setError(null);
        }
    }, [isOpen, member]);

    if (!isOpen || !member) return null;

    const handleSetManager = async () => {
        if (!selectedManagerId) {
            setError('Please select a manager');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(
                getApiUrl(`groups/${groupId}/members/${member.user_id}/manage`),
                {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        user_id: selectedManagerId,
                        is_guest: selectedIsGuest
                    })
                }
            );

            if (response.ok) {
                onMemberUpdated();
                onClose();
            } else {
                const err = await response.json();
                setError(err.detail || 'Failed to set manager');
            }
        } catch (error) {
            setError('Network error. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRemoveManager = async () => {
        setIsSubmitting(true);
        setError(null);

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(
                getApiUrl(`groups/${groupId}/members/${member.user_id}/manage`),
                {
                    method: 'DELETE',
                    headers: {
                        Authorization: `Bearer ${token}`
                    }
                }
            );

            if (response.ok) {
                onMemberUpdated();
                onClose();
            } else {
                const err = await response.json();
                setError(err.detail || 'Failed to remove manager');
            }
        } catch (error) {
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

    const handleManagerChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const value = e.target.value;
        if (!value) {
            setSelectedManagerId(null);
            setSelectedIsGuest(false);
            return;
        }

        const [type, id] = value.split('-');
        setSelectedManagerId(Number(id));
        setSelectedIsGuest(type === 'guest');
    };

    // Filter out the current member from selectable members
    const selectableMembers = groupMembers.filter(m => m.user_id !== member.user_id);

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end md:items-center justify-center"
            onClick={handleBackdropClick}
        >
            <div className="bg-white dark:bg-gray-800 w-full md:w-[480px] md:rounded-lg shadow-xl transform transition-all max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b dark:border-gray-700">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">
                        Manage Member: {member.full_name}
                    </h2>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 p-2 -mr-2"
                        aria-label="Close"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Content */}
                <div className="p-5">
                    <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
                        Link this member to another group member or guest to combine their balances for settlement.
                        The member will still appear separately in expense details.
                    </p>

                    {/* Current Manager Display */}
                    {member.managed_by_name && (
                        <div className="mb-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                            <p className="text-sm text-blue-700 dark:text-blue-300">
                                Currently managed by: <strong>{member.managed_by_name}</strong>
                            </p>
                        </div>
                    )}

                    {/* Manager Selection */}
                    <div className="mb-6">
                        <label className="block text-gray-700 dark:text-gray-300 text-sm font-semibold mb-2">
                            Select Manager
                        </label>
                        <select
                            value={selectedManagerId && selectedIsGuest !== undefined ? `${selectedIsGuest ? 'guest' : 'user'}-${selectedManagerId}` : ''}
                            onChange={handleManagerChange}
                            className="w-full px-4 py-3 text-base border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-teal-500 dark:focus:border-teal-400 dark:bg-gray-700 dark:text-gray-100"
                            disabled={isSubmitting}
                        >
                            <option value="">-- Select a Manager --</option>
                            <optgroup label="Users">
                                {[...selectableMembers].sort((a, b) => a.full_name.localeCompare(b.full_name)).map(m => (
                                    <option key={`user-${m.user_id}`} value={`user-${m.user_id}`}>
                                        {m.full_name}
                                    </option>
                                ))}
                            </optgroup>
                            {groupGuests.length > 0 && (
                                <optgroup label="Guests">
                                    {[...groupGuests].sort((a, b) => a.name.localeCompare(b.name)).map(g => (
                                        <option key={`guest-${g.id}`} value={`guest-${g.id}`}>
                                            {g.name}
                                        </option>
                                    ))}
                                </optgroup>
                            )}
                        </select>
                    </div>

                    {error && (
                        <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-3">
                        <button
                            onClick={handleSetManager}
                            className="w-full px-6 py-3 bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors min-h-[44px]"
                            disabled={isSubmitting || !selectedManagerId}
                        >
                            {isSubmitting ? 'Saving...' : member.managed_by_id ? 'Update Manager' : 'Set Manager'}
                        </button>

                        {member.managed_by_id && (
                            <button
                                onClick={handleRemoveManager}
                                className="w-full px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors min-h-[44px]"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? 'Removing...' : 'Remove Manager'}
                            </button>
                        )}

                        <button
                            onClick={onClose}
                            className="w-full px-6 py-3 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors min-h-[44px]"
                            disabled={isSubmitting}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ManageMemberModal;
