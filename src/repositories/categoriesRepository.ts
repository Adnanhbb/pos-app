// src/repositories/categoriesRepository.ts
import {
  getAllCategories,
  addCategory,
  updateCategory,
  deleteCategory,
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
import type { Category } from "../types/entities";
import type { SyncMetadata } from "../types/sync";

export type { Category };

type SyncableCategory = Category & SyncMetadata;

function normalizeRemoteCategory(
  remote: unknown,
  fallback: Partial<SyncableCategory>
): SyncableCategory | null {
  return normalizeRemoteRecord<Category>(remote, {
    itemCount: fallback.itemCount ?? 0,
    ...fallback,
  });
}

function getRemoteData(remoteRecord: unknown): Partial<SyncableCategory> | null {
  if (!remoteRecord || typeof remoteRecord !== "object") return null;

  const maybeWrapped = remoteRecord as {
    success?: boolean;
    data?: unknown;
  };

  if ("data" in maybeWrapped && maybeWrapped.data && typeof maybeWrapped.data === "object") {
    return maybeWrapped.data as Partial<SyncableCategory>;
  }

  return remoteRecord as Partial<SyncableCategory>;
}

async function queueCategoryCreate(category: SyncableCategory) {
  await queueEntityCreate("categories", category);
}

async function queueCategoryUpdate(category: SyncableCategory) {
  await queueEntityUpdate("categories", category);
}

async function queueCategoryDelete(category: Partial<SyncableCategory>) {
  await queueEntityDelete("categories", category);
}

export const categoriesRepository = {
  getAll: async (): Promise<Category[]> => {
    return await getAllCategories();
  },

  getById: async (id: number): Promise<Category | undefined> => {
    const all = await getAllCategories();
    return all.find(c => c.id === id);
  },

  create: async (category: Omit<Category, "id">): Promise<number> => {
    if (await canUseApi()) {
      try {
        const remote = await entityApi.create<SyncableCategory>("categories", category);
        const remoteCategory = normalizeRemoteCategory(remote, category);

        if (remoteCategory) {
          return await addCategory(remoteCategory as Omit<Category, "id">);
        }

        return await addCategory(category);
      } catch {
        // Fall through to local write + queue when the API is unavailable or rejects.
      }
    }

    const localId = await addCategory(category);
    const localRecord: SyncableCategory = {
      ...category,
      id: localId,
    };

    await queueCategoryCreate(localRecord);
    return localId;
  },

  update: async (category: Category): Promise<void> => {
    const syncableCategory = category as SyncableCategory;
    const serverId = getServerId(syncableCategory);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.update<SyncableCategory>("categories", serverId, syncableCategory);
        await updateCategory(category);
        return;
      } catch {
        // Fall through to local update + queue when the API write fails.
      }
    }

    await updateCategory(category);
    await queueCategoryUpdate(syncableCategory);
  },

  remove: async (id: number): Promise<void> => {
    const category = await categoriesRepository.getById(id) as SyncableCategory | undefined;
    const serverId = category ? getServerId(category) : null;

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.remove("categories", serverId);
        await deleteCategory(id);
        return;
      } catch {
        // Fall through to local delete + queue when the API write fails.
      }
    }

    await deleteCategory(id);
    await queueCategoryDelete(category ?? { id });
  },

  applyRemoteMirror: async (
    localId: number | string,
    remoteRecord: unknown
  ): Promise<void> => {
    const remoteCategory = getRemoteData(remoteRecord);
    const serverId = remoteCategory
      ? remoteCategory.serverId ?? remoteCategory.id ?? null
      : null;

    if (serverId == null) {
      console.warn("Categories sync mirror skipped: no serverId returned.", {
        localId,
        remoteRecord,
      });
      return;
    }

    const categories = await getAllCategories();
    const localCategory = categories.find((category) => String(category.id) === String(localId));

    if (!localCategory) {
      console.warn("Categories sync mirror skipped: local category not found.", {
        localId,
        serverId,
      });
      return;
    }

    const mirroredCategory: SyncableCategory = {
      ...(localCategory as SyncableCategory),
      serverId,
    };

    if (typeof remoteCategory?.name === "string") {
      mirroredCategory.name = remoteCategory.name;
    }

    if (typeof remoteCategory?.itemCount === "number") {
      mirroredCategory.itemCount = remoteCategory.itemCount;
    }

    await updateCategory(mirroredCategory);
    console.info("Categories sync mirror applied.", {
      localId,
      serverId,
    });
  },

  /* ---------- USAGE HELPERS ---------- */

  incrementItemCount: async (id: number): Promise<void> => {
    const cat = await categoriesRepository.getById(id);
    if (!cat) return;

    await updateCategory({
      ...cat,
      itemCount: (cat.itemCount ?? 0) + 1,
    });
  },

  decrementItemCount: async (id: number): Promise<void> => {
    const cat = await categoriesRepository.getById(id);
    if (!cat) return;

    await updateCategory({
      ...cat,
      itemCount: Math.max(0, (cat.itemCount ?? 0) - 1),
    });
  },
};
