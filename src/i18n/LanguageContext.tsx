import React, { createContext, useContext, useEffect, useState } from "react";
import { translations, Lang } from "./translations";

type LangContextType = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
};

const LanguageContext = createContext<LangContextType | null>(null);

export const LanguageProvider = ({ children }: { children: React.ReactNode }) => {

  const [lang, setLangState] = useState<Lang>("en");

  // ✅ Load language once on app start
  useEffect(() => {
    const saved = localStorage.getItem("app_lang") as Lang | null;
    if (saved && (saved === "en" || saved === "ur")) {
      setLangState(saved);
    }
  }, []);

  // ✅ Apply RTL/LTR automatically
  useEffect(() => {
    document.documentElement.dir = lang === "ur" ? "rtl" : "ltr";
  }, [lang]);

  // ✅ SINGLE language setter (global authority)
  const setLang = (l: Lang) => {
    if (l !== "en" && l !== "ur") return;

    localStorage.setItem("app_lang", l);
    setLangState(l);

    // ⭐ notify whole app if someone listens
    window.dispatchEvent(new Event("languageChanged"));
  };

  // ✅ safe translator
  const t = (key: string): string => {
    return translations[lang]?.[key] ?? key;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLang = () => {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("LanguageProvider missing");
  return ctx;
};