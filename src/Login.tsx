// src/Login.tsx
import React, { useEffect, useState } from "react";
import { validateUser, getSettings, getUserByUsername } from "./db";
import { FaUser, FaLock } from "react-icons/fa";

interface LoginProps {
  onLogin: (name: string, role: "admin" | "saleboy") => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"admin" | "saleboy">("admin");
  const [error, setError] = useState("");
  const [rememberMe, setRememberMe] = useState(false);
  const [settings, setSettings] = useState<{ businessName: string; logo?: string } | null>(null);

  useEffect(() => {
    const r = localStorage.getItem("rememberedUser");
    if (r) setUsername(r);

    // Load settings from DB
    async function loadSettings() {
      const s = await getSettings();
      if (s) {
        setSettings({ businessName: s.businessName, logo: s.logo });
      }
    }
    loadSettings();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    try {
      const user = await validateUser(username.trim(), password);
      if (user) {
        // store logged-in ID
        localStorage.setItem("loggedInUserId", String(user.id));

        // pass display name and role to app state
        onLogin(user.Name, user.Role as "admin" | "saleboy");

        if (rememberMe) localStorage.setItem("rememberedUser", user.Username);
      } else {
        setError("Invalid username, password, or role.");
      }
    } catch (err) {
      console.error(err);
      setError("Login failed. Try again.");
    }
  };

  // Secure Forgot Password (Option A)
  const handleForgotPassword = async () => {
    if (!username.trim()) {
      alert("Enter your username first.");
      return;
    }

    const user = await getUserByUsername(username.trim());
    if (!user) {
      alert("This username does not exist.");
      return;
    }

    alert("Please contact the Administrator to reset your password.");
  };

  const labelStyle = { color: "#5C3A21", fontWeight: 600 } as const;

  return (
    <div className="flex items-center justify-center min-h-screen bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-500 p-4">
      <div className="bg-white p-8 rounded-3xl shadow-2xl w-full max-w-md relative overflow-hidden">
        <div className="flex justify-center mb-4">
          {settings?.logo ? (
            <img src={settings.logo} alt="Logo" className="w-20 h-20 object-contain" />
          ) : (
            <img src="src/images/logo.png" alt="Logo" className="w-20 h-20" />
          )}
        </div>

        <h2 className="text-2xl font-bold text-center mb-6" style={{ color: "#5C3A21" }}>
          {settings?.businessName || "JAWAD & BROTHERS"}
        </h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Role */}
          <div>
            <label className="block mb-1 text-sm uppercase" style={labelStyle}>
              Role
            </label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as "admin" | "saleboy")}
              className="w-full p-3 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="admin">Admin</option>
              <option value="saleboy">Saleboy</option>
            </select>
          </div>

          {/* Username */}
          <div>
            <label className="block mb-1 text-sm uppercase" style={labelStyle}>
              Username
            </label>
            <div className="flex items-center border border-gray-300 rounded-xl focus-within:ring-2 focus-within:ring-indigo-400">
              <span className="px-3 text-gray-400"><FaUser /></span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter your username"
                className="w-full p-3 rounded-r-xl focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label className="block mb-1 text-sm uppercase" style={labelStyle}>
              Password
            </label>
            <div className="flex items-center border border-gray-300 rounded-xl focus-within:ring-2 focus-within:ring-indigo-400">
              <span className="px-3 text-gray-400"><FaLock /></span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full p-3 rounded-r-xl focus:outline-none"
                required
              />
            </div>
          </div>

          {/* Remember Me + Forgot Password */}
          <div className="flex justify-between items-center text-sm text-gray-600">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={rememberMe}
                onChange={() => setRememberMe(!rememberMe)}
                className="form-checkbox h-4 w-4 text-indigo-600"
              />
              <span>Remember Me</span>
            </label>
            <button
              type="button"
              onClick={handleForgotPassword}
              className="text-indigo-600 hover:underline"
            >
              Forgot Password?
            </button>
          </div>

          {error && <p className="text-red-500 text-sm mt-1">{error}</p>}

          <button
            type="submit"
            className="w-full bg-indigo-600 text-white py-3 rounded-xl font-semibold hover:bg-indigo-700 transition-all duration-200"
          >
            Login
          </button>
        </form>
      </div>
    </div>
  );
}
