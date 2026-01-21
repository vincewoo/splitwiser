// API configuration with automatic token refresh
import { refreshAccessToken } from './AuthContext';
import { API_BASE_URL } from './config';

// Helper to get full API URL for a path
export const getApiUrl = (path: string): string => {
    // Remove leading slash if present for consistency
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    return `${API_BASE_URL}/${cleanPath}`;
};

// Create a fetch wrapper with automatic token refresh
export const fetchWithAuth = async (url: string, options: RequestInit = {}): Promise<Response> => {
    const token = localStorage.getItem('token');

    // Add authorization header if token exists
    const headers = {
        ...options.headers,
        ...(token && { 'Authorization': `Bearer ${token}` })
    };

    // Make the request
    let response = await fetch(url, {
        ...options,
        headers
    });

    // If 401, try to refresh and retry once
    if (response.status === 401) {
        const newToken = await refreshAccessToken();

        if (newToken) {
            // Retry with new token
            response = await fetch(url, {
                ...options,
                headers: {
                    ...options.headers,
                    'Authorization': `Bearer ${newToken}`
                }
            });
        } else {
            // Refresh failed, redirect to login
            window.location.href = '/login';
        }
    }

    return response;
};

export { API_BASE_URL };
