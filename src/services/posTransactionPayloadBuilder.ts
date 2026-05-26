import type {
  Customer,
  CustomerPayment,
  Cylinder,
  CylinderCustomer,
  DBSale,
  DBSaleItem,
  Item,
  ItemBatch,
  Supplier,
  SupplierPayment,
} from "../types/entities";
import type { OfflineTransactionPayload } from "../types/sync";

type Snapshot<T> = {
  before?: Partial<T> | null;
  after?: Partial<T> | null;
};

export type StockMovementSnapshot = {
  itemId: number;
  serverId?: number | string | null;
  qtyDelta: number;
  beforeStock?: number;
  afterStock?: number;
  itemBefore?: Partial<Item> | null;
  itemAfter?: Partial<Item> | null;
};

export type BatchMutationSnapshot = {
  operation: "create" | "update" | "delete";
  localId?: number;
  serverId?: number | string | null;
  before?: Partial<ItemBatch> | null;
  after?: Partial<ItemBatch> | null;
};

export type CylinderMutationSnapshot = {
  cylinderId?: number;
  serverId?: number | string | null;
  before?: Partial<Cylinder> | null;
  after?: Partial<Cylinder> | null;
  customerHolding?: {
    before?: Partial<CylinderCustomer> | null;
    after?: Partial<CylinderCustomer> | null;
    customerName?: string;
    qtyChange?: number;
  };
};

export type SaleTransactionPayloadInput = {
  clientTransactionId?: string;
  createdAt?: number;
  sale: Omit<DBSale, "id"> | DBSale;
  saleId?: number;
  saleItems: Array<Omit<DBSaleItem, "id" | "saleId"> | DBSaleItem>;
  customer?: Snapshot<Customer> & {
    payment?: Omit<CustomerPayment, "id"> | CustomerPayment | null;
  };
  supplier?: Snapshot<Supplier> & {
    payment?: Omit<SupplierPayment, "id"> | SupplierPayment | null;
  };
  stockMovements?: StockMovementSnapshot[];
  batchMutations?: BatchMutationSnapshot[];
  cylinderMutations?: CylinderMutationSnapshot[];
};

export type ReturnTransactionPayloadInput = SaleTransactionPayloadInput & {
  returnMode: "customer" | "supplier";
};

export type InvoiceDeleteTransactionPayloadInput = {
  clientTransactionId?: string;
  createdAt?: number;
  invoice: DBSale;
  saleItems: DBSaleItem[];
  originalTransactionType: DBSale["transactionType"];
  customer?: Snapshot<Customer> & {
    deletedPayments?: CustomerPayment[];
  };
  supplier?: Snapshot<Supplier> & {
    deletedPayments?: SupplierPayment[];
  };
  stockMovements?: StockMovementSnapshot[];
  batchMutations?: BatchMutationSnapshot[];
  cylinderMutations?: CylinderMutationSnapshot[];
};

export type PaymentTransactionPayloadInput = {
  clientTransactionId?: string;
  createdAt?: number;
  partyType: "customer" | "supplier";
  payment: Omit<CustomerPayment, "id"> | CustomerPayment | Omit<SupplierPayment, "id"> | SupplierPayment;
  customer?: Snapshot<Customer>;
  supplier?: Snapshot<Supplier>;
};

function clone<T>(value: T): T {
  if (value == null) return value;

  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

function now() {
  return Date.now();
}

export function createClientTransactionId(): string {
  const random =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

  return `txn_${Date.now()}_${random}`;
}

function createPayloadBase(
  transactionType: OfflineTransactionPayload["transactionType"],
  clientTransactionId?: string,
  createdAt?: number
): Omit<OfflineTransactionPayload, "payload"> {
  return {
    transactionType,
    clientTransactionId: clientTransactionId ?? createClientTransactionId(),
    createdAt: createdAt ?? now(),
  };
}

export function buildSaleTransactionPayload(
  input: SaleTransactionPayloadInput
): OfflineTransactionPayload {
  /*
   * Capture before snapshots before local POS mutations start, then pass after
   * snapshots after the local sale/purchase save finishes. This builder only
   * packages the transaction; it must not apply stock/accounting changes.
   */
  return {
    ...createPayloadBase("sale", input.clientTransactionId, input.createdAt),
    payload: clone({
      sale: input.sale,
      saleId: input.saleId,
      saleItems: input.saleItems,
      customer: input.customer,
      supplier: input.supplier,
      stockMovements: input.stockMovements ?? [],
      batchMutations: input.batchMutations ?? [],
      cylinderMutations: input.cylinderMutations ?? [],
    }),
  };
}

export function buildReturnTransactionPayload(
  input: ReturnTransactionPayloadInput
): OfflineTransactionPayload {
  /*
   * For customer/supplier returns, capture the original item, batch, party, and
   * cylinder states before mutation and final states after local return save.
   */
  return {
    ...createPayloadBase("return", input.clientTransactionId, input.createdAt),
    payload: clone({
      returnMode: input.returnMode,
      sale: input.sale,
      saleId: input.saleId,
      saleItems: input.saleItems,
      customer: input.customer,
      supplier: input.supplier,
      stockMovements: input.stockMovements ?? [],
      batchMutations: input.batchMutations ?? [],
      cylinderMutations: input.cylinderMutations ?? [],
    }),
  };
}

export function buildInvoiceDeleteTransactionPayload(
  input: InvoiceDeleteTransactionPayloadInput
): OfflineTransactionPayload {
  /*
   * Invoice deletion must capture invoice/items/payments/batches before local
   * deletion starts, plus final stock/accounting snapshots after reversal.
   */
  return {
    ...createPayloadBase("invoice_delete", input.clientTransactionId, input.createdAt),
    payload: clone({
      invoice: input.invoice,
      saleItems: input.saleItems,
      originalTransactionType: input.originalTransactionType,
      customer: input.customer,
      supplier: input.supplier,
      stockMovements: input.stockMovements ?? [],
      batchMutations: input.batchMutations ?? [],
      cylinderMutations: input.cylinderMutations ?? [],
    }),
  };
}

export function buildPaymentTransactionPayload(
  input: PaymentTransactionPayloadInput
): OfflineTransactionPayload {
  /*
   * Standalone payments should capture party balance before the local payment
   * mutation and after it succeeds. POS invoice payments belong in sale/return
   * transaction payloads instead.
   */
  return {
    ...createPayloadBase("payment", input.clientTransactionId, input.createdAt),
    payload: clone({
      partyType: input.partyType,
      payment: input.payment,
      customer: input.customer,
      supplier: input.supplier,
    }),
  };
}
