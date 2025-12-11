import React, { useState, useEffect } from 'react';

interface Group {
    id: number;
    name: string;
    created_by_id: number;
    default_currency: string;
}

interface EditGroupModalProps {
    isOpen: boolean;
    onClose: () => void;
    group: Group;
    onGroupUpdated: (group: { id: number; name: string; created_by_id: number; default_currency: string }) => void;
}

const EditGroupModal: React.FC<EditGroupModalProps> = ({ isOpen, onClose, group, onGroupUpdated }) => {
    const [name, setName] = useState(group.name);
    const [currency, setCurrency] = useState(group.default_currency || 'USD');
    const [currencies] = useState<string[]>(['USD', 'EUR', 'GBP', 'JPY', 'CAD']);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        setName(group.name);
        setCurrency(group.default_currency || 'USD');
        setError(null);
    }, [group, isOpen]);

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        setError(null);

        const token = localStorage.getItem('token');
        const response = await fetch(`http://localhost:8000/groups/${group.id}`, {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ name, default_currency: currency })
        });

        setIsSubmitting(false);

        if (response.ok) {
            const updatedGroup = await response.json();
            onGroupUpdated({ ...group, ...updatedGroup });
        } else {
            const err = await response.json();
            setError(err.detail || 'Failed to update group');
        }
    };

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full flex items-center justify-center z-50">
            <div className="bg-white p-5 rounded-lg shadow-xl w-96">
                <h2 className="text-xl font-bold mb-4">Edit Group</h2>
                <form onSubmit={handleSubmit}>
                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2">
                            Group Name
                        </label>
                        <input
                            type="text"
                            className="w-full border-b border-gray-300 py-2 focus:outline-none focus:border-teal-500"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            required
                        />
                    </div>

                    <div className="mb-4">
                        <label className="block text-gray-700 text-sm font-bold mb-2">
                            Default Currency
                        </label>
                        <select
                            value={currency}
                            onChange={(e) => setCurrency(e.target.value)}
                            className="w-full border-b border-gray-300 py-2 focus:outline-none focus:border-teal-500 bg-white"
                        >
                            {currencies.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                            New expenses will default to this currency
                        </p>
                    </div>

                    {error && (
                        <p className="mb-4 text-sm text-red-500">{error}</p>
                    )}

                    <div className="flex justify-end space-x-3">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-500 hover:bg-gray-100 rounded"
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
