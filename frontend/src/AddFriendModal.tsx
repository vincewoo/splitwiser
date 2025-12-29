import React, { useState, useEffect } from 'react';
import { api } from './services/api';

interface AddFriendModalProps {
    isOpen: boolean;
    onClose: () => void;
    onFriendAdded: () => void;
}

const AddFriendModal: React.FC<AddFriendModalProps> = ({ isOpen, onClose, onFriendAdded }) => {
    const [email, setEmail] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setEmail('');
            setError(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

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

        setIsSubmitting(true);
        setError(null);

        try {
            const response = await api.friends.add(email.trim());

            if (response.ok) {
                onFriendAdded();
                onClose();
            } else {
                const err = await response.json();
                // Handle error properly - check if it's a validation error array or simple detail
                if (err.detail && Array.isArray(err.detail)) {
                    setError(err.detail[0]?.msg || 'Failed to add friend');
                } else if (typeof err.detail === 'string') {
                    setError(err.detail);
                } else {
                    setError('Failed to add friend');
                }
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

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-end md:items-center justify-center"
            onClick={handleBackdropClick}
        >
            <div className="bg-white dark:bg-gray-800 w-full md:w-[400px] md:rounded-lg shadow-xl transform transition-all max-h-[90vh] overflow-y-auto rounded-t-2xl md:rounded-2xl">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b dark:border-gray-700">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Add Friend</h2>
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

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-5">
                    <div className="mb-6">
                        <label className="block text-gray-700 dark:text-gray-300 text-sm font-semibold mb-2">
                            Friend's Email Address
                        </label>
                        <input
                            type="email"
                            className="w-full px-4 py-3 text-base border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-teal-500 dark:focus:border-teal-400 dark:bg-gray-700 dark:text-gray-100 transition-colors"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="friend@example.com"
                            autoFocus
                            required
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                            They must have a Splitwiser account
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
                            {isSubmitting ? 'Adding...' : 'Add Friend'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddFriendModal;
