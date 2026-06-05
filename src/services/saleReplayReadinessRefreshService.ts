import { initDB } from "../db";
import { buildFinalizedSaleReplayContract } from "./posTransactionPayloadBuilder";
import type { OfflineTransactionPayload } from "../types/sync";

function serverIdOf(record: unknown): number | string | null {
  if (!record || typeof record !== "object") return null;
  const serverId = (record as { serverId?: number | string | null }).serverId;
  return serverId ?? null;
}

export const saleReplayReadinessRefreshService = {
  async refreshFailed(queueId: number) {
    const db = await initDB();
    const queueRow = await db.get("sync_queue", queueId);
    if (!queueRow || queueRow.status !== "failed") {
      throw new Error("Only failed queue rows may have replay readiness refreshed.");
    }

    const payload = queueRow.payload as OfflineTransactionPayload;
    const existing = payload.payload?.finalizedSaleReplay;
    if (
      payload.transactionType !== "sale" ||
      existing?.payloadVersion !== 1 ||
      existing?.transactionType !== "Sale"
    ) {
      throw new Error("Queue row is not a finalizedSaleReplay v1 Sale.");
    }

    const customer = existing.customer?.localId != null
      ? await db.get("customers", Number(existing.customer.localId))
      : null;
    const items = await Promise.all(
      existing.items.map(async (entry: any) => {
        const localItem = await db.get("items", Number(entry.localItemId));
        const localBatch = entry.resolvedBatch?.localBatchId != null
          ? await db.get(
              "item_batches",
              Number(entry.resolvedBatch.localBatchId)
            )
          : null;
        return {
          ...entry,
          serverItemId: serverIdOf(localItem),
          resolvedBatch: entry.resolvedBatch
            ? {
                ...entry.resolvedBatch,
                serverBatchId: serverIdOf(localBatch),
              }
            : null,
        };
      })
    );
    const cylinders = await Promise.all(
      existing.cylinders.map(async (entry: any) => {
        const localCylinder = entry.localCylinderId != null
          ? await db.get("cylinders", Number(entry.localCylinderId))
          : null;
        return {
          ...entry,
          serverCylinderId: serverIdOf(localCylinder),
        };
      })
    );

    const refreshed = buildFinalizedSaleReplayContract({
      ...existing,
      clientTransactionId: payload.clientTransactionId,
      createdAt: payload.createdAt,
      customer: existing.customer
        ? {
            ...existing.customer,
            serverId: serverIdOf(customer),
          }
        : null,
      items,
      cylinders,
    });

    await db.put("sync_queue", {
      ...queueRow,
      payload: {
        ...payload,
        replayReadiness: refreshed.replayReadiness,
        payload: {
          ...payload.payload,
          finalizedSaleReplay: refreshed,
        },
      },
      replayReadiness: refreshed.replayReadiness,
      updatedAt: Date.now(),
    });

    return refreshed.replayReadiness;
  },

  async prepareFailedForManualReplay(queueId: number) {
    const readiness = await saleReplayReadinessRefreshService.refreshFailed(
      queueId
    );
    if (readiness.status !== "ready" || readiness.reasons.length !== 0) {
      return {
        prepared: false,
        readiness,
      };
    }

    const db = await initDB();
    const queueRow = await db.get("sync_queue", queueId);
    if (!queueRow || queueRow.status !== "failed") {
      throw new Error("Failed queue row changed before manual preparation.");
    }
    await db.put("sync_queue", {
      ...queueRow,
      status: "pending",
      lastError: null,
      updatedAt: Date.now(),
    });

    return {
      prepared: true,
      readiness,
    };
  },
};
