import { ApiError } from "../api/client";
import { entityApi } from "../api/entityApi";
import { transactionApi } from "../api/transactionApi";
import { brandsRepository } from "../repositories/brandsRepository";
import { categoriesRepository } from "../repositories/categoriesRepository";
import { customersRepository } from "../repositories/customerRepository";
import { discountRepository } from "../repositories/discountRepository";
import { expenseRepository } from "../repositories/expenseRepository";
import { heldRepository } from "../repositories/heldRepository";
import { settingsRepository } from "../repositories/settingsRepository";
import { syncQueueRepository } from "../repositories/syncQueueRepository";
import { staffRepository } from "../repositories/staffRepository";
import { suppliersRepository } from "../repositories/suppliersRepository";
import { taxRepository } from "../repositories/taxRepository";
import { unitRepository } from "../repositories/unitRepository";
import { connectivityService } from "./connectivityService";
import type { OfflineTransactionPayload, SyncQueueItem } from "../types/sync";

type SyncProcessError = {
  id: number | null;
  entity: SyncQueueItem["entity"];
  operation: SyncQueueItem["operation"];
  message: string;
  status?: number;
  authError?: boolean;
};

type SyncProcessResult = {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: SyncProcessError[];
};

function getErrorMessage(error: unknown) {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return error.status === 401
      ? "Authentication required. Sign in again before replaying pending sync."
      : "You do not have permission to sync this entity.";
  }

  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown sync error";
  }
}

function getErrorStatus(error: unknown) {
  return error instanceof ApiError ? error.status : undefined;
}

function isAuthError(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function getQueueItemId(item: SyncQueueItem) {
  if (item.id == null) {
    throw new Error("Sync queue item id is required.");
  }

  return item.id;
}

function getRecordId(item: SyncQueueItem) {
  const id = item.serverId ?? item.localId;

  if (id == null) {
    throw new Error(
      `Sync ${item.operation} for ${item.entity} requires serverId or localId.`
    );
  }

  return id;
}


async function applyRemoteMirrorResult(
  item: SyncQueueItem,
  response: unknown
): Promise<void> {
  if (item.operation !== "create" && item.operation !== "update") return;

  if (item.localId == null) {
    console.warn(`${item.entity} sync mirror skipped: queue item has no localId.`, item);
    return;
  }

  try {
    switch (item.entity) {
      case "units":
        await unitRepository.applyRemoteMirror(item.localId, response);
        return;
      case "taxes":
        await taxRepository.applyRemoteMirror(item.localId, response);
        return;
      case "discounts":
        await discountRepository.applyRemoteMirror(item.localId, response);
        return;
      case "brands":
        await brandsRepository.applyRemoteMirror(item.localId, response);
        return;
      case "categories":
        await categoriesRepository.applyRemoteMirror(item.localId, response);
        return;
      case "expenses":
        await expenseRepository.applyRemoteMirror(item.localId, response);
        return;
      case "customers":
        await customersRepository.applyRemoteMirror?.(item.localId, response);
        return;
      case "suppliers":
        await suppliersRepository.applyRemoteMirror?.(item.localId, response);
        return;
      case "users":
        await staffRepository.applyRemoteMirror(item.localId, response);
        return;
      case "settings":
        await settingsRepository.applyRemoteMirror(item.localId, response);
        return;
      case "held":
        await heldRepository.applyRemoteMirror(item.localId, response);
        return;
      default:
        return;
    }
  } catch (error) {
    console.warn(`${item.entity} sync mirror failed after remote sync success.`, {
      item,
      error,
    });
  }
}
function isOfflineTransactionPayload(
  payload: unknown
): payload is OfflineTransactionPayload {
  if (!payload || typeof payload !== "object") return false;

  const record = payload as Partial<OfflineTransactionPayload>;
  return (
    typeof record.clientTransactionId === "string" &&
    typeof record.createdAt === "number" &&
    (record.transactionType === "sale" ||
      record.transactionType === "return" ||
      record.transactionType === "invoice_delete" ||
      record.transactionType === "payment" ||
      record.transactionType === "stock_adjustment" ||
      record.transactionType === "cylinder_adjustment")
  );
}

export const syncEngine = {
  async canSync(): Promise<boolean> {
    return await connectivityService.isFullyOnline();
  },

  async processPending(limit = 25): Promise<SyncProcessResult> {
    if (!(await syncEngine.canSync())) {
      const pendingItems = await syncQueueRepository.getPending(limit);

      return {
        processed: 0,
        succeeded: 0,
        failed: 0,
        skipped: pendingItems.length,
        errors: pendingItems.map((item) => ({
          id: item.id ?? null,
          entity: item.entity,
          operation: item.operation,
          message: "Sync skipped because the API is not reachable.",
        })),
      };
    }

    const items = await syncQueueRepository.getPending(limit);
    const result: SyncProcessResult = {
      processed: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    for (const item of items) {
      result.processed += 1;

      try {
        const id = getQueueItemId(item);
        await syncQueueRepository.markProcessing(id);
        await syncEngine.processItem(item);
        await syncQueueRepository.markDone(id);
        result.succeeded += 1;
      } catch (error) {
        const message = getErrorMessage(error);

        if (item.id != null) {
          await syncQueueRepository.incrementRetry(item.id, message);
        }

        result.failed += 1;
        result.errors.push({
          id: item.id ?? null,
          entity: item.entity,
          operation: item.operation,
          message,
          status: getErrorStatus(error),
          authError: isAuthError(error),
        });
      }
    }

    return result;
  },

  async processItem(item: SyncQueueItem): Promise<void> {
    if (item.operation === "create") {
      const response = await entityApi.create(item.entity, item.payload);
      await applyRemoteMirrorResult(item, response);
      return;
    }

    if (item.operation === "update") {
      const response = await entityApi.update(item.entity, getRecordId(item), item.payload);
      await applyRemoteMirrorResult(item, response);
      return;
    }

    if (item.operation === "delete") {
      await entityApi.remove(item.entity, getRecordId(item));
      return;
    }

    if (item.operation === "transaction") {
      // POS transaction sync uses a dedicated atomic backend endpoint because
      // a sale/return/delete can touch invoices, stock, batches, accounting,
      // customer/supplier balances, payments, and cylinders.
      if (!isOfflineTransactionPayload(item.payload)) {
        throw new Error("Invalid offline transaction payload.");
      }

      await transactionApi.postTransaction(item.payload);
      return;
    }

    throw new Error(`Unsupported sync operation: ${item.operation}`);
  },
};

