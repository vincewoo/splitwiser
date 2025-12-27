import { useState, useEffect, useCallback } from 'react';
import { CURRENCIES } from '../utils/currencyHelpers';
import type { CurrencyInfo } from '../utils/currencyHelpers';

const STORAGE_KEY = 'recentCurrencies';
const MAX_RECENT = 3; // Show top 3 most recently used currencies

interface RecentCurrency {
    code: string;
    lastUsed: string; // ISO timestamp
}

/**
 * Custom hook for managing currency preferences with localStorage
 * Returns currencies sorted by: recent first, then alphabetical
 */
export function useCurrencyPreferences() {
    const [recentCodes, setRecentCodes] = useState<string[]>([]);

    // Load recent currencies from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored) {
                const recent: RecentCurrency[] = JSON.parse(stored);
                // Sort by lastUsed descending and take top MAX_RECENT
                const sorted = recent
                    .sort((a, b) => new Date(b.lastUsed).getTime() - new Date(a.lastUsed).getTime())
                    .slice(0, MAX_RECENT)
                    .map(r => r.code);
                setRecentCodes(sorted);
            }
        } catch (error) {
            console.error('Failed to load recent currencies:', error);
        }
    }, []);

    /**
     * Record currency usage - call this when user submits a form with a currency
     */
    const recordCurrencyUsage = useCallback((currencyCode: string) => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            let recent: RecentCurrency[] = stored ? JSON.parse(stored) : [];

            // Remove existing entry for this currency
            recent = recent.filter(r => r.code !== currencyCode);

            // Add to front with current timestamp
            recent.unshift({
                code: currencyCode,
                lastUsed: new Date().toISOString(),
            });

            // Keep only MAX_RECENT * 2 in storage (for buffer)
            recent = recent.slice(0, MAX_RECENT * 2);

            localStorage.setItem(STORAGE_KEY, JSON.stringify(recent));

            // Update state
            const newRecentCodes = recent.slice(0, MAX_RECENT).map(r => r.code);
            setRecentCodes(newRecentCodes);
        } catch (error) {
            console.error('Failed to record currency usage:', error);
        }
    }, []);

    /**
     * Get sorted currencies: recent first, then alphabetical
     */
    const getSortedCurrencies = useCallback((): CurrencyInfo[] => {
        const recentSet = new Set(recentCodes);
        const recentCurrencies: CurrencyInfo[] = [];
        const otherCurrencies: CurrencyInfo[] = [];

        CURRENCIES.forEach(currency => {
            if (recentSet.has(currency.code)) {
                recentCurrencies.push(currency);
            } else {
                otherCurrencies.push(currency);
            }
        });

        // Sort recent by the order in recentCodes
        recentCurrencies.sort((a, b) => {
            return recentCodes.indexOf(a.code) - recentCodes.indexOf(b.code);
        });

        // Sort others alphabetically by code
        otherCurrencies.sort((a, b) => a.code.localeCompare(b.code));

        return [...recentCurrencies, ...otherCurrencies];
    }, [recentCodes]);

    return {
        sortedCurrencies: getSortedCurrencies(),
        recordCurrencyUsage,
        hasRecentCurrencies: recentCodes.length > 0,
    };
}
