/**
 * Formatting utilities for money, dates, and user names
 */

/**
 * Format a monetary amount with currency
 */
export const formatMoney = (amount: number, currency: string): string => {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
    }).format(amount / 100);
};

/**
 * Format a date string into a readable format
 */
export const formatDate = (dateStr: string, options?: Intl.DateTimeFormatOptions): string => {
    const defaultOptions: Intl.DateTimeFormatOptions = {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    };

    return new Date(dateStr).toLocaleDateString('en-US', options || defaultOptions);
};

/**
 * Format a date for input fields (YYYY-MM-DD)
 */
export const formatDateForInput = (date: Date = new Date()): string => {
    return date.toISOString().split('T')[0];
};

/**
 * Get display name for a user, showing "You" for current user
 */
export const getUserDisplayName = (
    userId: number,
    userName: string,
    currentUserId: number
): string => {
    return userId === currentUserId ? 'You' : userName;
};
