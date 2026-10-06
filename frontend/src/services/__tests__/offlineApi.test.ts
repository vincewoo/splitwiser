import { describe, it, expect, vi, beforeEach } from 'vitest';
import { offlineExpensesApi } from '../offlineApi';
import { expensesApi } from '../api';
import { syncManager } from '../syncManager';
import { db } from '../../db';
import type { ExpensePayload } from '../../types/expense';

vi.mock('../api', () => ({
    expensesApi: {
        create: vi.fn(),
        update: vi.fn(),
    },
    groupsApi: {
        getAll: vi.fn(),
        getById: vi.fn(),
    },
}));

vi.mock('../syncManager', () => ({
    syncManager: {
        queueOperation: vi.fn().mockResolvedValue(undefined),
    },
}));

vi.mock('../../db', () => ({
    db: {
        expenses: {
            add: vi.fn().mockResolvedValue(undefined),
            update: vi.fn().mockResolvedValue(undefined),
            get: vi.fn(),
        },
    },
}));

const payload = { description: 'Dinner', amount: 1000 } as unknown as ExpensePayload;

const jsonResponse = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

describe('offlineExpensesApi — server rejection vs network failure', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('a 400 surfaces the backend detail and never queues — a rejected payload can never sync', async () => {
        vi.mocked(expensesApi.update).mockResolvedValue(
            jsonResponse(400, { detail: "Item 2: Percentages (80%) don't total 100%" })
        );
        vi.mocked(db.expenses.get).mockResolvedValue({ id: 7 } as never);

        const result = await offlineExpensesApi.update(7, payload);

        expect(result.success).toBe(false);
        expect(result.error).toBe("Item 2: Percentages (80%) don't total 100%");
        expect(syncManager.queueOperation).not.toHaveBeenCalled();
        expect(db.expenses.update).not.toHaveBeenCalled();
    });

    it('a 400 on create surfaces the detail and never queues', async () => {
        vi.mocked(expensesApi.create).mockResolvedValue(
            jsonResponse(400, { detail: 'Split details required for SHARES split' })
        );

        const result = await offlineExpensesApi.create(payload);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Split details required for SHARES split');
        expect(syncManager.queueOperation).not.toHaveBeenCalled();
        expect(db.expenses.add).not.toHaveBeenCalled();
    });

    it('a 422 flattens pydantic detail objects into one message', async () => {
        vi.mocked(expensesApi.create).mockResolvedValue(
            jsonResponse(422, { detail: [{ loc: ['body', 'kind'], msg: 'Invalid kind', type: 'value_error' }] })
        );

        const result = await offlineExpensesApi.create(payload);

        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid kind');
    });

    it('a network failure still falls back to the offline queue', async () => {
        vi.mocked(expensesApi.update).mockRejectedValue(new TypeError('Failed to fetch'));
        vi.mocked(db.expenses.get).mockResolvedValue({ id: 7, local_version: 1 } as never);

        const result = await offlineExpensesApi.update(7, payload);

        expect(result.success).toBe(true);
        expect(result.offline).toBe(true);
        expect(syncManager.queueOperation).toHaveBeenCalledWith(
            expect.objectContaining({ type: 'UPDATE_EXPENSE', entity_id: 7 })
        );
    });

    it('a 500 falls back to the offline queue — the server might recover', async () => {
        vi.mocked(expensesApi.update).mockResolvedValue(jsonResponse(500, { detail: 'boom' }));
        vi.mocked(db.expenses.get).mockResolvedValue({ id: 7, local_version: 1 } as never);

        const result = await offlineExpensesApi.update(7, payload);

        expect(result.success).toBe(true);
        expect(result.offline).toBe(true);
        expect(syncManager.queueOperation).toHaveBeenCalled();
    });
});
