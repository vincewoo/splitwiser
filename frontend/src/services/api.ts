/**
 * Centralized API service for all backend communications
 */

import { API_BASE_URL } from '../config';
import type { ExpensePayload } from '../types/expense';

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

    // Friend Request Methods
    sendRequest: async (userId: number) => {
        const response = await apiFetch('/friends/request', {
            method: 'POST',
            body: JSON.stringify({ user_id: userId }),
        });
        return response;
    },

    getIncomingRequests: async () => {
        const response = await apiFetch('/friends/requests/incoming');
        if (!response.ok) throw new Error('Failed to fetch incoming requests');
        return response.json();
    },

    getOutgoingRequests: async () => {
        const response = await apiFetch('/friends/requests/outgoing');
        if (!response.ok) throw new Error('Failed to fetch outgoing requests');
        return response.json();
    },

    getPendingCount: async () => {
        const response = await apiFetch('/friends/requests/count');
        if (!response.ok) throw new Error('Failed to fetch pending count');
        return response.json();
    },

    acceptRequest: async (requestId: number) => {
        const response = await apiFetch(`/friends/requests/${requestId}/accept`, {
            method: 'POST',
        });
        return response;
    },

    rejectRequest: async (requestId: number) => {
        const response = await apiFetch(`/friends/requests/${requestId}/reject`, {
            method: 'POST',
        });
        return response;
    },

    cancelRequest: async (requestId: number) => {
        const response = await apiFetch(`/friends/requests/${requestId}`, {
            method: 'DELETE',
        });
        return response;
    },

    getStatus: async (userId: number) => {
        const response = await apiFetch(`/friends/status/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch friendship status');
        return response.json();
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

    create: async (
        name: string,
        defaultCurrency: string = 'USD',
        icon: string | null = null
    ) => {
        const response = await apiFetch('/groups', {
            method: 'POST',
            body: JSON.stringify({ name, default_currency: defaultCurrency, icon }),
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

    /**
     * Fold a guest onto an account already in the group — the fix for somebody
     * who joined as themselves instead of taking the guest's place. Claiming
     * only ever merges onto the caller; this one names the account.
     */
    mergeGuest: async (groupId: number, guestId: number, userId: number) => {
        const response = await apiFetch(`/groups/${groupId}/guests/${guestId}/merge`, {
            method: 'POST',
            body: JSON.stringify({ user_id: userId }),
        });
        return response;
    },

    getBalances: async (groupId: number, convertTo?: string) => {
        const url = convertTo
            ? `/groups/${groupId}/balances?convert_to=${convertTo}`
            : `/groups/${groupId}/balances`;
        const response = await apiFetch(url);
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

    getSummary: async (groupId: number) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await apiFetch(`/groups/${groupId}/summary`, {
                signal: controller.signal,
            });
            if (!response.ok) throw new Error('Failed to fetch group summary');
            return response.json();
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                throw new Error('Summary request timed out');
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
    },

    getPublicSummary: async (shareLinkId: string) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
            const response = await fetch(
                `${API_BASE_URL}/groups/public/${shareLinkId}/summary`,
                { signal: controller.signal },
            );
            if (!response.ok) throw new Error('Failed to fetch public group summary');
            return response.json();
        } catch (err) {
            if (err instanceof DOMException && err.name === 'AbortError') {
                throw new Error('Summary request timed out');
            }
            throw err;
        } finally {
            clearTimeout(timeoutId);
        }
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

    create: async (expenseData: ExpensePayload) => {
        const response = await apiFetch('/expenses', {
            method: 'POST',
            body: JSON.stringify(expenseData),
        });
        return response;
    },

    update: async (expenseId: number, expenseData: ExpensePayload) => {
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

    // Expense guest methods
    toggleExpenseGuestPaid: async (expenseId: number, guestId: number, paid: boolean) => {
        const response = await apiFetch(`/expenses/${expenseId}/guests/${guestId}/paid`, {
            method: 'PATCH',
            body: JSON.stringify({ paid }),
        });
        if (!response.ok) throw new Error('Failed to update guest paid status');
        return response.json();
    },
};

// ============================================================================
// Balances API
// ============================================================================

export const balancesApi = {
    getAll: async (convertTo?: string) => {
        const url = convertTo ? `/balances?convert_to=${convertTo}` : '/balances';
        const response = await apiFetch(url);
        if (!response.ok) throw new Error('Failed to fetch balances');
        return response.json();
    },

    simplifyDebts: async (groupId: number) => {
        const response = await apiFetch(`/simplify_debts/${groupId}`);
        if (!response.ok) throw new Error('Failed to simplify debts');
        return response.json();
    },

};

// ============================================================================
// Tabs API
// ============================================================================

export const tabsApi = {
    getAll: async (statusFilter?: string) => {
        const url = statusFilter ? `/tabs?status_filter=${statusFilter}` : '/tabs';
        const response = await apiFetch(url);
        if (!response.ok) throw new Error('Failed to fetch tabs');
        return response.json();
    },

    getById: async (tabId: number) => {
        const response = await apiFetch(`/tabs/${tabId}`);
        if (!response.ok) throw new Error('Failed to fetch tab');
        return response.json();
    },

    create: async (payload: {
        name: string;
        currency?: string;
        items: { description: string; price: number }[];
        tax?: number;
        tip?: number;
        total?: number | null;
        receipt_image_path?: string | null;
    }) => {
        const response = await apiFetch('/tabs', {
            method: 'POST',
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            const detail = body.detail;
            const message = Array.isArray(detail)
                ? detail
                      .map((issue: { loc?: Array<string | number>; msg?: string }) => {
                          if (!issue.msg) return null;
                          const location = issue.loc?.[issue.loc.length - 1];
                          return location === undefined
                              ? issue.msg
                              : `${String(location)}: ${issue.msg}`;
                      })
                      .filter((issue: string | null): issue is string => issue !== null)
                      .join(', ')
                : typeof detail === 'string'
                  ? detail
                  : '';
            throw new Error(message || 'Could not open the tab. Please try again.');
        }
        return response.json();
    },

    addItem: async (tabId: number, description: string, price: number) => {
        const response = await apiFetch(`/tabs/${tabId}/items`, {
            method: 'POST',
            body: JSON.stringify({ description, price }),
        });
        if (!response.ok) throw new Error('Failed to add the item');
        return response.json();
    },

    // Owner-only: correct what the scan read. Either field may be omitted to
    // leave it as it stands.
    updateAmounts: async (
        tabId: number,
        amounts: { tax?: number; tip?: number }
    ) => {
        const response = await apiFetch(`/tabs/${tabId}/amounts`, {
            method: 'PATCH',
            body: JSON.stringify(amounts),
        });
        if (!response.ok) throw new Error('Could not save the tax and tip');
        return response.json();
    },

    deleteItem: async (tabId: number, itemId: number) => {
        const response = await apiFetch(`/tabs/${tabId}/items/${itemId}`, {
            method: 'DELETE',
        });
        if (!response.ok) throw new Error('Failed to remove the item');
        return response.json();
    },

    close: async (tabId: number, payerParticipantId?: number | null) => {
        const response = await apiFetch(`/tabs/${tabId}/close`, {
            method: 'POST',
            body: JSON.stringify({
                payer_participant_id: payerParticipantId ?? null,
            }),
        });
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.detail || 'Failed to close the tab');
        }
        return response.json();
    },

    // Seat somebody who is at the table but not on the link — the flat-phone
    // case. A guest seat; the owner already speaks for it.
    addParticipant: async (tabId: number, displayName: string) => {
        const response = await apiFetch(`/tabs/${tabId}/participants`, {
            method: 'POST',
            body: JSON.stringify({ display_name: displayName }),
        });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(
                typeof body.detail === 'string'
                    ? body.detail
                    : 'Could not add that person'
            );
        }
        return response.json();
    },

    // Claim as the signed-in participant. Distinct from publicTabsApi.claim:
    // identity comes from the session, not from a claim token.
    claimOwn: async (tabId: number, itemId: number, claimed: boolean) => {
        const response = await apiFetch(`/tabs/${tabId}/items/${itemId}/claim`, {
            method: 'POST',
            body: JSON.stringify({ claimed }),
        });
        if (!response.ok) throw new Error('Could not update that item');
        return response.json();
    },

    // Owner-only: tick a line on someone else's behalf. Somebody at the table
    // always leaves early or never opens the link.
    setClaim: async (
        tabId: number,
        itemId: number,
        participantId: number,
        claimed: boolean
    ) => {
        const response = await apiFetch(
            `/tabs/${tabId}/items/${itemId}/claim/${participantId}`,
            { method: 'POST', body: JSON.stringify({ claimed }) }
        );
        if (!response.ok) throw new Error('Could not update that item');
        return response.json();
    },

    revoke: async (tabId: number) => {
        const response = await apiFetch(`/tabs/${tabId}/revoke`, { method: 'POST' });
        if (!response.ok) throw new Error('Failed to revoke the link');
        return response.json();
    },
};

// Public tab endpoints. Unauthenticated by design — the share token IS the
// credential — so these bypass apiFetch and never attach a bearer token.
export const publicTabsApi = {
    get: async (shareToken: string) => {
        const response = await fetch(
            `${API_BASE_URL}/public/tabs/${encodeURIComponent(shareToken)}`
        );
        if (response.status === 410) throw new Error('This link has expired');
        if (!response.ok) throw new Error('This link is no longer valid');
        return response.json();
    },

    /**
     * Take a seat.
     *
     * `withAuth` sends the access token if there is one, so a signed-in
     * claimer is seated as their account and the closed tab reaches their
     * balances instead of becoming a guest line. `claimToken` binds that
     * account to a seat they have already been claiming from.
     *
     * Unlike apiFetch, a failed refresh never redirects to /login: most people
     * opening this link have no account, and bouncing them would strand them.
     */
    join: async (
        shareToken: string,
        {
            displayName,
            claimToken,
            withAuth = false,
        }: { displayName?: string; claimToken?: string; withAuth?: boolean } = {}
    ) => {
        const path = `/public/tabs/${encodeURIComponent(shareToken)}/join`;
        const body = JSON.stringify({
            ...(displayName !== undefined && { display_name: displayName }),
            ...(claimToken !== undefined && { claim_token: claimToken }),
        });
        const send = (token: string | null) =>
            fetch(`${API_BASE_URL}${path}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token && { Authorization: `Bearer ${token}` }),
                },
                body,
            });

        let response = await send(withAuth ? getToken() : null);
        // An expired access token is refused rather than quietly seating them
        // as a guest, so this is the retry that refusal is for.
        if (withAuth && response.status === 401) {
            const refreshed = await refreshAccessToken();
            response = await send(refreshed);
        }
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.detail || 'Could not join this tab');
        }
        return response.json();
    },

    // Change the name you are claiming under. Distinct from join on purpose:
    // joining again would seat a second you and strand the claims you already
    // made under a name nobody is answering to.
    rename: async (
        shareToken: string,
        claimToken: string,
        displayName: string
    ) => {
        const response = await fetch(
            `${API_BASE_URL}/public/tabs/${encodeURIComponent(shareToken)}/rename`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    claim_token: claimToken,
                    display_name: displayName,
                }),
            }
        );
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.detail || 'Could not change your name');
        }
        return response.json();
    },

    claim: async (
        shareToken: string,
        itemId: number,
        claimToken: string,
        claimed: boolean
    ) => {
        const response = await fetch(
            `${API_BASE_URL}/public/tabs/${encodeURIComponent(shareToken)}/items/${itemId}/claim`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ claim_token: claimToken, claimed }),
            }
        );
        if (!response.ok) {
            const detail = await response.json().catch(() => ({}));
            throw new Error(detail.detail || 'Could not update that item');
        }
        return response.json();
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

