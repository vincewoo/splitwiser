import React from 'react';
import SplitTypePills from './SplitTypePills';
import type { SplitType } from '../../types/expense';

interface ExpenseSplitTypeSelectorProps {
    value: SplitType;
    onChange: (type: SplitType) => void;
    /** Hide "By item" — money received has no receipt to itemize. */
    allowItemized?: boolean;
}

/**
 * Thin adapter kept so existing call sites (add-expense, expense detail) do not
 * each have to know about the pill row.
 */
const ExpenseSplitTypeSelector: React.FC<ExpenseSplitTypeSelectorProps> = ({
    value,
    onChange,
    allowItemized = true,
}) => (
    <SplitTypePills
        value={value}
        onChange={onChange}
        allowItemized={allowItemized}
        className="mb-2"
    />
);

export default ExpenseSplitTypeSelector;
