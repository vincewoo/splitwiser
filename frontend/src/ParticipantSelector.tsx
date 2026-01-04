import React, { useState, useEffect } from 'react';

interface Participant {
    id: number;
    name: string;
    isGuest: boolean;
}

interface ParticipantSelectorProps {
    isOpen: boolean;
    onClose: () => void;
    participants: Participant[];
    selectedParticipants: Participant[];
    onConfirm: (selected: Participant[]) => void;
    itemDescription: string;
}

const ParticipantSelector: React.FC<ParticipantSelectorProps> = ({
    isOpen,
    onClose,
    participants,
    selectedParticipants,
    onConfirm,
    itemDescription
}) => {
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [searchTerm, setSearchTerm] = useState('');

    useEffect(() => {
        // Initialize with currently selected participants
        const keys = selectedParticipants.map(p =>
            p.isGuest ? `guest_${p.id}` : `user_${p.id}`
        );
        setSelected(new Set(keys));
    }, [selectedParticipants, isOpen]);

    const getKey = (p: Participant) => p.isGuest ? `guest_${p.id}` : `user_${p.id}`;

    const toggleParticipant = (p: Participant) => {
        const key = getKey(p);
        const newSelected = new Set(selected);
        if (newSelected.has(key)) {
            newSelected.delete(key);
        } else {
            newSelected.add(key);
        }
        setSelected(newSelected);
    };

    const selectAll = () => {
        const allKeys = participants.map(p => getKey(p));
        setSelected(new Set(allKeys));
    };

    const selectNone = () => {
        setSelected(new Set());
    };

    const handleConfirm = () => {
        const selectedList = participants.filter(p => selected.has(getKey(p)));
        onConfirm(selectedList);
        onClose();
    };

    const filteredParticipants = participants
        .filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
        .sort((a, b) => {
            // "You" always first
            if (a.name === 'You') return -1;
            if (b.name === 'You') return 1;
            // Then alphabetically
            return a.name.localeCompare(b.name);
        });

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 dark:bg-gray-900/75 bg-opacity-50 z-50 flex items-center justify-center p-4">
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl dark:shadow-gray-900/50 w-full max-w-lg max-h-[80vh] flex flex-col">
                {/* Header */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                        Select People
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{itemDescription}</p>
                </div>

                {/* Search and Quick Actions */}
                <div className="p-4 border-b border-gray-200 dark:border-gray-700 space-y-3">
                    <input
                        type="text"
                        placeholder="Search people..."
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:border-teal-500 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={selectAll}
                            className="flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-600 min-h-[44px]"
                        >
                            Select All ({participants.length})
                        </button>
                        <button
                            type="button"
                            onClick={selectNone}
                            className="flex-1 px-3 py-2 text-sm bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-200 dark:hover:bg-gray-600 min-h-[44px]"
                        >
                            Clear All
                        </button>
                    </div>
                </div>

                {/* Participant List */}
                <div className="flex-1 overflow-y-auto p-4">
                    <div className="grid grid-cols-2 gap-2">
                        {filteredParticipants.map(p => {
                            const key = getKey(p);
                            const isSelected = selected.has(key);

                            return (
                                <button
                                    key={key}
                                    type="button"
                                    onClick={() => toggleParticipant(p)}
                                    aria-pressed={isSelected}
                                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors min-h-[44px] ${isSelected
                                            ? p.isGuest
                                                ? 'bg-orange-50 dark:bg-orange-900/30 border-orange-500 dark:border-orange-600 text-orange-900 dark:text-orange-200'
                                                : 'bg-teal-50 dark:bg-teal-900/30 border-teal-500 dark:border-teal-600 text-teal-900 dark:text-teal-200'
                                            : 'bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-600'
                                        }`}
                                >
                                    <div className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${isSelected
                                            ? p.isGuest
                                                ? 'border-orange-500 bg-orange-500'
                                                : 'border-teal-500 bg-teal-500'
                                            : 'border-gray-300'
                                        }`}>
                                        {isSelected && (
                                            <svg className="w-3 h-3 text-white" fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" viewBox="0 0 24 24" stroke="currentColor">
                                                <path d="M5 13l4 4L19 7"></path>
                                            </svg>
                                        )}
                                    </div>
                                    <span className="text-sm font-medium truncate">
                                        {p.name}
                                    </span>
                                </button>
                            );
                        })}
                    </div>

                    {filteredParticipants.length === 0 && (
                        <p className="text-center text-gray-500 dark:text-gray-400 text-sm py-8">
                            No people found
                        </p>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">
                        {selected.size} of {participants.length} selected
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded hover:bg-gray-200 dark:hover:bg-gray-600 min-h-[44px]"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={handleConfirm}
                            className="px-4 py-2 bg-teal-500 text-white rounded hover:bg-teal-600 min-h-[44px]"
                        >
                            Done
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ParticipantSelector;
