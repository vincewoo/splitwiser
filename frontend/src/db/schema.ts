import Dexie, { type Table } from 'dexie';

// Cached user data
export interface CachedUser {
  id: number;
  email: string;
  full_name: string;
  cached_at: number;
}

// Group member interface
export interface GroupMember {
  id: number;
  user_id: number;
  full_name: string;
  email: string;
}

// Guest member interface
export interface GuestMember {
  id: number | string;
  group_id: number | string;
  name: string;
  created_by_id: number;
  claimed_by_id?: number;
  managed_by_id?: number | string;
  managed_by_type?: 'user' | 'guest';
}

// Cached group data
export interface CachedGroup {
  id: number | string;
  name: string;
  created_by_id: number;
  default_currency: string;
  icon?: string;
  share_link_id?: string;
  is_public: boolean;
  members: GroupMember[];
  guests: GuestMember[];
  cached_at: number;
  is_temp: boolean;
}

// Expense split interface
export interface ExpenseSplit {
  user_id: number | string;
  is_guest: boolean;
  amount_owed: number;
  percentage?: number;
  shares?: number;
}

// Expense item interface (for itemized expenses)
export interface ExpenseItem {
  description: string;
  price: number;
  is_tax_tip: boolean;
  assignments: Array<{
    user_id: number | string;
    is_guest: boolean;
  }>;
}

// Cached expense data
export interface CachedExpense {
  id: number | string;
  description: string;
  amount: number;
  currency: string;
  date: string;
  payer_id: number | string;
  payer_is_guest: boolean;
  group_id: number | string | null;
  created_by_id: number;
  split_type: 'EQUAL' | 'EXACT' | 'PERCENT' | 'SHARES' | 'ITEMIZED';
  splits: ExpenseSplit[];
  items?: ExpenseItem[];
  icon?: string;
  notes?: string;
  receipt_image_path?: string;
  exchange_rate?: string;
  cached_at: number;
  is_temp: boolean;
  local_version: number;
}

// Cached balance data
export interface CachedBalance {
  key: string;
  user_id: number;
  full_name: string;
  amount: number;
  currency: string;
  is_guest: boolean;
  group_id?: number;
  group_name?: string;
  cached_at: number;
}

// Cached exchange rates
export interface CachedExchangeRates {
  id: 1;
  rates: Record<string, number>;
  cached_at: number;
}

// Pending operation for sync queue
export interface PendingOperation {
  id: string;
  type:
    | 'CREATE_EXPENSE'
    | 'UPDATE_EXPENSE'
    | 'DELETE_EXPENSE'
    | 'CREATE_GROUP'
    | 'UPDATE_GROUP'
    | 'DELETE_GROUP'
    | 'SETTLE_UP'
    | 'ADD_MEMBER'
    | 'REMOVE_MEMBER'
    | 'ADD_GUEST'
    | 'REMOVE_GUEST';
  entity_type: 'expense' | 'group' | 'member' | 'guest';
  entity_id: number | string;
  payload: any;
  created_at: number;
  retry_count: number;
  last_error?: string;
  status: 'pending' | 'processing' | 'failed' | 'conflict';
}

// ID mapping from temp to server IDs
export interface IdMapping {
  temp_id: string;
  server_id: number;
  entity_type: 'expense' | 'group' | 'member' | 'guest';
  created_at: number;
}

// Sync metadata
export interface SyncMetadata {
  id: 1;
  last_full_sync: number;
  last_groups_sync: number;
  last_expenses_sync: number;
  sync_in_progress: boolean;
}

// Dexie database class
export class SplitwiserDB extends Dexie {
  users!: Table<CachedUser, number>;
  groups!: Table<CachedGroup, number | string>;
  expenses!: Table<CachedExpense, number | string>;
  balances!: Table<CachedBalance, string>;
  exchangeRates!: Table<CachedExchangeRates, number>;
  pendingOperations!: Table<PendingOperation, string>;
  idMappings!: Table<IdMapping, string>;
  syncMetadata!: Table<SyncMetadata, number>;

  constructor() {
    super('splitwiser');

    this.version(1).stores({
      users: 'id, email, cached_at',
      groups: 'id, name, created_by_id, cached_at, is_temp',
      expenses: 'id, group_id, date, cached_at, is_temp, [group_id+date]',
      balances: 'key, user_id, cached_at',
      exchangeRates: 'id',
      pendingOperations: 'id, type, entity_type, entity_id, status, created_at',
      idMappings: 'temp_id, server_id, entity_type',
      syncMetadata: 'id'
    });
  }
}

// Export singleton instance
export const db = new SplitwiserDB();
