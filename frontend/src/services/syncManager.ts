import { db, type PendingOperation } from '../db';

const API_BASE_URL = import.meta.env.PROD ? '/api' : 'http://localhost:8000';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'conflict';

export interface SyncState {
  status: SyncStatus;
  pendingCount: number;
  lastSync: number | null;
  errors: string[];
  conflicts: PendingOperation[];
}

class SyncManager {
  private listeners: Set<(state: SyncState) => void> = new Set();
  private state: SyncState = {
    status: 'idle',
    pendingCount: 0,
    lastSync: null,
    errors: [],
    conflicts: []
  };
  private syncInProgress = false;

  // Subscribe to sync state changes
  subscribe(listener: (state: SyncState) => void): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach((l) => l(this.state));
  }

  private async updateState(partial: Partial<SyncState>) {
    this.state = { ...this.state, ...partial };
    this.state.pendingCount = await db.pendingOperations
      .where('status')
      .equals('pending')
      .count();
    this.notifyListeners();
  }

  // Queue an operation for sync
  async queueOperation(
    operation: Omit<
      PendingOperation,
      'id' | 'created_at' | 'retry_count' | 'status'
    >
  ) {
    const op: PendingOperation = {
      ...operation,
      id: crypto.randomUUID(),
      created_at: Date.now(),
      retry_count: 0,
      status: 'pending'
    };

    await db.pendingOperations.add(op);
    await this.updateState({});

    // Attempt immediate sync if online
    if (navigator.onLine) {
      this.sync();
    }
  }

  // Main sync function
  async sync(): Promise<void> {
    if (this.syncInProgress || !navigator.onLine) return;

    this.syncInProgress = true;
    await this.updateState({ status: 'syncing' });

    try {
      const operations = await db.pendingOperations
        .where('status')
        .equals('pending')
        .sortBy('created_at');

      for (const op of operations) {
        await this.processOperation(op);
      }

      // Refresh cached data after sync (includes exchange rates for offline expenses)
      await this.refreshCachedData();

      await this.updateState({
        status: this.state.conflicts.length > 0 ? 'conflict' : 'idle',
        lastSync: Date.now(),
        errors: []
      });
    } catch (error) {
      await this.updateState({
        status: 'error',
        errors: [...this.state.errors, (error as Error).message]
      });
    } finally {
      this.syncInProgress = false;
    }
  }

  private async processOperation(op: PendingOperation): Promise<void> {
    await db.pendingOperations.update(op.id, { status: 'processing' });

    try {
      const result = await this.executeOperation(op);

      if (result.success) {
        // Map temp ID to server ID if applicable
        if (result.serverId && typeof op.entity_id === 'string') {
          await db.idMappings.add({
            temp_id: op.entity_id,
            server_id: result.serverId,
            entity_type: op.entity_type,
            created_at: Date.now()
          });

          // Update local entity with server ID
          await this.updateEntityId(
            op.entity_type,
            op.entity_id,
            result.serverId
          );
        }

        // Remove from queue
        await db.pendingOperations.delete(op.id);
      } else if (result.conflict) {
        await db.pendingOperations.update(op.id, { status: 'conflict' });
        this.state.conflicts.push(op);
      }
    } catch (error) {
      const retryCount = op.retry_count + 1;

      if (retryCount >= 3) {
        await db.pendingOperations.update(op.id, {
          status: 'failed',
          retry_count: retryCount,
          last_error: (error as Error).message
        });
      } else {
        await db.pendingOperations.update(op.id, {
          status: 'pending',
          retry_count: retryCount,
          last_error: (error as Error).message
        });
      }
    }
  }

  private async executeOperation(
    op: PendingOperation
  ): Promise<{ success: boolean; serverId?: number; conflict?: boolean }> {
    // Resolve any temp IDs in payload to server IDs
    const resolvedPayload = await this.resolveTempIds(op.payload);

    const token = localStorage.getItem('token');
    const headers: HeadersInit = {
      'Content-Type': 'application/json'
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    switch (op.type) {
      case 'CREATE_EXPENSE': {
        const response = await fetch(`${API_BASE_URL}/expenses`, {
          method: 'POST',
          headers,
          body: JSON.stringify(resolvedPayload)
        });

        if (response.ok) {
          const expense = await response.json();
          return { success: true, serverId: expense.id };
        } else if (response.status === 409) {
          return { success: false, conflict: true };
        }
        throw new Error(`Failed to create expense: ${response.status}`);
      }

      case 'UPDATE_EXPENSE': {
        const resolvedId = await this.resolveId(op.entity_id, 'expense');
        const response = await fetch(
          `${API_BASE_URL}/expenses/${resolvedId}`,
          {
            method: 'PUT',
            headers,
            body: JSON.stringify(resolvedPayload)
          }
        );

        if (response.ok) {
          return { success: true };
        } else if (response.status === 409) {
          return { success: false, conflict: true };
        }
        throw new Error(`Failed to update expense: ${response.status}`);
      }

      case 'DELETE_EXPENSE': {
        const resolvedId = await this.resolveId(op.entity_id, 'expense');
        const response = await fetch(
          `${API_BASE_URL}/expenses/${resolvedId}`,
          {
            method: 'DELETE',
            headers
          }
        );

        if (response.ok || response.status === 404) {
          return { success: true };
        }
        throw new Error(`Failed to delete expense: ${response.status}`);
      }

      case 'CREATE_GROUP': {
        const response = await fetch(`${API_BASE_URL}/groups`, {
          method: 'POST',
          headers,
          body: JSON.stringify(resolvedPayload)
        });

        if (response.ok) {
          const group = await response.json();
          return { success: true, serverId: group.id };
        } else if (response.status === 409) {
          return { success: false, conflict: true };
        }
        throw new Error(`Failed to create group: ${response.status}`);
      }

      case 'UPDATE_GROUP': {
        const resolvedId = await this.resolveId(op.entity_id, 'group');
        const response = await fetch(`${API_BASE_URL}/groups/${resolvedId}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify(resolvedPayload)
        });

        if (response.ok) {
          return { success: true };
        } else if (response.status === 409) {
          return { success: false, conflict: true };
        }
        throw new Error(`Failed to update group: ${response.status}`);
      }

      case 'DELETE_GROUP': {
        const resolvedId = await this.resolveId(op.entity_id, 'group');
        const response = await fetch(`${API_BASE_URL}/groups/${resolvedId}`, {
          method: 'DELETE',
          headers
        });

        if (response.ok || response.status === 404) {
          return { success: true };
        }
        throw new Error(`Failed to delete group: ${response.status}`);
      }

      default:
        throw new Error(`Unknown operation type: ${op.type}`);
    }
  }

  private async resolveTempIds(payload: any): Promise<any> {
    if (typeof payload !== 'object' || payload === null) return payload;

    const resolved: any = Array.isArray(payload) ? [] : {};

    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string' && value.match(/^[0-9a-f-]{36}$/)) {
        // Looks like a UUID, try to resolve it
        const mapping = await db.idMappings.get(value);
        resolved[key] = mapping ? mapping.server_id : value;
      } else if (typeof value === 'object') {
        resolved[key] = await this.resolveTempIds(value);
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  private async resolveId(
    id: number | string,
    entityType: string
  ): Promise<number> {
    if (typeof id === 'number') return id;

    const mapping = await db.idMappings.get(id);
    if (mapping) return mapping.server_id;

    throw new Error(`Cannot resolve temp ID ${id} for ${entityType}`);
  }

  private async updateEntityId(
    entityType: string,
    tempId: string,
    serverId: number
  ) {
    switch (entityType) {
      case 'expense': {
        const expense = await db.expenses.get(tempId);
        if (expense) {
          await db.expenses.delete(tempId);
          await db.expenses.add({ ...expense, id: serverId, is_temp: false });
        }
        break;
      }
      case 'group': {
        const group = await db.groups.get(tempId);
        if (group) {
          await db.groups.delete(tempId);
          await db.groups.add({ ...group, id: serverId, is_temp: false });
        }
        break;
      }
    }
  }

  private async refreshCachedData() {
    const token = localStorage.getItem('token');
    if (!token) return;

    const headers = {
      Authorization: `Bearer ${token}`
    };

    // Refresh groups
    try {
      const response = await fetch(`${API_BASE_URL}/groups`, { headers });
      if (response.ok) {
        const groups = await response.json();
        // Delete all non-temp groups
        const nonTempGroups = await db.groups.filter(g => !g.is_temp).toArray();
        await db.groups.bulkDelete(nonTempGroups.map(g => g.id));
        await db.groups.bulkAdd(
          groups.map((g: any) => ({
            ...g,
            cached_at: Date.now(),
            is_temp: false
          }))
        );
      }
    } catch (e) {
      console.warn('Failed to refresh groups:', e);
    }

    // Refresh expenses (includes exchange rates for offline-created expenses)
    try {
      const response = await fetch(`${API_BASE_URL}/expenses`, { headers });
      if (response.ok) {
        const expenses = await response.json();
        // Delete all non-temp expenses
        const nonTempExpenses = await db.expenses.filter(e => !e.is_temp).toArray();
        await db.expenses.bulkDelete(nonTempExpenses.map(e => e.id));
        await db.expenses.bulkAdd(
          expenses.map((e: any) => ({
            ...e,
            cached_at: Date.now(),
            is_temp: false,
            local_version: 1
          }))
        );
      }
    } catch (e) {
      console.warn('Failed to refresh expenses:', e);
    }

    // Refresh balances
    try {
      const response = await fetch(`${API_BASE_URL}/balances`, { headers });
      if (response.ok) {
        const data = await response.json();
        await db.balances.clear();
        await db.balances.bulkAdd(
          data.balances.map((b: any) => ({
            ...b,
            key: `${b.user_id}_${b.currency}_${b.is_guest}`,
            cached_at: Date.now()
          }))
        );
      }
    } catch (e) {
      console.warn('Failed to refresh balances:', e);
    }
  }

  // Retry failed operations
  async retryFailed() {
    const failed = await db.pendingOperations
      .where('status')
      .equals('failed')
      .toArray();

    for (const op of failed) {
      await db.pendingOperations.update(op.id, {
        status: 'pending',
        retry_count: 0
      });
    }

    this.sync();
  }

  // Discard a conflicted operation
  async discardOperation(operationId: string) {
    const op = await db.pendingOperations.get(operationId);
    if (op) {
      await db.pendingOperations.delete(operationId);

      // Also remove the optimistic local data if it was a create
      if (op.type.startsWith('CREATE_') && typeof op.entity_id === 'string') {
        switch (op.entity_type) {
          case 'expense':
            await db.expenses.delete(op.entity_id);
            break;
          case 'group':
            await db.groups.delete(op.entity_id);
            break;
        }
      }

      this.state.conflicts = this.state.conflicts.filter(
        (c) => c.id !== operationId
      );
      await this.updateState({});
    }
  }
}

export const syncManager = new SyncManager();

// Auto-sync when coming online
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncManager.sync();
  });
}
