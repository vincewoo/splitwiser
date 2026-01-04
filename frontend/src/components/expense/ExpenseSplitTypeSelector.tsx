import React from 'react';
import type { SplitType } from '../../types/expense';

interface ExpenseSplitTypeSelectorProps {
    value: SplitType;
    onChange: (type: SplitType) => void;
}

const SPLIT_TYPES: SplitType[] = ['EQUAL', 'EXACT', 'PERCENT', 'SHARES', 'ITEMIZED'];

const ExpenseSplitTypeSelector: React.FC<ExpenseSplitTypeSelectorProps> = ({ value, onChange }) => {
    return (
        <div className="flex flex-wrap gap-2 mb-2">
            {SPLIT_TYPES.map(type => (
                <button
                    key={type}
                    type="button"
                    onClick={() => onChange(type)}
                    aria-pressed={value === type}
                    className={`px-4 py-2 text-sm rounded border min-h-[44px] transition-colors duration-200 ${value === type
                        ? 'bg-teal-500 text-white'
                        : 'bg-white dark:bg-gray-700 text-gray-600 dark:text-gray-200 dark:border-gray-600'
                        }`}
                >
                    {type}
                </button>
            ))}
        </div>
    );
};

export default ExpenseSplitTypeSelector;
