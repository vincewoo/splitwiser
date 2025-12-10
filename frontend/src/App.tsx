import React, { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './Login';
import Register from './Register';
import AddExpenseModal from './AddExpenseModal';
import SettleUpModal from './SettleUpModal';
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
}

interface Balance {
  user_id: number;
  amount: number;
  currency: string;
}

const Dashboard = () => {
  const { user, logout } = useAuth();
  const [friends, setFriends] = useState<Friend[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [balances, setBalances] = useState<Balance[]>([]);
  const [newFriendEmail, setNewFriendEmail] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [isSettleUpModalOpen, setIsSettleUpModalOpen] = useState(false);

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
        body: JSON.stringify({ name: newGroupName })
    });
    if (response.ok) {
        setNewGroupName('');
        fetchGroups();
    } else {
        alert('Failed to create group');
    }
  };

  const onExpenseAdded = () => {
      fetchBalances();
  };

  const [exchangeRates, setExchangeRates] = useState<Record<string, number>>({ USD: 1 });

  useEffect(() => {
      fetch('http://localhost:8000/exchange_rates')
        .then(res => res.json())
        .then(data => setExchangeRates(data));
  }, []);

  const calculateTotalBalance = () => {
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
      <div className="w-64 bg-white shadow-md flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-2xl font-bold text-teal-600">SplitClone</h1>
        </div>
        <nav className="mt-6 flex-1 px-4 space-y-2">
          <a href="/" className="flex items-center px-4 py-2 text-gray-700 bg-gray-100 rounded-md">
             <span className="font-medium">Dashboard</span>
          </a>

          <div className="pt-4">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Groups</h3>
             <ul className="space-y-1">
                {groups.map(group => (
                    <li key={group.id} className="text-sm text-gray-600 hover:text-gray-900 px-2 py-1 cursor-pointer">
                        {group.name}
                    </li>
                ))}
             </ul>
             <form onSubmit={handleCreateGroup} className="mt-2 flex">
                 <input
                    type="text"
                    placeholder="New Group"
                    className="w-full text-xs p-1 border rounded"
                    value={newGroupName}
                    onChange={(e) => setNewGroupName(e.target.value)}
                 />
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

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="flex justify-between items-center p-6 bg-white shadow-sm">
            <h2 className="text-2xl font-semibold text-gray-800">Dashboard</h2>
            <div className="flex space-x-4">
                <button onClick={() => setIsExpenseModalOpen(true)} className="bg-orange-500 text-white px-4 py-2 rounded shadow hover:bg-orange-600 text-sm font-medium">Add an expense</button>
                <button onClick={() => setIsSettleUpModalOpen(true)} className="bg-teal-500 text-white px-4 py-2 rounded shadow hover:bg-teal-600 text-sm font-medium">Settle up</button>
            </div>
        </header>
        <main className="flex-1 overflow-x-hidden overflow-y-auto bg-gray-50 p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded shadow-sm">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Total Balance</h3>
                    <div className={`text-3xl font-bold ${calculateTotalBalance() >= 0 ? 'text-teal-500' : 'text-red-500'}`}>
                        {formatMoney(calculateTotalBalance(), 'USD')}
                    </div>
                </div>
                <div className="bg-white p-6 rounded shadow-sm">
                    <h3 className="text-lg font-medium text-gray-900 mb-4">You owe</h3>
                     <ul className="space-y-2">
                         {balances.filter(b => b.amount < 0).length === 0 && <li className="text-gray-500 italic">No debts</li>}
                         {balances.filter(b => b.amount < 0).map(b => (
                             <li key={b.user_id} className="text-red-500 flex justify-between">
                                 <span>User {b.user_id}</span>
                                 <span>{formatMoney(Math.abs(b.amount), b.currency)}</span>
                             </li>
                         ))}
                     </ul>
                </div>
                <div className="bg-white p-6 rounded shadow-sm">
                     <h3 className="text-lg font-medium text-gray-900 mb-4">You are owed</h3>
                     <ul className="space-y-2">
                         {balances.filter(b => b.amount > 0).length === 0 && <li className="text-gray-500 italic">No one owes you</li>}
                         {balances.filter(b => b.amount > 0).map(b => (
                             <li key={b.user_id} className="text-teal-500 flex justify-between">
                                 <span>User {b.user_id}</span>
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
        </Routes>
      </Router>
    </AuthProvider>
  );
}

export default App;
