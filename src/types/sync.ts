/*
 * Future sync model:
 * - The server database is the source of truth.
 * - IndexedDB is a local mirror/cache plus an offline write queue.
 * - POS transactions must sync atomically later so invoice, stock, accounting,
 *   batch, customer/supplier, and cylinder updates cannot partially apply.
 */

export type SyncStatus = "synced" | "pending" | "conflict";

export type SyncOperation = "create" | "update" | "delete" | "transaction";

export type SyncEntityName =
  | "users"
  | "customers"
  | "suppliers"
  | "items"
  | "categories"
  | "brands"
  | "units"
  | "discounts"
  | "taxes"
  | "expenses"
  | "expCategories"
  | "settings"
  | "customer_payments"
  | "supplier_payments"
  | "transactions"
  | "sales"
  | "sale_items"
  | "held"
  | "held_items"
  | "item_batches"
  | "cylinders"
  | "cylinder_customers";

export interface SyncMetadata {
  serverId?: number | string | null;
  localId?: number | string | null;
  updatedAt?: number;
  deletedAt?: number | null;
  syncStatus?: SyncStatus;
  lastSyncedAt?: number | null;
}

export interface SyncQueueItem {
  id?: number;
  entity: SyncEntityName;
  operation: SyncOperation;
  localId?: number | string | null;
  serverId?: number | string | null;
  payload: any;
  createdAt: number;
  updatedAt: number;
  retryCount: number;
  lastError?: string | null;
  status: "pending" | "processing" | "failed" | "done";
  replayReadiness?: TransactionReplayReadiness;
}

export type TransactionReplayReadiness = {
  scope: "finalized_sale";
  payloadVersion: 1;
  status: "ready" | "unsafe";
  reasons: Array<{
    code: string;
    message: string;
    localSaleId?: number | null;
    localCustomerId?: number | null;
    localItemId?: number | null;
    localBatchId?: number | null;
    localCylinderId?: number | null;
  }>;
};

export interface OfflineTransactionPayload {
  transactionType:
    | "sale"
    | "return"
    | "invoice_delete"
    | "payment"
    | "stock_adjustment"
    | "cylinder_adjustment";
  clientTransactionId: string;
  payload: any;
  createdAt: number;
  replayReadiness?: TransactionReplayReadiness;
}

export type Syncable<T> = T & SyncMetadata;
