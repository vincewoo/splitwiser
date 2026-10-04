import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import SummarySection from '../SummarySection';
import type { GroupSummaryMember, GroupSummaryResponse } from '../../../types/summary';

const getSummary = vi.fn();
const getPublicSummary = vi.fn();
vi.mock('../../../services/api', () => ({
    groupsApi: {
        getSummary: (...args: unknown[]) => getSummary(...args),
        getPublicSummary: (...args: unknown[]) => getPublicSummary(...args),
    },
}));

// Not the viewer (currentUserId 1) — the table renders the viewer's own row
// as "You", so assertions key on other people's names.
const sam: GroupSummaryMember = {
    user_id: 2,
    is_guest: false,
    display_name: 'Sam Okafor',
    total: 5000,
    managed_members: [],
};
const dev: GroupSummaryMember = {
    user_id: 3,
    is_guest: false,
    display_name: 'Dev Rao',
    total: 3000,
    managed_members: [],
};

// Empty series keeps the visx chart out of the render; the member table is
// enough to see what's on screen.
const summaryOf = (members: GroupSummaryMember[]): GroupSummaryResponse => ({
    group_total: members.reduce((sum, m) => sum + m.total, 0),
    currency: 'USD',
    granularity: 'month',
    has_synthesized_historical_rate: false,
    members,
    series: [],
});

beforeEach(() => {
    getSummary.mockReset().mockResolvedValue(summaryOf([sam]));
    getPublicSummary.mockReset().mockResolvedValue({
        group_total: 8000,
        currency: 'USD',
        granularity: 'month',
        has_synthesized_historical_rate: false,
        series: [],
    });
});

describe('SummarySection refresh generation', () => {
    it('re-fetches in place on a generation bump — no skeleton swap', async () => {
        // A mutation recorded anywhere in the shell bumps the generation; an
        // open Spending view must follow. If someone drops refreshGeneration
        // from the effect, the view goes stale and nothing fails; if the
        // refetch cleared `response`, every refresh would flash the skeleton.
        const { container, rerender } = render(
            <SummarySection groupId={7} currentUserId={1} refreshGeneration={0} />
        );
        await screen.findByText('Sam Okafor');
        expect(getSummary).toHaveBeenCalledTimes(1);

        let finish!: (value: unknown) => void;
        getSummary.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        rerender(<SummarySection groupId={7} currentUserId={1} refreshGeneration={1} />);

        await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
        // Mid-flight: the loaded figures stay up, no skeleton (it only renders
        // while there is no data at all).
        expect(screen.getByText('Sam Okafor')).toBeInTheDocument();
        expect(container.querySelector('[aria-busy="true"]')).toBeNull();

        await act(async () => finish(summaryOf([sam, dev])));
        await screen.findByText('Dev Rao');
        // One bump, one fetch.
        expect(getSummary).toHaveBeenCalledTimes(2);
    });

    it('keeps the loaded figures when a background refetch fails', async () => {
        // A failed refresh on a flaky connection must not wipe a loaded view
        // down to the error block — stale figures beat an error screen, and
        // the next refresh heals them.
        const { rerender } = render(
            <SummarySection groupId={7} currentUserId={1} refreshGeneration={0} />
        );
        await screen.findByText('Sam Okafor');

        getSummary.mockRejectedValueOnce(new Error('offline'));
        rerender(<SummarySection groupId={7} currentUserId={1} refreshGeneration={1} />);

        await waitFor(() => expect(getSummary).toHaveBeenCalledTimes(2));
        // Let the rejection land before asserting what stayed on screen.
        await act(async () => {});
        expect(screen.getByText('Sam Okafor')).toBeInTheDocument();
        expect(screen.queryByRole('alert')).toBeNull();
    });

    it('fetches exactly once in public mode, where no generation is wired', async () => {
        // Public share-link pages live outside the app shell: refreshGeneration
        // is undefined there, and the generation effect must stay idle rather
        // than refetching on every rerender.
        const { rerender } = render(
            <SummarySection shareLinkId="abc123" currentUserId={null} />
        );
        await screen.findByText('No spending yet.');

        rerender(<SummarySection shareLinkId="abc123" currentUserId={null} />);
        rerender(<SummarySection shareLinkId="abc123" currentUserId={null} />);
        await act(async () => {});

        expect(getPublicSummary).toHaveBeenCalledTimes(1);
        expect(getSummary).not.toHaveBeenCalled();
    });
});
