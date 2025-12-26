import { useState } from 'react';

export const useSplitDetails = () => {
    const [splitDetails, setSplitDetails] = useState<{ [key: string]: number }>({});

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
