import {
  getAllExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  searchExpenses,
  getAllExpCategories,
  addExpCategory,
} from "../db";
import type { Expense } from "../types/entities";
import type { SyncMetadata } from "../types/sync";
import { entityApi } from "../api/entityApi";
import {
  canUseApi,
  getServerId,
  normalizeRemoteRecord,
  prepareRemoteRecordForLocalInsert,
  queueEntityOperation,
  queueEntityCreate,
  queueEntityDelete,
  queueEntityUpdate,
} from "./helpers/syncRepositoryHelpers";

export type { Expense };

type SyncableExpense = Expense & SyncMetadata;

function normalizeRemoteExpense(
  remote: unknown,
  fallback: Partial<SyncableExpense>
): SyncableExpense | null {
  return normalizeRemoteRecord<Expense & { name: string }>(
    remote,
    {
      ...fallback,
      name: fallback.category ?? "",
    },
    (record) => Boolean(record.date && record.category && record.amount != null)
  );
}


function getRemoteData(remoteRecord: unknown): Partial<SyncableExpense> & {
  is_deleted?: boolean | number;
  deleted_at?: string | number | null;
} | null {
  if (!remoteRecord || typeof remoteRecord !== "object") return null;

  const maybeWrapped = remoteRecord as {
    success?: boolean;
    data?: unknown;
  };

  if ("data" in maybeWrapped && maybeWrapped.data && typeof maybeWrapped.data === "object") {
    return maybeWrapped.data as Partial<SyncableExpense> & {
      is_deleted?: boolean | number;
      deleted_at?: string | number | null;
    };
  }

  return remoteRecord as Partial<SyncableExpense> & {
    is_deleted?: boolean | number;
    deleted_at?: string | number | null;
  };
}

function normalizeDeletedAt(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }

  return undefined;
}

async function queueExpenseCreate(expense: SyncableExpense) {
  await queueEntityCreate("expenses", expense);
}

async function queueExpenseUpdate(expense: SyncableExpense) {
  await queueEntityUpdate("expenses", expense);
}

async function queueExpenseDelete(expense: Partial<SyncableExpense>) {
  await queueEntityDelete("expenses", expense);
}

