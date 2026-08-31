import { afterEach, describe, expect, it, vi } from 'vitest';

import { balancesApi, filenameFromDisposition } from '../api';

const stubAuth = () => {
    vi.stubGlobal('localStorage', {
        getItem: vi.fn((key: string) => (key === 'token' ? 'test-token' : null)),
        setItem: vi.fn(),
        removeItem: vi.fn(),
    });
};

const csvResponse = (disposition: string | null) => ({
    ok: true,
    status: 200,
    headers: { get: (name: string) => (name === 'Content-Disposition' ? disposition : null) },
    blob: async () => new Blob(['section,key,value\n'], { type: 'text/csv' }),
});

describe('filenameFromDisposition', () => {
    it('reads a quoted filename', () => {
        expect(
            filenameFromDisposition('attachment; filename="balance-sheet-tahoe-2026-08-30.csv"')
        ).toBe('balance-sheet-tahoe-2026-08-30.csv');
    });

    it('reads an unquoted filename', () => {
        expect(filenameFromDisposition('attachment; filename=sheet.csv')).toBe('sheet.csv');
    });

    it('decodes a UTF-8 filename', () => {
        expect(
            filenameFromDisposition("attachment; filename*=UTF-8''caf%C3%A9.csv")
        ).toBe('café.csv');
    });

    it('returns null when the header is missing — some proxies drop it', () => {
        expect(filenameFromDisposition(null)).toBeNull();
        expect(filenameFromDisposition('attachment')).toBeNull();
    });
});

describe('balancesApi.downloadBalanceSheet', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('requests the CSV with the auth header rather than as a plain link', async () => {
        stubAuth();
        const fetchMock = vi.fn(async () => csvResponse('attachment; filename="sheet.csv"'));
        vi.stubGlobal('fetch', fetchMock);

        const { blob, filename } = await balancesApi.downloadBalanceSheet(7);

        expect(filename).toBe('sheet.csv');
        expect(blob.type).toBe('text/csv');

        const [url, options] = fetchMock.mock.calls[0] as unknown as [
            string,
            RequestInit,
        ];
        expect(url).toContain('/groups/7/balance_sheet.csv');
        // A token in a query string would land in history and server logs.
        expect(url).not.toContain('token');
        expect((options.headers as Record<string, string>).Authorization).toBe(
            'Bearer test-token'
        );
    });

    it('falls back to a client-built name when the header is absent', async () => {
        stubAuth();
        vi.stubGlobal('fetch', vi.fn(async () => csvResponse(null)));

        const { filename } = await balancesApi.downloadBalanceSheet(42);
        expect(filename).toBe('balance-sheet-42.csv');
    });

    it('throws when the export fails', async () => {
        stubAuth();
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: false, status: 403, headers: { get: () => null } }))
        );

        await expect(balancesApi.downloadBalanceSheet(7)).rejects.toThrow(
            'Failed to export balance sheet'
        );
    });
});
