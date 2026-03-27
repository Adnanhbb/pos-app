import React, { useEffect, useState } from "react";
import Dashboard from "./Dashboard";
import Login from "./Login";
import { LanguageProvider,useLang } from "./i18n/LanguageContext"; // make sure path is correct
import { settingsRepository } from "./repositories/settingsRepository";

type Role = "admin" | "saleboy";

export default function App() {
  const [user, setUser] = useState<{
    username: string;
    role: Role;
  } | null>(null);

  // AUTO LOGIN CHECK
  useEffect(() => {
    const id = localStorage.getItem("loggedInUserId");
    const role = localStorage.getItem("loggedInUserRole");
    const username = localStorage.getItem("loggedInUserName");

    if (id && role && username) {
      setUser({
        username: username,
        role: role as Role,
      });
    }
  }, []);

  const { lang, setLang } = useLang(); // get setter

  useEffect(() => {
  const handler = async () => {
    const settings = await settingsRepository.get();
    if (settings?.language) {
      // convert "eng"/"urd" to "en"/"ur"
      const langValue: "en" | "ur" =
        settings.language === "en" ? "en" : "ur";
      setLang(langValue);
    }
  };

  window.addEventListener("settingsUpdated", handler);
  return () => window.removeEventListener("settingsUpdated", handler);
}, []);

  const handleLogin = (username: string, role: Role) => {
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

  return (
    <LanguageProvider>
      <Dashboard user={user} onLogout={handleLogout} />
    </LanguageProvider>
  );
}