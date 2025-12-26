import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Login from './Login';
import Register from './Register';
import AddExpenseModal from './AddExpenseModal';
import SettleUpModal from './SettleUpModal';
import GroupDetailPage from './GroupDetailPage';
import { AuthProvider, useAuth } from './AuthContext';

interface Friend {
  id: number;
  full_name: string;
  email: string;
}

interface Group {
  id: number;
  name: string;
  created_by_id: number;
  default_currency: string;
}

interface Balance {
  user_id: number;
  full_name: string;
  amount: number;
  currency: string;
}

const Dashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [newFriendEmail, setNewFriendEmail] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupCurrency, setNewGroupCurrency] = useState('USD');
  const [currencies] = useState<string[]>(['USD', 'EUR', 'GBP', 'JPY', 'CAD']);
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isSettleUpModalOpen, setIsSettleUpModalOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    fetchFriends();
    fetchGroups();
    fetchBalances();
  }, []);

  const fetchFriends = async () => {
    const token = localStorage.getItem('token');
    const response = await fetch('http://localhost:8000/friends', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      setFriends(await response.json());
    }
  };

  const fetchGroups = async () => {
    const token = localStorage.getItem('token');
    const response = await fetch('http://localhost:8000/groups', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
      setGroups(await response.json());
    }
  };

  const fetchBalances = async () => {
    const token = localStorage.getItem('token');
    const response = await fetch('http://localhost:8000/balances', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.ok) {
        const data = await response.json();
        setBalances(data.balances || []);
    }
  };

  const handleAddFriend = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    const response = await fetch('http://localhost:8000/friends', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email: newFriendEmail })
    });
    if (response.ok) {
        setNewFriendEmail('');
        fetchFriends();
    } else {
        alert('Failed to add friend');
    }
  };

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    const response = await fetch('http://localhost:8000/groups', {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newGroupName, default_currency: newGroupCurrency })
    });
    if (response.ok) {
        setNewGroupName('');
        setNewGroupCurrency('USD');
        fetchGroups();
    } else {
        alert('Failed to create group');
    }
  };

  const onExpenseAdded = () => {
      fetchBalances();
  };

  const [exchangeRates, setExchangeRates] = useState<Record<string, number> | null>(null);

  useEffect(() => {
      fetch('http://localhost:8000/exchange_rates')
        .then(res => res.json())
        .then(data => setExchangeRates(data));
  }, []);

  const calculateTotalBalance = () => {
      // Don't calculate if exchange rates haven't loaded yet
      if (!exchangeRates) return 0;

      // Convert all to USD for display
      let totalUSD = 0;
      balances.forEach(b => {
          const rate = exchangeRates[b.currency] || 1;
          // If currency is USD, rate is 1. If EUR, rate is 0.92 (1 USD = 0.92 EUR) -> Amount in EUR / 0.92 = Amount in USD
          // Wait, rate usually means 1 Base = X Quote. If Base=USD, Quote=EUR (0.92).
          // Then EUR Amount / 0.92 = USD Amount.
          totalUSD += b.amount / rate;
      });
      return totalUSD;
  };

  const formatMoney = (amount: number, currency: string) => {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency }).format(amount / 100);
  };

  return (
    <div className="flex h-screen bg-gray-100 font-sans">
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
        w-64 bg-white shadow-md flex flex-col
        transform transition-transform duration-300 ease-in-out
        ${isSidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        <div className="p-6 border-b flex justify-between items-center">
          <h1 className="text-2xl font-bold text-teal-600">SplitClone</h1>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="lg:hidden text-gray-500 hover:text-gray-700"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <nav className="mt-6 flex-1 px-4 space-y-2 overflow-y-auto">
          <a href="/" className="flex items-center px-4 py-2 text-gray-700 bg-gray-100 rounded-md">
             <span className="font-medium">Dashboard</span>
          </a>

          <div className="pt-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Groups</h3>
             <ul className="space-y-1">
                {groups.map(group => (
                    <li
                        key={group.id}
                        className="text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 px-2 py-1 cursor-pointer rounded"
                        onClick={() => {
                          navigate(`/groups/${group.id}`);
                          setIsSidebarOpen(false);
                        }}
                    >
                        {group.name}
                    </li>
                ))}
             </ul>
             <form onSubmit={handleCreateGroup} className="mt-2">
                 <input
                    type="text"
                    placeholder="New Group"
                    className="w-full text-xs p-1 border rounded mb-1"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                 />
                 <select
                    value={newGroupCurrency}
                    onChange={(e) => setNewGroupCurrency(e.target.value)}
                    className="w-full text-xs p-1 border rounded"
                 >
                    {currencies.map(c => <option key={c} value={c}>{c}</option>)}
                 </select>
             </form>
          </div>

          <div className="pt-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Friends</h3>
             <ul className="space-y-1">
                {friends.map(friend => (
                    <li key={friend.id} className="text-sm text-gray-600 hover:text-gray-900 px-2 py-1 cursor-pointer">
                        {friend.full_name}
                    </li>
                ))}
             </ul>
             <form onSubmit={handleAddFriend} className="mt-2 flex">
                 <input
                    type="email"
                    placeholder="Add friend email"
                    className="w-full text-xs p-1 border rounded"
                    value={newFriendEmail}
                    onChange={(e) => setNewFriendEmail(e.target.value)}
                 />
             </form>
          </div>
        </nav>
        <div className="p-4 border-t">
            <div className="flex items-center mb-2">
                <span className="text-sm font-medium text-gray-700 truncate">{user?.full_name}</span>
            </div>
            <button onClick={logout} className="text-xs text-red-600 hover:text-red-800 font-medium">Logout</button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex justify-between items-center p-4 lg:p-6 bg-white shadow-sm">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setIsSidebarOpen(true)}
                className="lg:hidden text-gray-500 hover:text-gray-700"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              <h2 className="text-xl lg:text-2xl font-semibold text-gray-800">Dashboard</h2>
            </div>
            <div className="flex gap-2">
                <button
                  onClick={() => setIsExpenseModalOpen(true)}
                  className="bg-orange-500 text-white px-3 py-2 lg:px-4 rounded shadow hover:bg-orange-600 text-xs lg:text-sm font-medium whitespace-nowrap"
                >
                  <span className="hidden sm:inline">Add expense</span>
                  <span className="sm:hidden">+</span>
                </button>
                <button
                  onClick={() => setIsSettleUpModalOpen(true)}
                  className="bg-teal-500 text-white px-3 py-2 lg:px-4 rounded shadow hover:bg-teal-600 text-xs lg:text-sm font-medium whitespace-nowrap"
                >
                  <span className="hidden sm:inline">Settle up</span>
                  <span className="sm:hidden">$</span>
                </button>
            </div>
        </header>
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 p-4 lg:p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 lg:gap-6">
                <div className="bg-white p-4 lg:p-6 rounded shadow-sm">
                    <h3 className="text-base lg:text-lg font-medium text-gray-900 mb-2 lg:mb-4">Total Balance</h3>
                    <div className={`text-2xl lg:text-3xl font-bold ${calculateTotalBalance() >= 0 ? 'text-teal-500' : 'text-red-500'}`}>
                        {formatMoney(calculateTotalBalance(), 'USD')}
                    </div>
                </div>
                <div className="bg-white p-4 lg:p-6 rounded shadow-sm">
                    <h3 className="text-base lg:text-lg font-medium text-gray-900 mb-2 lg:mb-4">You owe</h3>
                     <ul className="space-y-2">
                         {balances.filter(b => b.amount < 0).length === 0 && <li className="text-gray-500 italic text-sm">No debts</li>}
                         {balances.filter(b => b.amount < 0).map(b => (
                             <li key={`${b.user_id}-${b.currency}`} className="text-red-500 flex justify-between text-sm">
                                 <span>{b.full_name}</span>
                                 <span>{formatMoney(Math.abs(b.amount), b.currency)}</span>
                             </li>
                         ))}
                     </ul>
                </div>
                <div className="bg-white p-4 lg:p-6 rounded shadow-sm md:col-span-2">
                     <h3 className="text-base lg:text-lg font-medium text-gray-900 mb-2 lg:mb-4">You are owed</h3>
                     <ul className="space-y-2">
                         {balances.filter(b => b.amount > 0).length === 0 && <li className="text-gray-500 italic text-sm">No one owes you</li>}
                         {balances.filter(b => b.amount > 0).map(b => (
                             <li key={`${b.user_id}-${b.currency}`} className="text-teal-500 flex justify-between text-sm">
                                 <span>{b.full_name}</span>
                                 <span>{formatMoney(b.amount, b.currency)}</span>
                             </li>
                         ))}
                     </ul>
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
    </div>
  );
};

const ProtectedRoute: React.FC<{ element: React.ReactElement }> = ({ element }) => {
  const { user, loading } = useAuth();

  if (loading) return <div>Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;

  return element;
};

function App() {
  return (
    <AuthProvider>
      <Router>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/" element={<ProtectedRoute element={<Dashboard />} />} />
          <Route path="/groups/:groupId" element={<ProtectedRoute element={<GroupDetailPage />} />} />
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
