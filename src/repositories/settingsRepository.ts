// src/repositories/settingsRepository.ts

import { getSettings, saveSettings, Settings } from "../db";

const DEFAULT_SETTINGS: Omit<Settings, "id"> = {
  businessName: "My Business",
  email: "",
  contact: "",
  address: "",
  printer: "pos",
  language: "eng",
  logo: "/images/logo.png", // fallback logo path
  cylBPrice: "",
  cylSPrice: "",
  cylDPrice: "",
  cylWPrice: "",
};

export const settingsRepository = {

  /* --------------------------------------------------
     GET SETTINGS (ensures defaults exist)
  -------------------------------------------------- */
  async get(): Promise<Settings> {
    let settings = await getSettings();

    if (!settings) {
      await saveSettings(DEFAULT_SETTINGS);
      settings = await getSettings();
    }

    return settings!;
  },


  /* --------------------------------------------------
     ✅ NEW — GET SETTINGS FOR INVOICE/PRINTING
     (maps DB fields → invoice fields)
  -------------------------------------------------- */
  async getPrintSettings() {
    const s = await settingsRepository.get();

    return {
      businessName: s.businessName || "",
      address: s.address || "",
      phone: s.contact || "",   // 🔥 mapping fix
      logo: s.logo || "",
      printer: s.printer || "pos",
      language: s.language || "eng",
    };
  },


  /* --------------------------------------------------
     SAVE / UPDATE SETTINGS
  -------------------------------------------------- */
  async set(newSettings: Partial<Omit<Settings, "id">>) {
    const current = await settingsRepository.get();

    const updated: Settings = {
      ...current,
      ...newSettings,
    };

    await saveSettings(updated);
  },


  /* --------------------------------------------------
     RESET DEFAULTS
  -------------------------------------------------- */
  async reset() {
    await saveSettings(DEFAULT_SETTINGS);
  },
};