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

    // Parse date string to avoid timezone issues
    // If it's a plain YYYY-MM-DD, parse as local date not UTC
    let date: Date;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
        const [year, month, day] = dateStr.split('-').map(Number);
        date = new Date(year, month - 1, day);
    } else {
        // For ISO strings with time, still use local display
        date = new Date(dateStr);
    }

    return date.toLocaleDateString('en-US', options || defaultOptions);
};

/**
 * Format a date for input fields (YYYY-MM-DD)
 */
export const formatDateForInput = (date: Date = new Date()): string => {
    // Use local date components to avoid timezone issues
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
