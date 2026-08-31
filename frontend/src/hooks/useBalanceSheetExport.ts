import { useCallback, useEffect, useRef, useState } from 'react';

import { balancesApi } from '../services/api';

/**
 * Downloads a group's balance sheet CSV.
 *
 * The endpoint is authenticated, so the file arrives as a blob through the API
 * client rather than as a link the browser can follow on its own. That leaves
 * this hook owning an object URL, which has to be revoked on every path —
 * success, failure, and unmount mid-flight — or the blob leaks for the life of
 * the page.
 */
export const useBalanceSheetExport = (groupId: number | null) => {
    const [isExporting, setIsExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const mounted = useRef(true);

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);

    const exportCsv = useCallback(async () => {
        if (groupId === null || isExporting) return;

        // The sheet is computed server-side from every expense in the group.
        // There is no offline equivalent, and a cached one would be stale in a
        // way that defeats the point of an audit trail.
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            setError('You need to be online to export the balance sheet');
            return;
        }

        setIsExporting(true);
        setError(null);

        let url: string | null = null;
        try {
            const { blob, filename } = await balancesApi.downloadBalanceSheet(groupId);
            url = URL.createObjectURL(blob);

            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = filename;
            anchor.rel = 'noopener';
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Could not export the balance sheet'
            );
        } finally {
            // Revoke on the next macrotask, not inline: some browsers abort a
            // download whose blob URL is released in the same task as the
            // click that started it. Firing after unmount is harmless.
            if (url) {
                const pending = url;
                setTimeout(() => URL.revokeObjectURL(pending), 0);
            }
            if (mounted.current) setIsExporting(false);
        }
    }, [groupId, isExporting]);

    return { exportCsv, isExporting, error };
};
