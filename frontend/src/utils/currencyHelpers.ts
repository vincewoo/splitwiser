export interface CurrencyInfo {
    code: string;
    flag: string;
    name: string;
}

export const CURRENCIES: CurrencyInfo[] = [
    { code: 'USD', flag: '🇺🇸', name: 'US Dollar' },
    { code: 'EUR', flag: '🇪🇺', name: 'Euro' },
    { code: 'GBP', flag: '🇬🇧', name: 'British Pound' },
    { code: 'JPY', flag: '🇯🇵', name: 'Japanese Yen' },
    { code: 'CAD', flag: '🇨🇦', name: 'Canadian Dollar' },
    { code: 'CNY', flag: '🇨🇳', name: 'Chinese Yuan' },
    { code: 'HKD', flag: '🇭🇰', name: 'Hong Kong Dollar' },
];

/**
 * Get currency info by code
 */
export function getCurrencyInfo(code: string): CurrencyInfo | undefined {
    return CURRENCIES.find(c => c.code === code);
}

/**
 * Format currency for display: "🇺🇸 USD - US Dollar"
 */
export function formatCurrencyDisplay(code: string): string {
    const info = getCurrencyInfo(code);
    if (!info) return code;
    return `${info.flag} ${info.code} - ${info.name}`;
}

/**
 * Get all currency codes
 */
export function getAllCurrencyCodes(): string[] {
    return CURRENCIES.map(c => c.code);
}
