/**
 * Offline-aware API wrapper
 * Handles online/offline detection and queues operations for sync
 */

import { db } from '../db';
import { syncManager } from './syncManager';
import { expensesApi, groupsApi } from './api';

// ============================================================================
// Offline-Aware Expenses API
// ============================================================================

export const offlineExpensesApi = {
  /**
   * Create an expense - works offline
   */
  create: async (expenseData: any) => {
    if (navigator.onLine) {
      // Online: Normal API call
      try {
        const response = await expensesApi.create(expenseData);
        if (response.ok) {
          const expense = await response.json();

          // Cache in IndexedDB
          await db.expenses.add({
            ...expense,
            cached_at: Date.now(),
            is_temp: false,
            local_version: 1
          });

          return { success: true, data: expense, offline: false };
        }
        throw new Error(`Failed to create expense: ${response.status}`);
      } catch (error) {
        console.error('Online expense creation failed:', error);
        // Fall through to offline mode
      }
    }

    // Offline: Generate temp ID and queue
    const tempId = crypto.randomUUID();
    const offlineExpense = {
      id: tempId,
      ...expenseData,
      cached_at: Date.now(),
      is_temp: true,
      local_version: 1,
      created_by_id: expenseData.created_by_id || 0 // Will be set properly on sync
    };

    // Store in IndexedDB
    await db.expenses.add(offlineExpense);

    // Queue for sync
    await syncManager.queueOperation({
      type: 'CREATE_EXPENSE',
      entity_type: 'expense',
      entity_id: tempId,
      payload: expenseData
    });

    return { success: true, data: offlineExpense, offline: true };
  },

  /**
   * Update an expense - works offline
   */
  update: async (expenseId: number | string, expenseData: any) => {
    if (navigator.onLine && typeof expenseId === 'number') {
      // Online: Normal API call
      try {
        const response = await expensesApi.update(expenseId, expenseData);
        if (response.ok) {
          const expense = await response.json();

          // Update cache
          await db.expenses.update(expenseId, {
            ...expense,
            cached_at: Date.now(),
            is_temp: false,
            local_version: (await db.expenses.get(expenseId))?.local_version ?? 1
          });

          return { success: true, data: expense, offline: false };
        }
        throw new Error(`Failed to update expense: ${response.status}`);
      } catch (error) {
        console.error('Online expense update failed:', error);
        // Fall through to offline mode
      }
    }

    // Offline: Update locally and queue
    const existing = await db.expenses.get(expenseId);
    if (existing) {
      const updated = {
        ...existing,
        ...expenseData,
        id: expenseId,
        cached_at: Date.now(),
        local_version: (existing.local_version || 1) + 1
      };

      await db.expenses.update(expenseId, updated);

      // Queue for sync
      await syncManager.queueOperation({
        type: 'UPDATE_EXPENSE',
        entity_type: 'expense',
        entity_id: expenseId,
        payload: expenseData
      });

      return { success: true, data: updated, offline: true };
    }

    throw new Error('Expense not found');
  },

  /**
   * Delete an expense - works offline
   */
  delete: async (expenseId: number | string) => {
    if (navigator.onLine && typeof expenseId === 'number') {
      // Online: Normal API call
      try {
        const response = await expensesApi.delete(expenseId);
        if (response.ok) {
          await db.expenses.delete(expenseId);
          return { success: true, offline: false };
        }
        throw new Error(`Failed to delete expense: ${response.status}`);
      } catch (error) {
        console.error('Online expense deletion failed:', error);
        // Fall through to offline mode
      }
    }

    // Offline: Mark for deletion
    const existing = await db.expenses.get(expenseId);
    if (existing) {
      // If it's a temp expense, just delete it locally
      if (existing.is_temp) {
        await db.expenses.delete(expenseId);
        // Also remove from pending queue
        const pending = await db.pendingOperations
          .where('entity_id')
          .equals(expenseId as string)
          .toArray();
        for (const op of pending) {
          await db.pendingOperations.delete(op.id);
        }
        return { success: true, offline: true };
      }

      // Otherwise, queue for deletion
      await db.expenses.delete(expenseId);
      await syncManager.queueOperation({
        type: 'DELETE_EXPENSE',
        entity_type: 'expense',
        entity_id: expenseId,
        payload: {}
      });

      return { success: true, offline: true };
    }

    throw new Error('Expense not found');
  },

  /**
   * Get all expenses - uses cache when offline
   */
  getAll: async (groupId?: number) => {
    if (navigator.onLine) {
      try {
        const expenses = await expensesApi.getAll(groupId);

        // Update cache
        const cachedExpenses = expenses.map((e: any) => ({
          ...e,
          cached_at: Date.now(),
          is_temp: false,
          local_version: 1
        }));

        // Clear old cached expenses for this group
        if (groupId) {
          const oldExpenses = await db.expenses
            .where('group_id')
            .equals(groupId)
            .filter(e => !e.is_temp)
            .toArray();
          await db.expenses.bulkDelete(oldExpenses.map(e => e.id));
        }

        await db.expenses.bulkAdd(cachedExpenses);

        return expenses;
      } catch (error) {
        console.warn('Failed to fetch expenses online, using cache:', error);
      }
    }

    // Offline or failed: Use cache
    let query = db.expenses.toCollection();
    if (groupId) {
      query = db.expenses.where('group_id').equals(groupId);
    }

    const cached = await query.toArray();
    return cached;
  },

  /**
   * Get expense by ID - uses cache when offline
   */
  getById: async (expenseId: number | string) => {
    if (navigator.onLine && typeof expenseId === 'number') {
      try {
        const expense = await expensesApi.getById(expenseId);

        // Update cache
        await db.expenses.put({
          ...expense,
          cached_at: Date.now(),
          is_temp: false,
          local_version: 1
        });

        return expense;
      } catch (error) {
        console.warn('Failed to fetch expense online, using cache:', error);
      }
    }

    // Offline or failed: Use cache
    const cached = await db.expenses.get(expenseId);
    if (cached) return cached;

    throw new Error('Expense not found');
  }
};

