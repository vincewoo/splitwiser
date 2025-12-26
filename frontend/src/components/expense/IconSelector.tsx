import React, { useState } from 'react';

interface IconSelectorProps {
    selectedIcon: string | null;
    onIconSelect: (icon: string | null) => void;
}

interface IconCategory {
    name: string;
    icons: string[];
}

// Icons organized by category
const ICON_CATEGORIES: IconCategory[] = [
    {
        name: 'Food & Drink',
        icons: ['🍔', '🍕', '🍜', '🍱', '🍣', '🥗', '🥪', '🌮', '🌯', '🍝', '🍛', '🍲', '☕', '🍺', '🍷', '🥤']
    },
    {
        name: 'Transportation',
        icons: ['✈️', '🚗', '🚕', '🚙', '🚌', '🚇', '🚊', '🚲', '🛴', '🏍️', '⛽', '🚢', '🛩️','🚠']
    },
    {
        name: 'Accommodation',
        icons: ['🏨', '🏠', '🏡', '🏢', '🏰', '⛺', '🏕️']
    },
    {
        name: 'Entertainment',
        icons: ['🎬', '🎮', '🎭', '🎪', '🎨', '🎵', '🎸', '🎹', '🎤', '🎧', '🎫', '🎟️', '🎉', '🎊', '🎈']
    },
    {
        name: 'Shopping',
        icons: ['🛒', '🛍️', '👕', '👔', '👗', '👠', '👟', '💄', '💍', '👜', '🎁', '📦']
    },
    {
        name: 'Health & Fitness',
        icons: ['🏥', '💊', '💉', '🏋️', '⚽', '🏀', '🎾', '🏊', '🧘', '🚴']
    },
    {
        name: 'Work & Education',
        icons: ['💼', '📊', '📈', '📝', '✏️', '📚', '🎓', '🖊️', '💻', '⌨️', '🖱️']
    },
    {
        name: 'Technology',
        icons: ['📱', '💻', '⌨️', '🖥️', '⌚', '📷', '📹', '🎮', '🖨️', '💾', '📡']
    },
    {
        name: 'Other',
        icons: ['🌍', '🗺️', '🎪', '🎡', '🎢', '🎠', '💐', '🌸', '🌺', '🔧', '🔨', '🏗️']
    }
];

const IconSelector: React.FC<IconSelectorProps> = ({ selectedIcon, onIconSelect }) => {
    const [isModalOpen, setIsModalOpen] = useState(false);

    const handleIconClick = (icon: string | null) => {
        onIconSelect(icon);
        setIsModalOpen(false);
    };

    return (
        <>
            {/* Icon Trigger Button */}
            <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className="w-12 h-12 rounded-lg border-2 border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500 flex items-center justify-center text-2xl transition-colors min-h-[44px] flex-shrink-0"
                title="Select icon"
            >
                {selectedIcon || <span className="text-gray-400 dark:text-gray-500 text-xl">+</span>}
            </button>

            {/* Modal */}
            {isModalOpen && (
                <div
                    className="fixed inset-0 bg-gray-600 dark:bg-gray-900/75 bg-opacity-50 flex items-center justify-center z-50 p-4"
                    onClick={() => setIsModalOpen(false)}
                >
                    <div
                        className="bg-white dark:bg-gray-800 rounded-lg shadow-xl dark:shadow-gray-900/50 max-w-lg w-full max-h-[80vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4 flex justify-between items-center">
                            <h3 className="text-lg font-semibold dark:text-gray-100">Select an Icon</h3>
                            <button
                                type="button"
                                onClick={() => setIsModalOpen(false)}
                                className="text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 text-2xl leading-none"
                            >
                                ×
                            </button>
                        </div>

                        <div className="p-4">
                            {/* No Icon Option */}
                            <div className="mb-4">
                                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">None</h4>
                                <button
                                    type="button"
                                    onClick={() => handleIconClick(null)}
                                    className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center min-h-[44px] ${
                                        selectedIcon === null
                                            ? 'border-teal-500 dark:border-teal-600 bg-teal-50 dark:bg-teal-900/30'
                                            : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
                                    }`}
                                    title="No icon"
                                >
                                    <span className="text-gray-400 dark:text-gray-500 text-xl">—</span>
                                </button>
                            </div>

                            {/* Icon Categories */}
                            {ICON_CATEGORIES.map((category) => (
                                <div key={category.name} className="mb-4">
                                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        {category.name}
                                    </h4>
                                    <div className="flex flex-wrap gap-2">
                                        {category.icons.map((icon) => (
                                            <button
                                                key={icon}
                                                type="button"
                                                onClick={() => handleIconClick(icon)}
                                                className={`w-12 h-12 rounded-lg border-2 flex items-center justify-center text-2xl min-h-[44px] transition-colors ${
                                                    selectedIcon === icon
                                                        ? 'border-teal-500 dark:border-teal-600 bg-teal-50 dark:bg-teal-900/30'
                                                        : 'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 hover:border-gray-400 dark:hover:border-gray-500'
                                                }`}
                                                title={icon}
                                            >
                                                {icon}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default IconSelector;
