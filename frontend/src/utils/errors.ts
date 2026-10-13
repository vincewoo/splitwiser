/**
 * Helpers for reading fields off a caught value.
 *
 * A `catch` binding is `unknown` — anything can be thrown. These narrow it
 * without resorting to `any`, and preserve the duck-typed access the call
 * sites relied on: a thrown plain object with a `message` string still reads
 * correctly, not just a real `Error`.
 */

/** The `message` of a caught value, or undefined if it has no string message. */
export function getErrorMessage(error: unknown): string | undefined {
    if (error instanceof Error) return error.message;
    if (typeof error === 'object' && error !== null && 'message' in error) {
        const message = (error as { message?: unknown }).message;
        if (typeof message === 'string') return message;
    }
    return undefined;
}
