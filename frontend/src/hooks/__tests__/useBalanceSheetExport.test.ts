import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useBalanceSheetExport } from '../useBalanceSheetExport';

const download = vi.hoisted(() => vi.fn());

vi.mock('../../services/api', () => ({
    balancesApi: { downloadBalanceSheet: download },
}));

describe('useBalanceSheetExport', () => {
    let createObjectURL: ReturnType<typeof vi.fn>;
    let revokeObjectURL: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        createObjectURL = vi.fn(() => 'blob:mock');
        revokeObjectURL = vi.fn();
        vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
        download.mockReset();
        download.mockResolvedValue({
            blob: new Blob(['csv']),
            filename: 'balance-sheet-tahoe.csv',
        });
    });

    afterEach(() => {
        vi.runOnlyPendingTimers();
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('downloads the file under the name the server chose', async () => {
        const clicked: HTMLAnchorElement[] = [];
        const clickSpy = vi
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(function (this: HTMLAnchorElement) {
                clicked.push(this);
            });

        const { result } = renderHook(() => useBalanceSheetExport(7));
        await act(async () => {
            await result.current.exportCsv();
        });

        expect(download).toHaveBeenCalledWith(7);
        expect(clicked[0].download).toBe('balance-sheet-tahoe.csv');
        expect(clicked[0].href).toContain('blob:mock');
        expect(result.current.error).toBeNull();
        expect(result.current.isExporting).toBe(false);

        clickSpy.mockRestore();
    });

    it('revokes the object URL, but not in the same task as the click', async () => {
        vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

        const { result } = renderHook(() => useBalanceSheetExport(7));
        await act(async () => {
            await result.current.exportCsv();
        });

        // Releasing the blob synchronously cancels the download in some browsers.
        expect(revokeObjectURL).not.toHaveBeenCalled();
        act(() => {
            vi.runAllTimers();
        });
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');
    });

    it('surfaces a failure and stops spinning', async () => {
        download.mockRejectedValue(new Error('Failed to export balance sheet'));

        const { result } = renderHook(() => useBalanceSheetExport(7));
        await act(async () => {
            await result.current.exportCsv();
        });

        expect(result.current.error).toBe('Failed to export balance sheet');
        expect(result.current.isExporting).toBe(false);
        // Nothing was created, so there is nothing to leak.
        expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('refuses while offline instead of handing over a stale sheet', async () => {
        vi.stubGlobal('navigator', { onLine: false });

        const { result } = renderHook(() => useBalanceSheetExport(7));
        await act(async () => {
            await result.current.exportCsv();
        });

        expect(download).not.toHaveBeenCalled();
        expect(result.current.error).toBe(
            'You need to be online to export the balance sheet'
        );
    });

    it('does nothing without a group', async () => {
        const { result } = renderHook(() => useBalanceSheetExport(null));
        await act(async () => {
            await result.current.exportCsv();
        });
        expect(download).not.toHaveBeenCalled();
    });
});
