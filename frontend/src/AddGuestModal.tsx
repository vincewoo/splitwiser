import React, { useState, useEffect } from 'react';

interface AddGuestModalProps {
    isOpen: boolean;
    onClose: () => void;
    onGuestAdded: () => void;
    groupId: string;
}

const AddGuestModal: React.FC<AddGuestModalProps> = ({ isOpen, onClose, onGuestAdded, groupId }) => {
    const [name, setName] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (isOpen) {
            setName('');
            setError(null);
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!name.trim()) {
            setError('Guest name is required');
            return;
        }

        setIsSubmitting(true);
        setError(null);

        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`http://localhost:8000/groups/${groupId}/guests`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: name.trim() })
            });

            if (response.ok) {
                onGuestAdded();
                onClose();
            } else {
                const err = await response.json();
                setError(err.detail || 'Failed to add guest');
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
                    <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Add Guest</h2>
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
                            Guest Name
                        </label>
                        <input
                            type="text"
                            className="w-full px-4 py-3 text-base border-2 border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-orange-500 dark:focus:border-orange-400 dark:bg-gray-700 dark:text-gray-100 transition-colors"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Enter guest name"
                            autoFocus
                            required
                        />
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                            Guests don't need an account. Use this for people who aren't registered on Splitwiser.
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
                            className="flex-1 px-6 py-3 bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed font-medium transition-colors min-h-[44px]"
                            disabled={isSubmitting}
                        >
                            {isSubmitting ? 'Adding...' : 'Add Guest'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddGuestModal;
