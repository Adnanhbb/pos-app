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

function isFinalizedSalePayload(payload: OfflineTransactionPayload) {
  const sale = payload.payload?.sale;

  return (
    payload.transactionType === "sale" &&
    sale?.transactionType === "Sale" &&
    sale?.isPostponed !== true
  );
}

function isFinalizedPurchasePayload(payload: OfflineTransactionPayload) {
  const sale = payload.payload?.sale;

  return (
    payload.transactionType === "sale" &&
    sale?.transactionType === "Purchase" &&
    sale?.isPostponed !== true
  );
}

function isFinalizedCustomerReturnPayload(payload: OfflineTransactionPayload) {
  const sale = payload.payload?.sale;

  return (
    payload.transactionType === "return" &&
    payload.payload?.returnMode === "customer" &&
    sale?.transactionType === "Return" &&
    sale?.isPostponed !== true
  );
}

function assertReadyFinalizedSaleReplay(payload: OfflineTransactionPayload) {
  const contract = payload.payload?.finalizedSaleReplay;

  if (
    payload.transactionType !== "sale" ||
    payload.replayReadiness?.payloadVersion !== 1 ||
    payload.replayReadiness.status !== "ready" ||
    payload.replayReadiness.reasons.length !== 0 ||
    contract?.payloadVersion !== 1 ||
    contract?.transactionType !== "Sale" ||
    contract?.replayReadiness?.status !== "ready"
  ) {
    throw new Error(
      "Finalized Sale replay is blocked because its backend mappings are not replay-ready."
    );
  }
}

function assertReadyFinalizedPurchaseReplay(payload: OfflineTransactionPayload) {
  const contract = payload.payload?.finalizedPurchaseReplay;

  if (
    payload.transactionType !== "sale" ||
    payload.replayReadiness?.scope !== "finalized_purchase" ||
    payload.replayReadiness?.payloadVersion !== 1 ||
    payload.replayReadiness.status !== "ready" ||
    payload.replayReadiness.reasons.length !== 0 ||
    contract?.payloadVersion !== 1 ||
    contract?.transactionType !== "Purchase" ||
    contract?.replayReadiness?.status !== "ready" ||
    contract?.replayReadiness?.reasons?.length !== 0
  ) {
    throw new Error(
      "Finalized Purchase replay is blocked because its backend mappings are not replay-ready."
    );
  }
}

function assertReadyFinalizedCustomerReturnReplay(payload: OfflineTransactionPayload) {
  const contract = payload.payload?.finalizedCustomerReturnReplay;

  if (
    payload.transactionType !== "return" ||
    payload.payload?.returnMode !== "customer" ||
    payload.replayReadiness?.scope !== "finalized_customer_return" ||
    payload.replayReadiness?.payloadVersion !== 1 ||
    payload.replayReadiness.status !== "ready" ||
    payload.replayReadiness.reasons.length !== 0 ||
    contract?.payloadVersion !== 1 ||
    contract?.transactionType !== "Return" ||
    contract?.returnMode !== "customer" ||
    contract?.replayReadiness?.status !== "ready" ||
    contract?.replayReadiness?.reasons?.length !== 0
  ) {
    throw new Error(
      "Finalized Customer Return replay is blocked because its backend mappings are not replay-ready."
    );
  }
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
          await syncQueueRepository.markFailed(item.id, message);
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
      const response = item.payload?._syncAction === "restore"
        ? await entityApi.restore(item.entity, getRecordId(item))
        : await entityApi.update(item.entity, getRecordId(item), item.payload);
      await applyRemoteMirrorResult(item, response);
      return;
    }

    if (item.operation === "delete") {
      if (item.payload?._syncAction === "permanentDelete") {
        await entityApi.permanentRemove(item.entity, getRecordId(item));
      } else {
        await entityApi.remove(item.entity, getRecordId(item));
      }
      return;
    }

    if (item.operation === "transaction") {
      // POS transaction sync uses a dedicated atomic backend endpoint because
      // a sale/return/delete can touch invoices, stock, batches, accounting,
      // customer/supplier balances, payments, and cylinders.
      if (!isOfflineTransactionPayload(item.payload)) {
        throw new Error("Invalid offline transaction payload.");
      }

      if (isFinalizedSalePayload(item.payload)) {
        assertReadyFinalizedSaleReplay(item.payload);
        await transactionApi.postTransaction(item.payload);
        await transactionApi.replayFinalizedSale(item.payload.clientTransactionId);
        return;
      }

      if (isFinalizedPurchasePayload(item.payload)) {
        assertReadyFinalizedPurchaseReplay(item.payload);
        await transactionApi.postTransaction(item.payload);
        await transactionApi.replayFinalizedPurchase(item.payload.clientTransactionId);
        return;
      }

      if (isFinalizedCustomerReturnPayload(item.payload)) {
        assertReadyFinalizedCustomerReturnReplay(item.payload);
        await transactionApi.postTransaction(item.payload);
        await transactionApi.replayFinalizedCustomerReturn(item.payload.clientTransactionId);
        return;
      }

      await transactionApi.postTransaction(item.payload);
      return;
    }

    throw new Error(`Unsupported sync operation: ${item.operation}`);
  },
};

