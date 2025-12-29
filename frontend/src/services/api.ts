/**
 * Centralized API service for all backend communications
 */

// Use relative URL in production (goes through nginx proxy), absolute in development
const API_BASE_URL = import.meta.env.PROD ? '/api' : 'http://localhost:8000';

/**
 * Get the authentication token from localStorage
 */
const getToken = (): string | null => {
    return localStorage.getItem('token');
};

/**
 * Refresh the access token using the refresh token
 */
const refreshAccessToken = async (): Promise<string | null> => {
    const refreshToken = localStorage.getItem('refreshToken');
    if (!refreshToken) return null;

    try {
        const response = await fetch(`${API_BASE_URL}/auth/refresh`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refresh_token: refreshToken })
        });

        if (response.ok) {
            const data = await response.json();
            localStorage.setItem('token', data.access_token);
            return data.access_token;
        } else {
            // Refresh token expired or invalid
            localStorage.removeItem('token');
            localStorage.removeItem('refreshToken');
            return null;
        }
    } catch (error) {
        console.error('Token refresh failed:', error);
        return null;
    }
};

/**
 * Base fetch wrapper with authentication and automatic token refresh
 */
const apiFetch = async (
    endpoint: string,
    options: RequestInit = {}
): Promise<Response> => {
    let token = getToken();
    const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options.headers,
    };

    let response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers,
    });

    // If we get a 401, try to refresh the token and retry
    if (response.status === 401 && localStorage.getItem('refreshToken')) {
        token = await refreshAccessToken();

        if (token) {
            // Retry the request with the new token
            const newHeaders: HeadersInit = {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${token}`,
                ...options.headers,
            };

            response = await fetch(`${API_BASE_URL}${endpoint}`, {
                ...options,
                headers: newHeaders,
            });
        } else {
            // Refresh failed, redirect to login
            window.location.href = '/login';
        }
    }

    return response;
};

// ============================================================================
// Authentication API
// ============================================================================

export const authApi = {
    login: async (email: string, password: string) => {
        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        return response;
    },

    register: async (fullName: string, email: string, password: string) => {
        const response = await fetch(`${API_BASE_URL}/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ full_name: fullName, email, password }),
        });
        return response;
    },

    getCurrentUser: async () => {
        const response = await apiFetch('/me');
        if (!response.ok) throw new Error('Failed to fetch current user');
        return response.json();
    },
};

// ============================================================================
// Friends API
// ============================================================================

export const friendsApi = {
    getAll: async () => {
        const response = await apiFetch('/friends');
        if (!response.ok) throw new Error('Failed to fetch friends');
        return response.json();
    },

    getById: async (friendId: number) => {
        const response = await apiFetch(`/friends/${friendId}`);
        if (!response.ok) throw new Error('Failed to fetch friend');
        return response.json();
    },

    getExpenses: async (friendId: number) => {
        const response = await apiFetch(`/friends/${friendId}/expenses`);
        if (!response.ok) throw new Error('Failed to fetch friend expenses');
        return response.json();
    },

    getBalance: async (friendId: number) => {
        const response = await apiFetch(`/friends/${friendId}/balance`);
        if (!response.ok) throw new Error('Failed to fetch friend balance');
        return response.json();
    },

    add: async (email: string) => {
        const response = await apiFetch('/friends', {
            method: 'POST',
            body: JSON.stringify({ email }),
        });
        return response;
    },
};

// ============================================================================
// Groups API
// ============================================================================

