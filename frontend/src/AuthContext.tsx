import React, { createContext, useContext, useEffect, useState } from 'react';
import { getApiUrl } from './api';
import { refreshAccessToken } from './services/api';

interface User {
  id: number;
  email: string;
  full_name: string;
  default_currency?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType>(null!);

// Fetch user with automatic token refresh on 401
const fetchUserWithRefresh = async (): Promise<User | null> => {
  let token = localStorage.getItem('token');

  if (!token) return null;

  try {
    const response = await fetch(getApiUrl('users/me'), {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (response.ok) {
      return await response.json();
    }

    // If 401, try to refresh token
    if (response.status === 401) {
      token = await refreshAccessToken();
      if (!token) return null;

      // Retry with new token
      const retryResponse = await fetch(getApiUrl('users/me'), {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (retryResponse.ok) {
        return await retryResponse.json();
      }
    }

    return null;
  } catch (error) {
    console.error('Error fetching user:', error);
    return null;
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchUser = async () => {
      const userData = await fetchUserWithRefresh();
      setUser(userData);
      setLoading(false);
    };

    fetchUser();
  }, []);

  const logout = async () => {
    const refreshToken = localStorage.getItem('refreshToken');

    // Revoke refresh token on server
    if (refreshToken) {
      try {
        await fetch(getApiUrl('auth/logout'), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ refresh_token: refreshToken })
        });
      } catch (error) {
        console.error('Logout error:', error);
      }
    }

    localStorage.removeItem('token');
    localStorage.removeItem('refreshToken');
    setUser(null);
    window.location.href = '/login';
  };

  return (
    <AuthContext.Provider value={{ user, loading, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
