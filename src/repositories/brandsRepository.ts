// src/repositories/brandsRepository.ts
import {
  getBrands,
  addBrand,
  updateBrand,
  deleteBrand,
} from "../db";
import { entityApi } from "../api/entityApi";
import {
  canUseApi,
  getServerId,
  normalizeRemoteRecord,
  queueEntityCreate,
  queueEntityDelete,
  queueEntityUpdate,
} from "./helpers/syncRepositoryHelpers";
import type { Brand } from "../types/entities";
import type { SyncMetadata } from "../types/sync";

export type { Brand };

type SyncableBrand = Brand & SyncMetadata;

function normalizeRemoteBrand(remote: unknown, fallback: Partial<SyncableBrand>): SyncableBrand | null {
  return normalizeRemoteRecord<Brand>(remote, {
    itemCount: fallback.itemCount ?? 0,
    ...fallback,
  });
}

function getRemoteData(remoteRecord: unknown): Partial<SyncableBrand> | null {
  if (!remoteRecord || typeof remoteRecord !== "object") return null;

  const maybeWrapped = remoteRecord as {
    success?: boolean;
    data?: unknown;
  };

  if ("data" in maybeWrapped && maybeWrapped.data && typeof maybeWrapped.data === "object") {
    return maybeWrapped.data as Partial<SyncableBrand>;
  }

  return remoteRecord as Partial<SyncableBrand>;
}

async function queueBrandCreate(brand: SyncableBrand) {
  await queueEntityCreate("brands", brand);
}

async function queueBrandUpdate(brand: SyncableBrand) {
  await queueEntityUpdate("brands", brand);
}

async function queueBrandDelete(brand: Partial<SyncableBrand>) {
  await queueEntityDelete("brands", brand);
}

export const brandsRepository = {
  getAll: async (): Promise<Brand[]> => {
    return await getBrands();
  },

  getById: async (id: number): Promise<Brand | undefined> => {
    const all = await getBrands();
    return all.find(b => b.id === id);
  },

  create: async (brand: Omit<Brand, "id">): Promise<number> => {
    if (await canUseApi()) {
      try {
        const remote = await entityApi.create<SyncableBrand>("brands", brand);
        const remoteBrand = normalizeRemoteBrand(remote, brand);

        if (remoteBrand) {
          return await addBrand(remoteBrand as Omit<Brand, "id">);
        }

        return await addBrand(brand);
      } catch {
        // Fall through to local write + queue when the API is unavailable or rejects.
      }
    }

    const localId = await addBrand(brand);
    const localRecord: SyncableBrand = {
      ...brand,
      id: localId,
    };

    await queueBrandCreate(localRecord);
    return localId;
  },

  update: async (brand: Brand): Promise<void> => {
    const syncableBrand = brand as SyncableBrand;
    const serverId = getServerId(syncableBrand);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.update<SyncableBrand>("brands", serverId, syncableBrand);
        await updateBrand(brand);
        return;
      } catch {
        // Fall through to local update + queue when the API write fails.
      }
    }

    await updateBrand(brand);
    await queueBrandUpdate(syncableBrand);
  },

  remove: async (id: number): Promise<void> => {
    const brand = await brandsRepository.getById(id) as SyncableBrand | undefined;
    const serverId = brand ? getServerId(brand) : null;

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.remove("brands", serverId);
        await deleteBrand(id);
        return;
      } catch {
        // Fall through to local delete + queue when the API write fails.
      }
    }

    await deleteBrand(id);
    await queueBrandDelete(brand ?? { id });
  },

  applyRemoteMirror: async (
    localId: number | string,
    remoteRecord: unknown
  ): Promise<void> => {
    const remoteBrand = getRemoteData(remoteRecord);
    const serverId = remoteBrand
      ? remoteBrand.serverId ?? remoteBrand.id ?? null
      : null;

    if (serverId == null) {
      console.warn("Brands sync mirror skipped: no serverId returned.", {
        localId,
        remoteRecord,
      });
      return;
    }

    const brands = await getBrands();
    const localBrand = brands.find((brand) => String(brand.id) === String(localId));

    if (!localBrand) {
      console.warn("Brands sync mirror skipped: local brand not found.", {
        localId,
        serverId,
      });
      return;
    }

    const mirroredBrand: SyncableBrand = {
      ...(localBrand as SyncableBrand),
      serverId,
    };

    if (typeof remoteBrand?.name === "string") {
      mirroredBrand.name = remoteBrand.name;
    }

    if (typeof remoteBrand?.itemCount === "number") {
      mirroredBrand.itemCount = remoteBrand.itemCount;
    }

    await updateBrand(mirroredBrand);
    console.info("Brands sync mirror applied.", {
      localId,
      serverId,
    });
  },

  /* ---------- USAGE HELPERS ---------- */

  incrementItemCount: async (id: number): Promise<void> => {
    const brand = await brandsRepository.getById(id);
    if (!brand) return;

    await updateBrand({
      ...brand,
      itemCount: (brand.itemCount ?? 0) + 1,
    });
  },

  decrementItemCount: async (id: number): Promise<void> => {
    const brand = await brandsRepository.getById(id);
    if (!brand) return;

    await updateBrand({
      ...brand,
      itemCount: Math.max(0, (brand.itemCount ?? 0) - 1),
    });
  },
};