export const groupsApi = {
    getAll: async () => {
        const response = await apiFetch('/groups');
        if (!response.ok) throw new Error('Failed to fetch groups');
        return response.json();
    },

    getById: async (groupId: number) => {
        const response = await apiFetch(`/groups/${groupId}`);
        if (!response.ok) throw new Error('Failed to fetch group');
        return response.json();
    },

    create: async (name: string, defaultCurrency: string = 'USD') => {
        const response = await apiFetch('/groups', {
            method: 'POST',
            body: JSON.stringify({ name, default_currency: defaultCurrency }),
        });
        return response;
    },

    update: async (groupId: number, data: { name: string; default_currency?: string; icon?: string | null }) => {
        const response = await apiFetch(`/groups/${groupId}`, {
            method: 'PUT',
            body: JSON.stringify(data),
        });
        return response;
    },

    delete: async (groupId: number) => {
        const response = await apiFetch(`/groups/${groupId}`, {
            method: 'DELETE',
        });
        return response;
    },

    addMember: async (groupId: number, email: string) => {
        const response = await apiFetch(`/groups/${groupId}/members`, {
            method: 'POST',
            body: JSON.stringify({ email }),
        });
        return response;
    },

    removeMember: async (groupId: number, userId: number) => {
        const response = await apiFetch(`/groups/${groupId}/members/${userId}`, {
            method: 'DELETE',
        });
        return response;
    },

    addGuest: async (groupId: number, name: string) => {
        const response = await apiFetch(`/groups/${groupId}/guests`, {
            method: 'POST',
            body: JSON.stringify({ name }),
        });
        return response;
    },

    removeGuest: async (groupId: number, guestId: number) => {
        const response = await apiFetch(`/groups/${groupId}/guests/${guestId}`, {
            method: 'DELETE',
        });
        return response;
    },

    claimGuest: async (groupId: number, guestId: number) => {
        const response = await apiFetch(`/groups/${groupId}/guests/${guestId}/claim`, {
            method: 'POST',
        });
        return response;
    },

    getBalances: async (groupId: number) => {
        const response = await apiFetch(`/groups/${groupId}/balances`);
        if (!response.ok) throw new Error('Failed to fetch group balances');
        return response.json();
    },

    share: async (groupId: number) => {
        const response = await apiFetch(`/groups/${groupId}/share`, {
            method: 'POST',
        });
        return response;
    },

    getExpenses: async (groupId: number) => {
        const response = await apiFetch(`/groups/${groupId}/expenses`);
        if (!response.ok) throw new Error('Failed to fetch group expenses');
        return response.json();
    },

    manageGuest: async (groupId: number, guestId: number, userId: number, isGuest: boolean) => {
        const response = await apiFetch(`/groups/${groupId}/guests/${guestId}/manage`, {
            method: 'POST',
            body: JSON.stringify({ user_id: userId, is_guest: isGuest }),
        });
        return response;
    },

    unmanageGuest: async (groupId: number, guestId: number) => {
        const response = await apiFetch(`/groups/${groupId}/guests/${guestId}/manage`, {
            method: 'DELETE',
        });
        return response;
    },

    manageMember: async (groupId: number, userId: number, managerId: number, isGuest: boolean) => {
        const response = await apiFetch(`/groups/${groupId}/members/${userId}/manage`, {
            method: 'POST',
            body: JSON.stringify({ user_id: managerId, is_guest: isGuest }),
        });
        return response;
    },

    unmanageMember: async (groupId: number, userId: number) => {
        const response = await apiFetch(`/groups/${groupId}/members/${userId}/manage`, {
            method: 'DELETE',
        });
        return response;
    },

    joinPublic: async (shareLinkId: string) => {
        const response = await apiFetch(`/groups/public/${shareLinkId}/join`, {
            method: 'POST',
        });
        return response;
    },
};

// ============================================================================
// Expenses API
// ============================================================================

export const expensesApi = {
    getAll: async (groupId?: number) => {
        const endpoint = groupId ? `/expenses?group_id=${groupId}` : '/expenses';
        const response = await apiFetch(endpoint);
        if (!response.ok) throw new Error('Failed to fetch expenses');
        return response.json();
    },

    getById: async (expenseId: number) => {
        const response = await apiFetch(`/expenses/${expenseId}`);
        if (!response.ok) throw new Error('Failed to fetch expense');
        return response.json();
    },

    getPublicById: async (shareLinkId: string, expenseId: number) => {
        // Assuming getApiUrl and fetchWithAuth are defined elsewhere or need to be added.
        // For now, using direct fetch and API_BASE_URL.
        const response = await fetch(`${API_BASE_URL}/groups/public/${shareLinkId}/expenses/${expenseId}`);
        if (!response.ok) throw new Error('Failed to fetch public expense');
        return response.json();
    },

    create: async (expenseData: any) => {
        const response = await apiFetch('/expenses', {
            method: 'POST',
            body: JSON.stringify(expenseData),
        });
        return response;
    },

    update: async (expenseId: number, expenseData: any) => {
        const response = await apiFetch(`/expenses/${expenseId}`, {
            method: 'PUT',
            body: JSON.stringify(expenseData),
        });
        return response;
    },

    delete: async (expenseId: number) => {
        const response = await apiFetch(`/expenses/${expenseId}`, {
            method: 'DELETE',
        });
        return response;
    },
};

// ============================================================================
// Balances API
// ============================================================================

export const balancesApi = {
    getAll: async () => {
        const response = await apiFetch('/balances');
        if (!response.ok) throw new Error('Failed to fetch balances');
        return response.json();
    },

    settleUp: async (
        creditorId: number,
        creditorIsGuest: boolean,
        amount: number,
        currency: string,
        groupId?: number
    ) => {
        const response = await apiFetch('/settle-up', {
            method: 'POST',
            body: JSON.stringify({
                creditor_id: creditorId,
                creditor_is_guest: creditorIsGuest,
                amount,
                currency,
                group_id: groupId,
            }),
        });
        return response;
    },
};

// ============================================================================
// Receipt Scanning API
// ============================================================================

export const receiptsApi = {
    scan: async (imageData: string) => {
        const response = await apiFetch('/scan-receipt', {
            method: 'POST',
            body: JSON.stringify({ image: imageData }),
        });
        return response;
    },
};

// Export a consolidated API object
export const api = {
    auth: authApi,
    friends: friendsApi,
    groups: groupsApi,
    expenses: expensesApi,
    balances: balancesApi,
    receipts: receiptsApi,
};

export default api;
