import React, { useState, useEffect } from 'react';

interface AddItemModalProps {
    isOpen: boolean;
    onClose: () => void;
    onAdd: (description: string, price: number) => void;
}

const AddItemModal: React.FC<AddItemModalProps> = ({ isOpen, onClose, onAdd }) => {
    const [description, setDescription] = useState('');
    const [priceStr, setPriceStr] = useState('');
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            setDescription('');
            setPriceStr('');
            setError('');
        }
    }, [isOpen]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!description.trim()) {
            setError('Please enter an item description');
            return;
        }

        const price = Math.round(parseFloat(priceStr) * 100);
        if (isNaN(price) || price <= 0) {
            setError('Please enter a valid price greater than 0');
            return;
        }

        onAdd(description.trim(), price);
        onClose();
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/50" onClick={onClose} />

            {/* Modal */}
            <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-auto">
                <form onSubmit={handleSubmit}>
                    {/* Header */}
                    <div className="flex justify-between items-center p-6 border-b border-gray-200 dark:border-gray-700">
                        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                            Add Item
                        </h2>
                        <button
                            type="button"
                            onClick={onClose}
                            aria-label="Close modal"
                            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 min-w-[44px] min-h-[44px] flex items-center justify-center"
                        >
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    {/* Body */}
                    <div className="p-6 space-y-4">
                        {/* Description Input */}
                        <div>
                            <label htmlFor="item-description" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Item Description
                            </label>
                            <input
                                id="item-description"
                                type="text"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder="e.g., Burger"
                                className="w-full px-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 min-h-[44px]"
                                autoFocus
                            />
                        </div>

                        {/* Price Input */}
                        <div>
                            <label htmlFor="item-price" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                                Price
                            </label>
                            <div className="relative">
                                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 dark:text-gray-400">
                                    $
                                </span>
                                <input
                                    id="item-price"
                                    type="number"
                                    step="0.01"
                                    min="0.01"
                                    value={priceStr}
                                    onChange={(e) => setPriceStr(e.target.value)}
                                    placeholder="12.99"
                                    className="w-full pl-8 pr-4 py-3 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-transparent bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 min-h-[44px]"
                                />
                            </div>
                        </div>

                        {/* Error Message */}
                        {error && (
                            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                                <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
                            </div>
                        )}
                    </div>

                    {/* Footer */}
                    <div className="flex gap-3 p-6 border-t border-gray-200 dark:border-gray-700">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-600 min-h-[44px]"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-1 px-4 py-3 text-sm font-medium text-white bg-teal-600 hover:bg-teal-700 rounded-lg min-h-[44px]"
                        >
                            Add Item
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddItemModal;
