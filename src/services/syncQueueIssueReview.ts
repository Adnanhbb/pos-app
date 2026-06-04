import type { SyncQueueItem } from "../types/sync";

export type SyncQueueIssueCategory =
  | "old_incomplete_record"
  | "business_transaction_needs_support"
  | "sign_in_required"
  | "could_not_validate"
  | "other";

export type SyncQueueIssueReview = {
  id: number | null;
  entity: SyncQueueItem["entity"];
  operation: SyncQueueItem["operation"];
  status: SyncQueueItem["status"];
  invoiceNo: string | null;
  transactionType: string | null;
  friendlyType: string;
  friendlyReason: string;
  category: SyncQueueIssueCategory;
  archivable: boolean;
  technicalReason: string | null;
  reasonCodes: string[];
  lastError: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  retryCount: number;
};

export type SyncQueueIssueSummary = {
  totalIssues: number;
  archivable: number;
  needsSupport: number;
  byCategory: Record<SyncQueueIssueCategory, number>;
  byFriendlyType: Record<string, number>;
  issues: SyncQueueIssueReview[];
};

const BUSINESS_QUEUE_ENTITIES = new Set<SyncQueueItem["entity"]>([
  "transactions",
  "sales",
  "sale_items",
  "customer_payments",
  "supplier_payments",
  "item_batches",
  "cylinders",
  "cylinder_customers",
]);

function countBy<T extends string>(values: T[]): Record<T, number> {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {} as Record<T, number>);
}

function titleCase(value: string) {
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function getNestedPayload(row: SyncQueueItem) {
  return row.payload?.payload ?? row.payload ?? {};
}

export function getSyncQueueInvoiceNo(row: SyncQueueItem): string | null {
  const payload = getNestedPayload(row);
  const contracts = [
    payload.finalizedSaleReplay,
    payload.finalizedPurchaseReplay,
    payload.finalizedCustomerReturnReplay,
    payload.finalizedSupplierReturnReplay,
  ];

  for (const contract of contracts) {
    if (typeof contract?.invoiceNo === "string" && contract.invoiceNo.trim()) {
      return contract.invoiceNo.trim();
    }
  }

  const candidates = [
    payload.sale?.invoiceNo,
    payload.invoiceNo,
    row.payload?.invoiceNo,
  ];

  const invoiceNo = candidates.find(value => typeof value === "string" && value.trim());
  return typeof invoiceNo === "string" ? invoiceNo.trim() : null;
}

export function getSyncQueueTransactionType(row: SyncQueueItem): string | null {
  const payload = getNestedPayload(row);
  const contracts = [
    payload.finalizedSaleReplay,
    payload.finalizedPurchaseReplay,
    payload.finalizedCustomerReturnReplay,
    payload.finalizedSupplierReturnReplay,
  ];

  for (const contract of contracts) {
    if (typeof contract?.transactionType === "string") {
      if (contract.returnMode === "customer") return "Customer Return";
      if (contract.returnMode === "supplier") return "Supplier Return";
      return contract.transactionType;
    }
  }

  const saleType = payload.sale?.transactionType;
  if (saleType === "Return" && payload.returnMode === "customer") return "Customer Return";
  if (saleType === "Return" && payload.returnMode === "supplier") return "Supplier Return";
  if (typeof saleType === "string") return saleType;
  if (typeof row.payload?.transactionType === "string") return row.payload.transactionType;
  return null;
}

function getFriendlyType(row: SyncQueueItem, transactionType: string | null) {
  if (row.entity === "transactions") {
    return transactionType ? `${transactionType} record` : "Business transaction";
  }

  if (row.entity === "customer_payments") return "Customer payment";
  if (row.entity === "supplier_payments") return "Supplier payment";
  return `${titleCase(row.entity)} record`;
}

function getReasonCodes(row: SyncQueueItem) {
  const readinessCodes = row.replayReadiness?.reasons?.map(reason => reason.code).filter(Boolean) ?? [];
  const nestedReadiness = getNestedPayload(row).replayReadiness?.reasons?.map((reason: { code?: string }) => reason.code).filter(Boolean) ?? [];
  return Array.from(new Set([...readinessCodes, ...nestedReadiness]));
}

export function reviewSyncQueueIssue(row: SyncQueueItem): SyncQueueIssueReview | null {
  if (row.status !== "failed") return null;

  const id = row.id ?? null;
  const lastError = row.lastError ?? null;
  const lowerError = String(lastError ?? "").toLowerCase();
  const reasonCodes = getReasonCodes(row);
  const invoiceNo = getSyncQueueInvoiceNo(row);
  const transactionType = getSyncQueueTransactionType(row);
  const friendlyType = getFriendlyType(row, transactionType);
  const isBusinessQueueRow = BUSINESS_QUEUE_ENTITIES.has(row.entity);

  let category: SyncQueueIssueCategory = "other";
  let friendlyReason = "Some records need support.";
  let archivable = false;

  if (lowerError.includes("auth") || lowerError.includes("session") || lowerError.includes("sign in")) {
    category = "sign_in_required";
    friendlyReason = "Please sign in again before syncing.";
  } else if (
    row.replayReadiness?.status === "unsafe" ||
    reasonCodes.length > 0 ||
    lowerError.includes("not replay-ready") ||
    lowerError.includes("mappings are not replay-ready")
  ) {
    category = "business_transaction_needs_support";
    friendlyReason = "A business record needs support before it can sync.";
  } else if (lowerError.includes("not found") && !isBusinessQueueRow) {
    category = "old_incomplete_record";
    friendlyReason = "Some old sync records could not be completed.";
    archivable = true;
  } else if (lowerError.includes("validation") || lowerError.includes("invalid")) {
    category = "could_not_validate";
    friendlyReason = "Some records need support.";
  }

  return {
    id,
    entity: row.entity,
    operation: row.operation,
    status: row.status,
    invoiceNo,
    transactionType,
    friendlyType,
    friendlyReason,
    category,
    archivable,
    technicalReason: lastError,
    reasonCodes,
    lastError,
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
    retryCount: row.retryCount ?? 0,
  };
}

export function summarizeSyncQueueIssues(rows: SyncQueueItem[]): SyncQueueIssueSummary {
  const issues = rows
    .map(reviewSyncQueueIssue)
    .filter((issue): issue is SyncQueueIssueReview => Boolean(issue));

  return {
    totalIssues: issues.length,
    archivable: issues.filter(issue => issue.archivable).length,
    needsSupport: issues.filter(issue => !issue.archivable).length,
    byCategory: countBy(issues.map(issue => issue.category)),
    byFriendlyType: countBy(issues.map(issue => issue.friendlyType)),
    issues,
  };
}
