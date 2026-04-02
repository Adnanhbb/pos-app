import React, { useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import Login from "./Login";
import {
  LanguageProvider,
  useLang,
} from "./i18n/LanguageContext";
import { settingsRepository } from "./repositories/settingsRepository";

/* ✅ Unified role type */
type Role = "admin" | "saleboy" | "Dev";

/* =====================================================
   LANGUAGE INITIALIZER (must live INSIDE provider)
===================================================== */
function AppContent({
  user,
  setUser,
}: {
  user: { username: string; role: Role } | null;
  setUser: React.Dispatch<
    React.SetStateAction<{ username: string; role: Role } | null>
  >;
}) {
  const { setLang } = useLang();

  /* Load language when settings change */
  useEffect(() => {
    const handler = async () => {
      const settings = await settingsRepository.get();

      if (settings?.language) {
        const langValue: "en" | "ur" =
          settings.language === "en" ? "en" : "ur";

        setLang(langValue);
      }
    };

    window.addEventListener("settingsUpdated", handler);
    handler(); // run once on mount

    return () =>
      window.removeEventListener("settingsUpdated", handler);
  }, [setLang]);

  /* LOGIN */
  const handleLogin = (username: string, role: Role) => {
    localStorage.setItem("loggedInUserName", username);
    localStorage.setItem("loggedInUserRole", role);

    setUser({ username, role });
  };

  /* LOGOUT */
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

/* =====================================================
   ROOT APP
===================================================== */
export default function App() {
  const [user, setUser] = useState<{
    username: string;
    role: Role;
  } | null>(null);

  /* AUTO LOGIN CHECK */
  useEffect(() => {
    const id = localStorage.getItem("loggedInUserId");
    const role = localStorage.getItem("loggedInUserRole");
    const username = localStorage.getItem("loggedInUserName");

    const validRoles: Role[] = ["admin", "saleboy", "Dev"];

    if (id && username && role && validRoles.includes(role as Role)) {
      setUser({
        username,
        role: role as Role,
      });
    }
  }, []);

  return (
    <LanguageProvider>
      <AppContent user={user} setUser={setUser} />
    </LanguageProvider>
  );
}