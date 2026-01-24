import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Login from './Login';
import Register from './Register';
import AddExpenseModal from './AddExpenseModal';
import SettleUpModal from './SettleUpModal';
import AddGroupModal from './AddGroupModal';
import AddFriendModal from './AddFriendModal';
import GroupDetailPage from './GroupDetailPage';
import FriendDetailPage from './FriendDetailPage';
import HelpPage from './HelpPage';
import AccountSettingsPage from './AccountSettingsPage';
import ForgotPasswordPage from './ForgotPasswordPage';
import ResetPasswordPage from './ResetPasswordPage';
import VerifyEmailPage from './VerifyEmailPage';
import { AuthProvider, useAuth } from './AuthContext';
import { ThemeProvider, useTheme } from './ThemeContext';
import { SyncProvider } from './contexts/SyncContext';
import SyncStatusBar from './components/SyncStatusBar';
import type { Friend } from './types/friend';
import type { Group } from './types/group';
import type { Balance } from './types/balance';
import { formatMoney } from './utils/formatters';
import { friendsApi, groupsApi, balancesApi } from './services/api';
import { usePageTitle } from './hooks/usePageTitle';

const Dashboard = () => {
  const { user, logout } = useAuth();
  const { isDark, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isSettleUpModalOpen, setIsSettleUpModalOpen] = useState(false);
  const [isAddGroupModalOpen, setIsAddGroupModalOpen] = useState(false);
  const [isAddFriendModalOpen, setIsAddFriendModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showMyCurrency, setShowMyCurrency] = useState(false); // Toggle: false = group currencies, true = my currency

  // Set dynamic page title
  usePageTitle('Dashboard');

  useEffect(() => {
    fetchFriends();
    fetchGroups();
    fetchBalances();
  }, []);

  const fetchFriends = async () => {
    try {
      const data = await friendsApi.getAll();
      setFriends(data);
    } catch (error) {
      console.error('Failed to fetch friends:', error);
    }
  };

  const fetchGroups = async () => {
    try {
      const data = await groupsApi.getAll();
      setGroups(data);
    } catch (error) {
      console.error('Failed to fetch groups:', error);
    }
  };

  const fetchBalances = async (convertToMyCurrency: boolean = showMyCurrency) => {
    try {
      const userCurrency = user?.default_currency || 'USD';
      const convertTo = convertToMyCurrency ? userCurrency : undefined;
      const data = await balancesApi.getAll(convertTo);
      setBalances(data.balances || []);
    } catch (error) {
      console.error('Failed to fetch balances:', error);
    }
  };

  // Re-fetch balances when toggle changes
  useEffect(() => {
    if (user) {
      fetchBalances(showMyCurrency);
    }
  }, [showMyCurrency, user?.default_currency]);

  const handleAddFriend = () => {
    fetchFriends();
  };

  const handleCreateGroup = () => {
    fetchGroups();
  };

  const onExpenseAdded = () => {
    fetchBalances();
  };

  const calculateTotalBalance = () => {
    // Only calculate total when in "My Currency" mode
    if (!showMyCurrency) return null;

    // All balances are already in user's currency when showMyCurrency is true
    return balances.reduce((total, b) => total + b.amount, 0);
  };

  // Get user's display currency for formatting
  const displayCurrency = user?.default_currency || 'USD';

  // formatMoney now imported from utils

  return (
    <div className="flex h-screen bg-gray-100 dark:bg-gray-900 font-sans">
      {/* Mobile overlay */}
      {isSidebarOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-20 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <div className={`
        fixed lg:static inset-y-0 left-0 z-30
        w-64 bg-white dark:bg-gray-800 shadow-md flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6 border-b dark:border-gray-700 flex justify-between items-center">
          <h1 className="text-2xl font-bold text-teal-600 dark:text-teal-400">Splitwiser</h1>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden text-gray-500 hover:text-gray-700"
            aria-label="Close sidebar"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="mt-6 flex-1 px-4 space-y-2 overflow-y-auto">
          <div
            onClick={() => {
              navigate('/');
              setIsSidebarOpen(false);
            }}
            className="flex items-center px-4 py-2 text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 rounded-md cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            <span className="font-medium">Dashboard</span>
          </div>

          <div className="pt-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">Friends</h3>
              <button
                onClick={() => setIsAddFriendModalOpen(true)}
                className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-teal-500 dark:text-teal-400 transition-colors"
                aria-label="Add friend"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
              </button>
            </div>
            <ul className="space-y-1">
              {[...friends].sort((a, b) => a.full_name.localeCompare(b.full_name)).map(friend => (
                <li
                  key={friend.id}
                  className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-gray-700 px-2 py-1 cursor-pointer rounded transition-colors"
                  onClick={() => {
                    navigate(`/friends/${friend.id}`);
                    setIsSidebarOpen(false);
                  }}
                >
                  {friend.full_name}
                </li>
              ))}
            </ul>
          </div>
        </nav>
        <div className="p-4 border-t dark:border-gray-700">
          <button
            onClick={() => {
              navigate('/help');
              setIsSidebarOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 mb-3 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium">Help & FAQ</span>
          </button>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200 truncate">{user?.full_name}</span>
            <button
              onClick={toggleTheme}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              aria-label="Toggle theme"
            >
              {isDark ? (
                <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              ) : (
                <svg className="w-5 h-5 text-gray-700" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              )}
            </button>
          </div>
          <button
            onClick={() => {
              navigate('/account');
              setIsSidebarOpen(false);
            }}
            className="w-full flex items-center gap-2 px-3 py-2 mb-3 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="font-medium">Account Settings</span>
          </button>
          <button onClick={logout} className="text-xs text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300 font-medium">Logout</button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex justify-between items-center p-4 lg:p-6 bg-white dark:bg-gray-800 shadow-sm dark:shadow-gray-900/50">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="lg:hidden text-gray-500 hover:text-gray-700"
              aria-label="Open sidebar"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <h2 className="text-xl lg:text-2xl font-semibold text-gray-800 dark:text-gray-100">Dashboard</h2>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setIsExpenseModalOpen(true)}
              className="bg-orange-500 text-white px-3 py-2 lg:px-4 rounded shadow hover:bg-orange-600 text-xs lg:text-sm font-medium whitespace-nowrap"
              aria-label="Add expense"
            >
              <span className="hidden sm:inline">Add expense</span>
              <span className="sm:hidden">+</span>
            </button>
            <button
              onClick={() => setIsSettleUpModalOpen(true)}
              className="bg-teal-500 text-white px-3 py-2 lg:px-4 rounded shadow hover:bg-teal-600 text-xs lg:text-sm font-medium whitespace-nowrap"
              aria-label="Settle up"
            >
              <span className="hidden sm:inline">Settle up</span>
              <span className="sm:hidden">$</span>
            </button>
          </div>
        </header>
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 dark:bg-gray-900 p-4 lg:p-6">
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 h-full">
            {/* Left Column - Groups (Primary) */}
            <div className="flex-1 lg:flex-[2] bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden flex flex-col">
              <div className="flex items-center justify-between p-4 lg:p-5 border-b border-gray-100 dark:border-gray-700">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Groups</h3>
                <button
                  onClick={() => setIsAddGroupModalOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-white bg-teal-500 hover:bg-teal-600 rounded-md font-medium transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>New Group</span>
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 lg:p-5">
                {groups.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full text-center py-12">
                    <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mb-4">
                      <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                    </div>
                    <p className="text-gray-500 dark:text-gray-400 mb-2">No groups yet</p>
                    <p className="text-sm text-gray-400 dark:text-gray-500">Create a group to start splitting expenses</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {[...groups].sort((a, b) => a.name.localeCompare(b.name)).map(group => (
                      <div
                        key={group.id}
                        onClick={() => navigate(`/groups/${group.id}`)}
                        className="flex items-center gap-4 p-4 bg-gray-50 dark:bg-gray-700/50 hover:bg-teal-50 dark:hover:bg-teal-900/20 border border-gray-200 dark:border-gray-600 hover:border-teal-400 dark:hover:border-teal-500 rounded-lg cursor-pointer transition-all duration-150"
                      >
                        <div className="w-12 h-12 bg-white dark:bg-gray-600 rounded-lg flex items-center justify-center shadow-sm">
                          {group.icon ? (
                            <span className="text-2xl">{group.icon}</span>
                          ) : (
                            <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                            </svg>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="font-medium text-gray-900 dark:text-gray-100 block truncate">{group.name}</span>
                        </div>
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Right Column - Balance Summary */}
            <div className="lg:flex-1 flex flex-col gap-4 lg:gap-5">
              {/* Currency Toggle & Total */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 lg:p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider">Balance View</h3>
                  <button
                    onClick={() => setShowMyCurrency(!showMyCurrency)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${showMyCurrency
                      ? 'bg-teal-100 dark:bg-teal-900 text-teal-700 dark:text-teal-300'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400'
                      }`}
                  >
                    {showMyCurrency ? `Show in ${displayCurrency}` : 'Group Currencies'}
                  </button>
                </div>
                {showMyCurrency && (
                  <>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">Total Balance</p>
                    <div className={`text-3xl lg:text-4xl font-bold ${(calculateTotalBalance() ?? 0) >= 0 ? 'text-teal-500' : 'text-red-500'}`}>
                      {formatMoney(calculateTotalBalance() ?? 0, displayCurrency)}
                    </div>
                  </>
                )}
                {!showMyCurrency && (
                  <p className="text-sm text-gray-500 dark:text-gray-400">Showing each group in its own currency</p>
                )}
              </div>

              {/* You Owe Card */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 lg:p-5 flex-1">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">You Owe</h3>
                <ul className="space-y-2">
                  {balances.filter(b => b.amount < 0).length === 0 ? (
                    <li className="text-gray-400 dark:text-gray-500 italic text-sm">No debts</li>
                  ) : (
                    balances.filter(b => b.amount < 0).map((b, index) => (
                      <li key={b.is_guest ? `guest-${b.group_name}-${b.currency}-${index}` : `${b.user_id}-${b.currency}`} className="flex justify-between text-sm">
                        {b.is_guest && b.group_id ? (
                          <span
                            className="text-gray-700 dark:text-gray-300 cursor-pointer hover:text-red-500 dark:hover:text-red-400 transition-colors"
                            onClick={() => {
                              navigate(`/groups/${b.group_id}`);
                              setIsSidebarOpen(false);
                            }}
                          >
                            {b.full_name}
                          </span>
                        ) : (
                          <span className="text-gray-700 dark:text-gray-300">{b.full_name}</span>
                        )}
                        <span className="text-red-500 font-medium">{formatMoney(Math.abs(b.amount), b.currency)}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>

              {/* You Are Owed Card */}
              <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm p-4 lg:p-5 flex-1">
                <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-3">You Are Owed</h3>
                <ul className="space-y-2">
                  {balances.filter(b => b.amount > 0).length === 0 ? (
                    <li className="text-gray-400 dark:text-gray-500 italic text-sm">No one owes you</li>
                  ) : (
                    balances.filter(b => b.amount > 0).map((b, index) => (
                      <li key={b.is_guest ? `guest-${b.group_name}-${b.currency}-${index}` : `${b.user_id}-${b.currency}`} className="flex justify-between text-sm">
                        {b.is_guest && b.group_id ? (
                          <span
                            className="text-gray-700 dark:text-gray-300 cursor-pointer hover:text-teal-500 dark:hover:text-teal-400 transition-colors"
                            onClick={() => {
                              navigate(`/groups/${b.group_id}`);
                              setIsSidebarOpen(false);
                            }}
                          >
                            {b.full_name}
                          </span>
                        ) : (
                          <span className="text-gray-700 dark:text-gray-300">{b.full_name}</span>
                        )}
                        <span className="text-teal-500 font-medium">{formatMoney(b.amount, b.currency)}</span>
                      </li>
                    ))
                  )}
                </ul>
              </div>
            </div>
          </div>
        </main>
      </div>

      <AddExpenseModal
        isOpen={isExpenseModalOpen}
        onClose={() => setIsExpenseModalOpen(false)}
        onExpenseAdded={onExpenseAdded}
        friends={friends}
        groups={groups}
      />

      <SettleUpModal
        isOpen={isSettleUpModalOpen}
        onClose={() => setIsSettleUpModalOpen(false)}
        onSettled={onExpenseAdded}
        friends={friends}
      />

      <AddGroupModal
        isOpen={isAddGroupModalOpen}
        onClose={() => setIsAddGroupModalOpen(false)}
        onGroupAdded={handleCreateGroup}
      />

      <AddFriendModal
        isOpen={isAddFriendModalOpen}
        onClose={() => setIsAddFriendModalOpen(false)}
        onFriendAdded={handleAddFriend}
      />
    </div>
  );
};

const ProtectedRoute: React.FC<{ element: React.ReactElement }> = ({ element }) => {
  const { user, loading } = useAuth();

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900">
      <div className="flex flex-col items-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
        <p className="mt-4 text-gray-600 dark:text-gray-400">Loading...</p>
      </div>
    </div>
  );
  if (!user) return <Navigate to="/login" replace />;

  return element;
};

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <SyncProvider>
          <Router>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
              <Route path="/verify-email/:token" element={<VerifyEmailPage />} />

              {/* Protected routes */}
              <Route path="/" element={<ProtectedRoute element={<Dashboard />} />} />
              <Route path="/account" element={<ProtectedRoute element={<AccountSettingsPage />} />} />
              <Route path="/groups/:groupId" element={<ProtectedRoute element={<GroupDetailPage />} />} />
              <Route path="/friends/:friendId" element={<ProtectedRoute element={<FriendDetailPage />} />} />
              <Route path="/help" element={<ProtectedRoute element={<HelpPage />} />} />

              {/* Public share link */}
              <Route path="/share/:shareLinkId" element={<GroupDetailPage />} />
            </Routes>
            <SyncStatusBar />
          </Router>
        </SyncProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
