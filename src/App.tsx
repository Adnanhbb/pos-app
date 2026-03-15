import React, { useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import Login from "./Login";

type Role = "admin" | "saleboy";

export default function App() {
  type Role = "admin" | "saleboy";

  const [user, setUser] = useState<{
    username: string;
    role: Role;
  } | null>(null);

  // AUTO LOGIN CHECK (important)
  useEffect(() => {
  const id = localStorage.getItem("loggedInUserId");
  const role = localStorage.getItem("loggedInUserRole");
  const username = localStorage.getItem("loggedInUserName");

  if (id && role && username) {
    setUser({
      username: username,
      role: role as Role
    });
  }
}, []);

  const handleLogin = (username: string, role: Role) => {
    // persist session
    localStorage.setItem("loggedInUserName", username);
    localStorage.setItem("loggedInUserRole", role);

    setUser({ username, role });
  };

  const handleLogout = () => {
    localStorage.removeItem("loggedInUserId");
    localStorage.removeItem("loggedInUserName");
    localStorage.removeItem("loggedInUserRole");

    setUser(null);
  };

  // 🔐 AUTH GATE
  if (!user) {
    return <Login onLogin={handleLogin} />;
  }

  return <Dashboard user={user} onLogout={handleLogout} />;
}