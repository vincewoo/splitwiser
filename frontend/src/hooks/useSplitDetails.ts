import { useState, useEffect } from 'react';
import type { SplitType } from '../types/expense';

export const useSplitDetails = (splitType: SplitType) => {
    const [splitDetails, setSplitDetails] = useState<{ [key: string]: number }>({});

    // Reset split details when split type changes
    useEffect(() => {
        setSplitDetails({});
    }, [splitType]);

    const handleSplitDetailChange = (key: string, value: string) => {
        setSplitDetails(prev => ({ ...prev, [key]: parseFloat(value) || 0 }));
    };

    const removeSplitDetail = (key: string) => {
        setSplitDetails(prev => {
            const newDetails = { ...prev };
            delete newDetails[key];
            return newDetails;
        });
    };

    return {
        splitDetails,
        setSplitDetails,
        handleSplitDetailChange,
        removeSplitDetail
    };
};