// ============================================================================
// Profile Management API
// ============================================================================

export const profileApi = {
    getProfile: async () => {
        const response = await apiFetch('/users/me/profile');
        if (!response.ok) throw new Error('Failed to fetch profile');
        return response.json();
    },

    updateProfile: async (data: { full_name?: string; email?: string; default_currency?: string }) => {
        const response = await apiFetch('/users/me/profile', {
            method: 'PUT',
            body: JSON.stringify(data),
        });
        if (!response.ok) throw new Error('Failed to update profile');
        return response.json();
    },

    changePassword: async (currentPassword: string, newPassword: string) => {
        const response = await apiFetch('/auth/change-password', {
            method: 'POST',
            body: JSON.stringify({
                current_password: currentPassword,
                new_password: newPassword,
            }),
        });
        if (!response.ok) {
            const error = await response.json();
            // Handle FastAPI validation error array
            const errorMessage = Array.isArray(error.detail)
                ? error.detail.map((e: { msg: string }) => e.msg).join(', ')
                : (error.detail || 'Failed to change password');
            throw new Error(errorMessage);
        }
        return response.json();
    },

    forgotPassword: async (email: string) => {
        const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
        });
        if (!response.ok) throw new Error('Failed to send password reset email');
        return response.json();
    },

    resetPassword: async (token: string, newPassword: string) => {
        const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, new_password: newPassword }),
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to reset password');
        }
        return response.json();
    },

    verifyEmail: async (token: string) => {
        const response = await fetch(`${API_BASE_URL}/auth/verify-email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to verify email');
        }
        return response.json();
    },

    resendVerificationEmail: async () => {
        const response = await apiFetch('/auth/resend-verification-email', {
            method: 'POST',
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Failed to resend verification email');
        }
        return response.json();
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
    profile: profileApi,
};

export default api;
