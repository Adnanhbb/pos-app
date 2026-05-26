import { initDB } from "../db";
import type { SyncQueueItem } from "../types/sync";

type SyncQueueAddInput =
  Omit<SyncQueueItem, "id" | "createdAt" | "updatedAt" | "retryCount" | "status"> &
  Partial<Pick<SyncQueueItem, "createdAt" | "updatedAt" | "retryCount" | "status">>;

function sortOldestFirst(items: SyncQueueItem[]) {
  return items.sort((a, b) => a.createdAt - b.createdAt);
}

function limitItems(items: SyncQueueItem[], limit?: number) {
  return typeof limit === "number" ? items.slice(0, limit) : items;
}

async function getById(id: number) {
  const db = await initDB();
  return await db.get("sync_queue", id);
}

async function updateQueueItem(item: SyncQueueItem) {
  const db = await initDB();
  await db.put("sync_queue", {
    ...item,
    updatedAt: Date.now(),
  });
}

export const syncQueueRepository = {
  async add(item: SyncQueueAddInput): Promise<number> {
    const db = await initDB();
    const now = Date.now();

    return await db.add("sync_queue", {
      ...item,
      createdAt: item.createdAt ?? now,
      updatedAt: item.updatedAt ?? now,
      retryCount: item.retryCount ?? 0,
      status: item.status ?? "pending",
    });
  },

  async getPending(limit?: number): Promise<SyncQueueItem[]> {
    const db = await initDB();
    const items = await db.getAllFromIndex("sync_queue", "by-status", "pending");
    return limitItems(sortOldestFirst(items), limit);
  },

  async getFailed(limit?: number): Promise<SyncQueueItem[]> {
    const db = await initDB();
    const items = await db.getAllFromIndex("sync_queue", "by-status", "failed");
    return limitItems(sortOldestFirst(items), limit);
  },

  async markProcessing(id: number): Promise<void> {
    const item = await getById(id);
    if (!item) return;
    await updateQueueItem({ ...item, status: "processing" });
  },

  async markDone(id: number): Promise<void> {
    const item = await getById(id);
    if (!item) return;
    await updateQueueItem({ ...item, status: "done", lastError: null });
  },

  async markFailed(id: number, error: string): Promise<void> {
    const item = await getById(id);
    if (!item) return;
    await updateQueueItem({ ...item, status: "failed", lastError: error });
  },

  async incrementRetry(id: number, error?: string): Promise<void> {
    const item = await getById(id);
    if (!item) return;

    await updateQueueItem({
      ...item,
      retryCount: item.retryCount + 1,
      lastError: error ?? item.lastError ?? null,
    });
  },

  async remove(id: number): Promise<void> {
    const db = await initDB();
    await db.delete("sync_queue", id);
  },

  async clearDone(): Promise<void> {
    const db = await initDB();
    const doneItems = await db.getAllFromIndex("sync_queue", "by-status", "done");

    const tx = db.transaction("sync_queue", "readwrite");
    await Promise.all(
      doneItems
        .filter((item) => item.id != null)
        .map((item) => tx.store.delete(item.id!))
    );
    await tx.done;
  },
};