export const expenseRepository = {

  /* =====================================================
     BASIC CRUD
  ===================================================== */

  /** Get non-deleted expenses */
  getAll: async (): Promise<Expense[]> => {
    const all = await getAllExpenses();
    return all.filter(e => !e.isDeleted);
  },

  /** Get deleted expenses (for modal) */
  getDeleted: async (): Promise<Expense[]> => {
    const all = await getAllExpenses();
    return all.filter(e => e.isDeleted);
  },

  getById: async (id: number): Promise<Expense | undefined> => {
    const all = await getAllExpenses();
    return all.find(e => e.id === id);
  },

  create: async (expense: Omit<Expense, "id">): Promise<number> => {
    const exp: Omit<Expense, "id"> = {
      ...expense,
      isDeleted: false,
      deletedAt: null,
    };

    if (await canUseApi()) {
      try {
        const remote = await entityApi.create<SyncableExpense>("expenses", exp);
        const remoteExpense = normalizeRemoteExpense(remote, exp);

        if (remoteExpense) {
          return await addExpense(prepareRemoteRecordForLocalInsert(remoteExpense) as Omit<Expense, "id">);
        }

        return await addExpense(exp);
      } catch {
        // Fall through to local write + queue when the API is unavailable or rejects.
      }
    }

    const localId = await addExpense(exp);
    const created = (await expenseRepository.getById(localId)) as SyncableExpense | undefined;

    await queueExpenseCreate(created ?? { ...exp, id: localId });
    return localId;
  },

  update: async (expense: Expense): Promise<void> => {
    const syncableExpense = expense as SyncableExpense;
    const serverId = getServerId(syncableExpense);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.update<SyncableExpense>("expenses", serverId, syncableExpense);
        await updateExpense(expense);
        return;
      } catch {
        // Fall through to local update + queue when the API write fails.
      }
    }

    await updateExpense(expense);
    await queueExpenseUpdate(syncableExpense);
  },

  /** SOFT DELETE */
  remove: async (id: number): Promise<void> => {
    const all = await getAllExpenses();
    const exp = all.find(e => e.id === id);
    if (!exp) throw new Error("Expense not found");

    const deletedExpense: SyncableExpense = {
      ...exp,
      isDeleted: true,
      deletedAt: Date.now(),
    } as SyncableExpense;

    const serverId = getServerId(deletedExpense);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.remove("expenses", serverId);
        await updateExpense(deletedExpense);
        return;
      } catch {
        // Fall through to local soft delete + queue when the API write fails.
      }
    }

    await updateExpense(deletedExpense);
    await queueExpenseDelete(deletedExpense);
  },

  /** RESTORE */
  restore: async (id: number): Promise<void> => {
    const all = await getAllExpenses();
    const exp = all.find(e => e.id === id);
    if (!exp) throw new Error("Expense not found");

    const restoredExpense: Expense = {
      ...exp,
      isDeleted: false,
      deletedAt: null,
    };
    const syncableExpense = restoredExpense as SyncableExpense;
    const serverId = getServerId(syncableExpense);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.restore("expenses", serverId);
        await updateExpense(restoredExpense);
        return;
      } catch {
        // Fall through to local restore + queue when the API write fails.
      }
    }

    await updateExpense(restoredExpense);
    await queueEntityOperation("expenses", "update", {
      ...syncableExpense,
      _syncAction: "restore",
    } as any);
  },

  /** PERMANENT DELETE */
  permanentDelete: async (id: number): Promise<void> => {
    const expense = (await expenseRepository.getById(id)) as SyncableExpense | undefined;
    const serverId = expense ? getServerId(expense) : null;

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.permanentRemove("expenses", serverId);
        await deleteExpense(id);
        return;
      } catch {
        // Fall through to local hard delete + queue when the API write fails.
      }
    }

    await deleteExpense(id);
    await queueEntityOperation("expenses", "delete", {
      ...(expense ?? { id }),
      _syncAction: "permanentDelete",
    } as any);
  },


  applyRemoteMirror: async (
    localId: number | string,
    remoteRecord: unknown
  ): Promise<void> => {
    const remoteExpense = getRemoteData(remoteRecord);
    const serverId = remoteExpense
      ? remoteExpense.serverId ?? remoteExpense.id ?? null
      : null;

    if (serverId == null) {
      console.warn("Expenses sync mirror skipped: no serverId returned.", {
        localId,
        remoteRecord,
      });
      return;
    }

    const expenses = await getAllExpenses();
    const localExpense = expenses.find((expense) => String(expense.id) === String(localId));

    if (!localExpense) {
      console.warn("Expenses sync mirror skipped: local expense not found.", {
        localId,
        serverId,
      });
      return;
    }

    const mirroredExpense: SyncableExpense = {
      ...(localExpense as SyncableExpense),
      serverId,
    };

    if (typeof remoteExpense?.date === "string") {
      mirroredExpense.date = remoteExpense.date;
    }

    if (typeof remoteExpense?.category === "string") {
      mirroredExpense.category = remoteExpense.category;
    }

    if (remoteExpense?.amount != null) {
      mirroredExpense.amount = Number(remoteExpense.amount);
    }

    if ("description" in (remoteExpense ?? {})) {
      mirroredExpense.description = remoteExpense?.description;
    }

    if (typeof remoteExpense?.isDeleted === "boolean") {
      mirroredExpense.isDeleted = remoteExpense.isDeleted;
    } else if (remoteExpense?.is_deleted != null) {
      mirroredExpense.isDeleted = Boolean(remoteExpense.is_deleted);
    }

    const deletedAt = normalizeDeletedAt(
      remoteExpense?.deletedAt ?? remoteExpense?.deleted_at
    );
    if (deletedAt !== undefined) {
      mirroredExpense.deletedAt = deletedAt;
    }

    await updateExpense(mirroredExpense);
    console.info("Expenses sync mirror applied.", {
      localId,
      serverId,
    });
  },

  /* =====================================================
     SEARCH
  ===================================================== */

  search: async (query: string): Promise<Expense[]> => {
    if (!query.trim()) return await expenseRepository.getAll();

    const results = await searchExpenses(query);
    return results.filter(e => !e.isDeleted);
  },

  /* =====================================================
     DATE FILTERING
  ===================================================== */

  getByDateRange: async (start: string, end: string) => {
    const all = await expenseRepository.getAll();

    return all.filter(
      e => e.date >= start && e.date <= end
    );
  },

  getTotalByDateRange: async (start: string, end: string) => {
    const filtered = await expenseRepository.getByDateRange(start, end);

    return filtered.reduce((sum, e) => sum + e.amount, 0);
  },

  /* =====================================================
     CATEGORIES
  ===================================================== */

  getCategories: async (): Promise<string[]> => {
    const cats = await getAllExpCategories();
    return cats.map(c => c.category);
  },

  addCategory: async (category: string): Promise<number> => {
    return await addExpCategory(category);
  },
};
