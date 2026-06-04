import { initDB } from "../db";
import { summarizeSyncQueueIssues } from "../services/syncQueueIssueReview";
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

  async getStatusSummary(): Promise<{
    total: number;
    pending: number;
    processing: number;
    failed: number;
    done: number;
    archived: number;
  }> {
    const db = await initDB();
    const [all, pending, processing, failed, done, archived] = await Promise.all([
      db.getAll("sync_queue"),
      db.getAllFromIndex("sync_queue", "by-status", "pending"),
      db.getAllFromIndex("sync_queue", "by-status", "processing"),
      db.getAllFromIndex("sync_queue", "by-status", "failed"),
      db.getAllFromIndex("sync_queue", "by-status", "done"),
      db.getAllFromIndex("sync_queue", "by-status", "archived"),
    ]);

    return {
      total: all.length,
      pending: pending.length,
      processing: processing.length,
      failed: failed.length,
      done: done.length,
      archived: archived.length,
    };
  },

  async getIssueSummary() {
    const failed = await syncQueueRepository.getFailed();
    return summarizeSyncQueueIssues(failed);
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

  async archiveFailed(ids: number[], reason = "Reviewed and archived from Sync Status."): Promise<{
    requested: number;
    archived: number;
    skipped: Array<{ id: number; reason: string }>;
  }> {
    const uniqueIds = Array.from(new Set(ids.filter(id => Number.isInteger(id) && id > 0)));
    const skipped: Array<{ id: number; reason: string }> = [];
    let archived = 0;

    for (const id of uniqueIds) {
      const item = await getById(id);
      if (!item) {
        skipped.push({ id, reason: "not_found" });
        continue;
      }

      if (item.status !== "failed") {
        skipped.push({ id, reason: "not_failed" });
        continue;
      }

      await updateQueueItem({
        ...item,
        status: "archived",
        archivedAt: Date.now(),
        archivedReason: reason,
        archivedFromStatus: item.status,
      });
      archived += 1;
    }

    return {
      requested: uniqueIds.length,
      archived,
      skipped,
    };
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
