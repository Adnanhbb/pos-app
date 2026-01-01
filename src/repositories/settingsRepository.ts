// src/repositories/settingsRepository.ts
import { getSettings, saveSettings, Settings } from "../db";

const DEFAULT_SETTINGS: Omit<Settings, "id"> = {
  businessName: "My Business",
  email: "",
  contact: "",
  address: "",
  logo: "/images/logo.png", // fallback logo path
};

export const settingsRepository = {
  /** Get settings; ensures defaults exist */
  async get(): Promise<Settings> {
    let settings = await getSettings();
    if (!settings) {
      // initialize default settings in DB
      await saveSettings(DEFAULT_SETTINGS);
      settings = await getSettings();
    }
    return settings!;
  },

  /** Save/update settings */
  async set(newSettings: Partial<Omit<Settings, "id">>) {
    const current = await settingsRepository.get();
    const updated: Settings = { ...current, ...newSettings };
    await saveSettings(updated);
  },

  /** Reset settings to defaults */
  async reset() {
    await saveSettings(DEFAULT_SETTINGS);
  },
};
