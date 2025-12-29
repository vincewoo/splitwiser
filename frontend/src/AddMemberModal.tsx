import React, { useState, useEffect } from 'react';
import { api } from './services/api';

interface Friend {
    id: number;
    full_name: string;
    email: string;
}

interface AddMemberModalProps {
    isOpen: boolean;
    onClose: () => void;
    onMemberAdded: () => void;
    groupId: string;
    friends?: Friend[];
}

const AddMemberModal: React.FC<AddMemberModalProps> = ({ isOpen, onClose, onMemberAdded, groupId, friends = [] }) => {
    const [email, setEmail] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setEmail('');
            setSearchQuery('');
            setError(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    // Filter friends based on search query
    const filteredFriends = friends
        .filter(friend =>
            friend.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            friend.email.toLowerCase().includes(searchQuery.toLowerCase())
        )
        .sort((a, b) => a.full_name.localeCompare(b.full_name));

    const handleAddMember = async (memberEmail: string) => {
        setIsSubmitting(true);
        setError(null);

        try {
            const response = await api.groups.addMember(parseInt(groupId), memberEmail);

            if (response.ok) {
                onMemberAdded();
                onClose();
            } else {
                const err = await response.json();
                setError(err.detail || 'Failed to add member');
            }
        } catch (error) {
            setError('Network error. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!email.trim()) {
            setError('Email address is required');
            return;
        }

        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
            setError('Please enter a valid email address');
            return;
        }

        await handleAddMember(email.trim());
    };

    const handleFriendClick = (friendEmail: string) => {
        handleAddMember(friendEmail);
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end md:items-center justify-center"
            onClick={handleBackdropClick}
        >
            <div className="bg-white dark:bg-gray-800 w-full md:w-[480px] md:rounded-lg shadow-xl transform transition-all max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b dark:border-gray-700">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Add Member</h2>
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
                    {/* Quick-select friends */}
                    {friends.length > 0 && (
                        <div className="mb-6">
                            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                                Quick Add from Friends
                            </h3>

                            {/* Search input */}
                            <div className="mb-3">
                                <input
                                    type="text"
                                    placeholder="Search friends..."
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-teal-500 dark:focus:border-teal-400 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                                />
                            </div>

                            {/* Friend chips */}
                            <div className="flex flex-wrap gap-2 max-h-48 overflow-y-auto">
                                {filteredFriends.length > 0 ? (
                                    filteredFriends.map(friend => (
                                        <button
                                            key={friend.id}
                                            type="button"
                                            onClick={() => handleFriendClick(friend.email)}
                                            disabled={isSubmitting}
                                            className="inline-flex items-center px-3 py-2 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-700 rounded-lg hover:bg-teal-100 dark:hover:bg-teal-900/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
                                        >
                                            <svg className="w-4 h-4 mr-2 text-teal-600 dark:text-teal-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                            </svg>
                                            <span className="text-sm font-medium text-teal-700 dark:text-teal-300">
                                                {friend.full_name}
                                            </span>
                                        </button>
                                    ))
                                ) : (
                                    <p className="text-sm text-gray-500 dark:text-gray-400 italic py-2">
                                        No friends match your search
                                    </p>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Divider */}
                    {friends.length > 0 && (
                        <div className="relative mb-6">
                            <div className="absolute inset-0 flex items-center">
                                <div className="w-full border-t border-gray-300 dark:border-gray-600"></div>
                            </div>
                            <div className="relative flex justify-center text-sm">
                                <span className="px-2 bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                                    Or add by email
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Email form */}
                    <form onSubmit={handleSubmit}>
                        <div className="mb-6">
                            <label className="block text-gray-700 dark:text-gray-300 text-sm font-semibold mb-2">
                                Member's Email Address
                            </label>
                            <input
                                type="email"
                                className="w-full px-4 py-3 text-base border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-teal-500 dark:focus:border-teal-400 dark:bg-gray-700 dark:text-gray-100 transition-colors"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="member@example.com"
                                autoFocus={friends.length === 0}
                                required
                            />
                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                                They must have a Splitwiser account to join the group
                            </p>
                        </div>

                        {error && (
                            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                            </div>
                        )}

                        <div className="flex flex-col-reverse md:flex-row gap-3">
                            <button
                                type="button"
                                onClick={onClose}
                                className="flex-1 px-6 py-3 text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg font-medium transition-colors min-h-[44px]"
                                disabled={isSubmitting}
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                className="flex-1 px-6 py-3 bg-teal-500 text-white rounded-lg hover:bg-teal-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors min-h-[44px]"
                                disabled={isSubmitting}
                            >
                                {isSubmitting ? 'Adding...' : 'Add Member'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    );
};

export default AddMemberModal;
