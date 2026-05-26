// src/repositories/settingsRepository.ts

import { getSettings, initDB, saveSettings } from "../db";
import type { Settings } from "../types/entities";
import type { SyncMetadata } from "../types/sync";
import { entityApi } from "../api/entityApi";
import {
  canUseApi,
  getServerId,
  queueEntityOperation,
} from "./helpers/syncRepositoryHelpers";

const DEFAULT_SETTINGS: Omit<Settings, "id"> = {
  businessName: "My Business",
  email: "",
  contact: "",
  address: "",
  printer: "pos",
  language: "en",
  logo: "/images/logo.png", // fallback logo path
  cylBPrice: "",
  cylSPrice: "",
  cylDPrice: "",
  cylWPrice: "",
};

type SyncableSettings = Settings & SyncMetadata;

type RemoteSettingsResponse = Partial<SyncableSettings> & {
  data?: unknown;
  id?: number | string;
  client_id?: number | string | null;
};

const SETTINGS_MIRROR_FIELDS = [
  "businessName",
  "email",
  "contact",
  "address",
  "logo",
  "cylBPrice",
  "cylSPrice",
  "cylDPrice",
  "cylWPrice",
  "printer",
  "language",
] as const;

function getRemoteSettingsData(remoteRecord: unknown): RemoteSettingsResponse | null {
  if (!remoteRecord || typeof remoteRecord !== "object") return null;

  const response = remoteRecord as RemoteSettingsResponse;
  if (response.data && typeof response.data === "object") {
    return response.data as RemoteSettingsResponse;
  }

  return response;
}

function getSettingsRemoteId(settings: Partial<SyncableSettings>) {
  return getServerId(settings) ?? settings.id ?? "default";
}

async function saveSettingsWithSync(settings: Omit<Settings, "id"> | Settings) {
  const syncableSettings = settings as SyncableSettings;
  const remoteId = getSettingsRemoteId(syncableSettings);

  if (await canUseApi()) {
    try {
      await entityApi.update("settings", remoteId, syncableSettings);
      await saveSettings(settings);
      return;
    } catch {
      // Fall through to local save + queue when the API is unavailable or rejects.
    }
  }

  await saveSettings(settings);
  await queueEntityOperation("settings", "update", syncableSettings);
}

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

  async getRaw(): Promise<Settings | null> {
    return await getSettings();
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

    await saveSettingsWithSync(updated);
  },

  async save(settings: Omit<Settings, "id"> | Settings) {
    await saveSettingsWithSync(settings);
  },



  async applyRemoteMirror(
    localId: number | string,
    remoteRecord: unknown
  ): Promise<void> {
    const remoteSettings = getRemoteSettingsData(remoteRecord);
    const serverId = remoteSettings
      ? remoteSettings.serverId ?? remoteSettings.id ?? null
      : null;

    if (serverId == null) {
      console.warn("Settings sync mirror skipped: no serverId returned.", {
        localId,
        remoteRecord,
      });
      return;
    }

    const numericLocalId = Number(localId);
    const db = await initDB();
    const localSettings = Number.isNaN(numericLocalId)
      ? undefined
      : await db.get("settings", numericLocalId);

    if (!localSettings) {
      console.warn("Settings sync mirror skipped: local settings row not found.", {
        localId,
        serverId,
      });
      return;
    }

    const mirroredSettings: SyncableSettings = {
      ...(localSettings as SyncableSettings),
      serverId,
    };

    for (const field of SETTINGS_MIRROR_FIELDS) {
      const value = remoteSettings?.[field];
      if (typeof value === "string") {
        (mirroredSettings as unknown as Record<string, unknown>)[field] = value;
      }
    }

    await db.put("settings", mirroredSettings);
    console.info("Settings sync mirror applied.", {
      localId,
      serverId,
    });
  },

  /* --------------------------------------------------
     RESET DEFAULTS
  -------------------------------------------------- */
  async reset() {
    await saveSettingsWithSync(DEFAULT_SETTINGS);
  },
};
