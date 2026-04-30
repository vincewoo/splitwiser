export function safeReturnTo(value: string | null | undefined, fallback = '/'): string {
    if (typeof value !== 'string' || value === '') {
        return fallback;
    }
    if (!value.startsWith('/')) {
        return fallback;
    }
    if (value.startsWith('//')) {
        return fallback;
    }
    if (value.startsWith('/\\')) {
        return fallback;
    }
    if (value.includes('://')) {
        return fallback;
    }
    return value;
}