// ============================================================================
// Offline-Aware Groups API
// ============================================================================

export const offlineGroupsApi = {
  /**
   * Create a group - works offline
   */
  create: async (name: string, defaultCurrency: string = 'USD') => {
    if (navigator.onLine) {
      try {
        const response = await groupsApi.create(name, defaultCurrency);
        if (response.ok) {
          const group = await response.json();

          // Cache in IndexedDB
          await db.groups.add({
            ...group,
            cached_at: Date.now(),
            is_temp: false
          });

          return { success: true, data: group, offline: false };
        }
        throw new Error(`Failed to create group: ${response.status}`);
      } catch (error) {
        console.error('Online group creation failed:', error);
      }
    }

    // Offline: Generate temp ID and queue
    const tempId = crypto.randomUUID();
    const offlineGroup = {
      id: tempId,
      name,
      default_currency: defaultCurrency,
      icon: undefined,
      share_link_id: undefined,
      is_public: false,
      members: [],
      guests: [],
      cached_at: Date.now(),
      is_temp: true,
      created_by_id: 0 // Will be set on sync
    };

    await db.groups.add(offlineGroup);

    await syncManager.queueOperation({
      type: 'CREATE_GROUP',
      entity_type: 'group',
      entity_id: tempId,
      payload: { name, default_currency: defaultCurrency }
    });

    return { success: true, data: offlineGroup, offline: true };
  },

  /**
   * Update a group - works offline
   */
  update: async (groupId: number | string, name: string) => {
    if (navigator.onLine && typeof groupId === 'number') {
      try {
        const response = await groupsApi.update(groupId, name);
        if (response.ok) {
          const group = await response.json();

          await db.groups.update(groupId, {
            ...group,
            cached_at: Date.now(),
            is_temp: false
          });

          return { success: true, data: group, offline: false };
        }
        throw new Error(`Failed to update group: ${response.status}`);
      } catch (error) {
        console.error('Online group update failed:', error);
      }
    }

    // Offline: Update locally and queue
    const existing = await db.groups.get(groupId);
    if (existing) {
      const updated = { ...existing, name, cached_at: Date.now() };
      await db.groups.update(groupId, updated);

      await syncManager.queueOperation({
        type: 'UPDATE_GROUP',
        entity_type: 'group',
        entity_id: groupId,
        payload: { name }
      });

      return { success: true, data: updated, offline: true };
    }

    throw new Error('Group not found');
  },

  /**
   * Get all groups - uses cache when offline
   */
  getAll: async () => {
    if (navigator.onLine) {
      try {
        const groups = await groupsApi.getAll();

        // Update cache
        const cachedGroups = groups.map((g: any) => ({
          ...g,
          cached_at: Date.now(),
          is_temp: false
        }));

        // Clear old non-temp groups
        const oldGroups = await db.groups.filter(g => !g.is_temp).toArray();
        await db.groups.bulkDelete(oldGroups.map(g => g.id));
        await db.groups.bulkAdd(cachedGroups);

        return groups;
      } catch (error) {
        console.warn('Failed to fetch groups online, using cache:', error);
      }
    }

    // Offline: Use cache
    const cached = await db.groups.toArray();
    return cached;
  },

  /**
   * Get group by ID - uses cache when offline
   */
  getById: async (groupId: number | string) => {
    if (navigator.onLine && typeof groupId === 'number') {
      try {
        const group = await groupsApi.getById(groupId);

        await db.groups.put({
          ...group,
          cached_at: Date.now(),
          is_temp: false
        });

        return group;
      } catch (error) {
        console.warn('Failed to fetch group online, using cache:', error);
      }
    }

    // Offline: Use cache
    const cached = await db.groups.get(groupId);
    if (cached) return cached;

    throw new Error('Group not found');
  }
};
