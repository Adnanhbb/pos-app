import { useState } from 'react';
import Login from './Login';
import Dashboard from './Dashboard';

interface User {
  username: string;
  role: 'admin' | 'saleboy';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);

  // Called by Login component on successful login
  const handleLogin = (username: string, role: 'admin' | 'saleboy') => {
    setUser({ username, role }); // Redirect happens via conditional rendering
  };

  // Called by Dashboard component on logout
  const handleLogout = () => {
    setUser(null);
  };

  return (
    <>
      {!user ? (
        // Show login page if not logged in
        <Login onLogin={handleLogin} />
      ) : (
        // Show dashboard if logged in
        <Dashboard
          username={user.username}
          role={user.role}
          onLogout={handleLogout}
        />
      )}
    </>
  );
}
