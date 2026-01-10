import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePageTitle } from './hooks/usePageTitle';
import { api } from './services/api';

interface UserProfile {
  id: number;
  email: string;
  full_name: string;
  is_active: boolean;
  email_verified: boolean;
  password_changed_at: string | null;
  last_login_at: string | null;
}

const AccountSettingsPage = () => {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Profile update state
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [profileError, setProfileError] = useState('');
  const [profileSuccess, setProfileSuccess] = useState('');
  const [isProfileLoading, setIsProfileLoading] = useState(false);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordError, setPasswordError] = useState('');
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [isPasswordLoading, setIsPasswordLoading] = useState(false);

  usePageTitle('Account Settings');

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const data = await api.profile.getProfile();
      setProfile(data);
      setFullName(data.full_name || '');
      setEmail(data.email);
    } catch (error) {
      console.error('Failed to load profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileError('');
    setProfileSuccess('');
    setIsProfileLoading(true);

    try {
      const updates: { full_name?: string; email?: string } = {};

      if (fullName !== profile?.full_name) {
        updates.full_name = fullName;
      }

      if (email !== profile?.email) {
        updates.email = email;
      }

      if (Object.keys(updates).length === 0) {
        setProfileError('No changes to save');
        setIsProfileLoading(false);
        return;
      }

      await api.profile.updateProfile(updates);

      if (updates.email) {
        setProfileSuccess('Profile updated. Please check your new email address to verify the change.');
      } else {
        setProfileSuccess('Profile updated successfully');
      }

      // Reload profile
      await loadProfile();
    } catch (error: any) {
      setProfileError(error.message || 'Failed to update profile');
    } finally {
      setIsProfileLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    // Validation
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match');
      return;
    }

    setIsPasswordLoading(true);

    try {
      await api.profile.changePassword(currentPassword, newPassword);
      setPasswordSuccess('Password changed successfully. Other sessions have been logged out.');

      // Clear password fields
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      setPasswordError(error.message || 'Failed to change password');
    } finally {
      setIsPasswordLoading(false);
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <svg className="animate-spin h-8 w-8 text-indigo-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <button
            onClick={() => navigate('/')}
            className="flex items-center text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200"
          >
            <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Dashboard
          </button>
        </div>

        <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-8">Account Settings</h1>

        <div className="space-y-6">
          {/* Profile Information Section */}
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Profile Information</h2>

            {profileSuccess && (
              <div className="mb-4 p-4 rounded-md bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800">
                <p className="text-sm text-green-800 dark:text-green-200">{profileSuccess}</p>
              </div>
            )}

            {profileError && (
              <div className="mb-4 p-4 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-800 dark:text-red-200">{profileError}</p>
              </div>
            )}

            <form onSubmit={handleProfileUpdate} className="space-y-4">
              <div>
                <label htmlFor="fullName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Full Name
                </label>
                <input
                  id="fullName"
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 dark:bg-gray-700 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  disabled={isProfileLoading}
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Email Address
                </label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 dark:bg-gray-700 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  disabled={isProfileLoading}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Changing your email will require verification
                </p>
              </div>

              <button
                type="submit"
                disabled={isProfileLoading}
                className="w-full sm:w-auto px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isProfileLoading ? 'Saving...' : 'Save Changes'}
              </button>
            </form>
          </div>

          {/* Change Password Section */}
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Change Password</h2>

            {passwordSuccess && (
              <div className="mb-4 p-4 rounded-md bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800">
                <p className="text-sm text-green-800 dark:text-green-200">{passwordSuccess}</p>
              </div>
            )}

            {passwordError && (
              <div className="mb-4 p-4 rounded-md bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800">
                <p className="text-sm text-red-800 dark:text-red-200">{passwordError}</p>
              </div>
            )}

            <form onSubmit={handlePasswordChange} className="space-y-4">
              <div>
                <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Current Password
                </label>
                <input
                  id="currentPassword"
                  type={showPasswords ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 dark:bg-gray-700 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  disabled={isPasswordLoading}
                  required
                />
              </div>

              <div>
                <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  New Password
                </label>
                <input
                  id="newPassword"
                  type={showPasswords ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 dark:bg-gray-700 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  disabled={isPasswordLoading}
                  required
                  minLength={8}
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Must be at least 8 characters
                </p>
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Confirm New Password
                </label>
                <input
                  id="confirmPassword"
                  type={showPasswords ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-gray-100 dark:bg-gray-700 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500"
                  disabled={isPasswordLoading}
                  required
                  minLength={8}
                />
              </div>

              <div className="flex items-center">
                <input
                  id="showPasswords"
                  type="checkbox"
                  checked={showPasswords}
                  onChange={(e) => setShowPasswords(e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="showPasswords" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
                  Show passwords
                </label>
              </div>

              <button
                type="submit"
                disabled={isPasswordLoading}
                className="w-full sm:w-auto px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-500 dark:hover:bg-indigo-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 dark:focus:ring-offset-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPasswordLoading ? 'Changing...' : 'Change Password'}
              </button>
            </form>
          </div>

          {/* Security Info Section */}
          <div className="bg-white dark:bg-gray-800 shadow rounded-lg p-6">
            <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">Security Information</h2>

            <div className="space-y-3 text-sm">
              <div className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                <span className="text-gray-600 dark:text-gray-400">Last Login:</span>
                <span className="text-gray-900 dark:text-gray-100">{formatDate(profile?.last_login_at || null)}</span>
              </div>
              <div className="flex justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                <span className="text-gray-600 dark:text-gray-400">Password Last Changed:</span>
                <span className="text-gray-900 dark:text-gray-100">{formatDate(profile?.password_changed_at || null)}</span>
              </div>
              <div className="flex justify-between py-2">
                <span className="text-gray-600 dark:text-gray-400">Email Verified:</span>
                <span className={`font-medium ${profile?.email_verified ? 'text-green-600 dark:text-green-400' : 'text-yellow-600 dark:text-yellow-400'}`}>
                  {profile?.email_verified ? 'Yes' : 'Pending'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AccountSettingsPage;
