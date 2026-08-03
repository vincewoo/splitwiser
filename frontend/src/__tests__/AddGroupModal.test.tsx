import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AddGroupModal from '../AddGroupModal';

vi.mock('../contexts/SyncContext', () => ({
    useSync: () => ({ isOnline: true }),
}));

const createGroup = vi.fn();
vi.mock('../services/offlineApi', () => ({
    offlineGroupsApi: {
        create: (...args: unknown[]) => createGroup(...args),
    },
}));

describe('AddGroupModal', () => {
    beforeEach(() => {
        createGroup.mockReset();
        createGroup.mockResolvedValue({ success: true, data: { id: 1 }, offline: false });
    });

    it('creates the group with the icon that was chosen', async () => {
        render(<AddGroupModal isOpen={true} onClose={() => {}} onGroupAdded={() => {}} />);

        fireEvent.change(screen.getByLabelText('Group name'), {
            target: { value: 'Ski trip' },
        });
        fireEvent.click(screen.getByLabelText('Select icon'));
        fireEvent.click(await screen.findByLabelText('Select 🏔️'));
        fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

        await waitFor(() =>
            expect(createGroup).toHaveBeenCalledWith('Ski trip', 'USD', '🏔️')
        );
    });

    it('creates the group with no icon when none was chosen', async () => {
        render(<AddGroupModal isOpen={true} onClose={() => {}} onGroupAdded={() => {}} />);

        fireEvent.change(screen.getByLabelText('Group name'), {
            target: { value: 'Roommates' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Create group' }));

        await waitFor(() =>
            expect(createGroup).toHaveBeenCalledWith('Roommates', 'USD', null)
        );
    });
});
