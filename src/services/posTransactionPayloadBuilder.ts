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
import type {
  OfflineTransactionPayload,
  TransactionReplayReadiness,
} from "../types/sync";

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

type ReplayServerId = number | string | null;

export type FinalizedSaleReplayBatchReference = {
  localBatchId: number | null;
  serverBatchId: ReplayServerId;
  consumedQty: number;
};

export type FinalizedSaleReplayItemReference = {
  localItemId: number;
  serverItemId: ReplayServerId;
  originalItemId: number;
  nameSnapshot: string;
  qty: number;
  price: number;
  quantityUnit: "min";
  selectedUnit: "min" | "max";
  conversion: {
    minUnit: string;
    maxUnit: string;
    convQty: number;
    quantityInMinUnit: number;
  };
  resolvedBatch: FinalizedSaleReplayBatchReference | null;
  requiresCylinderMutation: boolean;
};

export type FinalizedSaleReplayCylinderReference = {
  localItemId: number;
  serverItemId: ReplayServerId;
  localCylinderId: number | null;
  serverCylinderId: ReplayServerId;
  customerHolding: {
    localHoldingId: number | null;
    serverHoldingId: ReplayServerId;
    customerNameSnapshot: string;
  } | null;
  qtyMoved: number;
};

export type FinalizedSaleReplayContractInput = {
  localSaleId?: number;
  invoiceNo: string;
  customer: {
    localId: number;
    serverId: ReplayServerId;
    nameSnapshot: string;
  } | null;
  items: FinalizedSaleReplayItemReference[];
  payments: {
    paidAmount: number;
    source: "pos-finalization";
    method: string | null;
  };
  cylinders: FinalizedSaleReplayCylinderReference[];
  totals: {
    subtotal: number;
    discount: number;
    tax: number;
    dues: number;
    grandTotal: number;
    paid: number;
    arrears: number;
  };
};

export type FinalizedSaleReplayContractV1 = Omit<
  FinalizedSaleReplayContractInput,
  "localSaleId"
> & {
  payloadVersion: 1;
  transactionType: "Sale";
  localSaleId: number | null;
  clientTransactionId: string;
  createdAt: number;
  replayReadiness: TransactionReplayReadiness;
};

export type FinalizedPurchaseReplayBatchCreateReference = {
  localBatchId: number | null;
  sourceSaleId: number | null;
  purchaseDate: string;
  qtyPurchased: number;
  balance: number;
  costPrice: number;
  invoiceNo: string;
};

export type FinalizedPurchaseReplayItemReference = {
  localItemId: number;
  serverItemId: ReplayServerId;
  originalItemId: number;
  nameSnapshot: string;
  qty: number;
  price: number;
  costPrice: number;
  quantityUnit: "min";
  selectedUnit: "min" | "max";
  conversion: {
    minUnit: string;
    maxUnit: string;
    convQty: number;
    quantityInMinUnit: number;
  };
  batchCreate: FinalizedPurchaseReplayBatchCreateReference | null;
  requiresCylinderMutation: boolean;
};

export type FinalizedPurchaseReplayCylinderReference = {
  localItemId: number;
  serverItemId: ReplayServerId;
  localCylinderId: number | null;
  serverCylinderId: ReplayServerId;
  qtyFilledIncrease: number;
  qtyStockIncrease: number;
};

export type FinalizedPurchaseReplayContractInput = {
  localSaleId?: number;
  invoiceNo: string;
  supplier: {
    localId: number | null;
    serverId: ReplayServerId;
    nameSnapshot: string;
    directPurchase: boolean;
  };
  items: FinalizedPurchaseReplayItemReference[];
  payments: {
    paidAmount: number;
    source: "pos-finalization";
    method: string | null;
  };
  cylinders: FinalizedPurchaseReplayCylinderReference[];
  totals: {
    subtotal: number;
    discount: number;
    tax: number;
    dues: number;
    grandTotal: number;
    paid: number;
    arrears: number;
  };
};

export type FinalizedPurchaseReplayContractV1 = Omit<
  FinalizedPurchaseReplayContractInput,
  "localSaleId"
> & {
  payloadVersion: 1;
  transactionType: "Purchase";
  localSaleId: number | null;
  clientTransactionId: string;
  createdAt: number;
  replayReadiness: TransactionReplayReadiness;
};

export type FinalizedCustomerReturnReplayBatchCreateReference = {
  localBatchId: number | null;
  sourceSaleId: number | null;
  purchaseDate: string;
  qtyReturned: number;
  balance: number;
  costPrice: number;
  invoiceNo: string;
};

export type FinalizedCustomerReturnReplayItemReference = {
  localItemId: number;
  serverItemId: ReplayServerId;
  originalItemId: number;
  nameSnapshot: string;
  qty: number;
  price: number;
  costPrice: number;
  quantityUnit: "min";
  selectedUnit: "min" | "max";
  conversion: {
    minUnit: string;
    maxUnit: string;
    convQty: number;
    quantityInMinUnit: number;
  };
  returnBatchCreate: FinalizedCustomerReturnReplayBatchCreateReference | null;
  requiresCylinderMutation: boolean;
};

export type FinalizedCustomerReturnReplayCylinderReference = {
  localItemId: number;
  serverItemId: ReplayServerId;
  localCylinderId: number | null;
  serverCylinderId: ReplayServerId;
  customerHolding: {
    localHoldingId: number | null;
    serverHoldingId: ReplayServerId;
    customerNameSnapshot: string;
  } | null;
  qtyReturned: number;
  movement: "customerHoldingToEmpty";
};

export type FinalizedCustomerReturnReplayContractInput = {
  localSaleId?: number;
  invoiceNo: string;
  customer: {
    localId: number | null;
    serverId: ReplayServerId;
    nameSnapshot: string;
  };
  items: FinalizedCustomerReturnReplayItemReference[];
  payments: {
    paidAmount: number;
    source: "pos-finalization";
    method: string | null;
  };
  cylinders: FinalizedCustomerReturnReplayCylinderReference[];
  totals: {
    subtotal: number;
    discount: number;
    tax: number;
    dues: number;
    grandTotal: number;
    paid: number;
    arrears: number;
  };
};

export type FinalizedCustomerReturnReplayContractV1 = Omit<
  FinalizedCustomerReturnReplayContractInput,
  "localSaleId"
> & {
  payloadVersion: 1;
  transactionType: "Return";
  returnMode: "customer";
  localSaleId: number | null;
  clientTransactionId: string;
  createdAt: number;
  replayReadiness: TransactionReplayReadiness;
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
  finalizedSaleReplay?: FinalizedSaleReplayContractInput;
  finalizedPurchaseReplay?: FinalizedPurchaseReplayContractInput;
};

export type ReturnTransactionPayloadInput = SaleTransactionPayloadInput & {
  returnMode: "customer" | "supplier";
  finalizedCustomerReturnReplay?: FinalizedCustomerReturnReplayContractInput;
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

function addUnsafeReason(
  reasons: TransactionReplayReadiness["reasons"],
  reason: TransactionReplayReadiness["reasons"][number]
) {
  if (
    !reasons.some(
      (existing) =>
        existing.code === reason.code &&
        existing.localSaleId === reason.localSaleId &&
        existing.localCustomerId === reason.localCustomerId &&
        existing.localSupplierId === reason.localSupplierId &&
        existing.localItemId === reason.localItemId &&
        existing.localBatchId === reason.localBatchId &&
        existing.localCylinderId === reason.localCylinderId
    )
  ) {
    reasons.push(reason);
  }
}

export function buildFinalizedSaleReplayContract(
  input: FinalizedSaleReplayContractInput & {
    clientTransactionId: string;
    createdAt: number;
  }
): FinalizedSaleReplayContractV1 {
  const reasons: TransactionReplayReadiness["reasons"] = [];

  if (input.localSaleId == null) {
    addUnsafeReason(reasons, {
      code: "missing_local_sale_id",
      message: "Finalized local Sale id is missing.",
      localSaleId: null,
    });
  }

  if (input.customer && input.customer.serverId == null) {
    addUnsafeReason(reasons, {
      code: "missing_customer_server_id",
      message: "Selected customer is not mapped to a backend row.",
      localCustomerId: input.customer.localId,
    });
  }

  for (const item of input.items) {
    if (item.serverItemId == null) {
      addUnsafeReason(reasons, {
        code: "missing_server_item_id",
        message: "Sale item is not mapped to a backend row.",
        localItemId: item.localItemId,
      });
    }

    if (item.resolvedBatch && item.resolvedBatch.serverBatchId == null) {
      addUnsafeReason(reasons, {
        code: "missing_server_batch_id",
        message: "Resolved Sale batch is not mapped to a backend row.",
        localItemId: item.localItemId,
        localBatchId: item.resolvedBatch.localBatchId,
      });
    }

    if (
      item.requiresCylinderMutation &&
      !input.cylinders.some((cylinder) => cylinder.localItemId === item.localItemId)
    ) {
      addUnsafeReason(reasons, {
        code: "missing_cylinder_mapping",
        message: "Cylinder Sale movement has no local cylinder mapping.",
        localItemId: item.localItemId,
      });
    }
  }

  for (const cylinder of input.cylinders) {
    if (cylinder.serverCylinderId == null) {
      addUnsafeReason(reasons, {
        code: "missing_server_cylinder_id",
        message: "Cylinder Sale movement is not mapped to a backend cylinder row.",
        localItemId: cylinder.localItemId,
        localCylinderId: cylinder.localCylinderId,
      });
    }
  }

  const replayReadiness: TransactionReplayReadiness = {
    scope: "finalized_sale",
    payloadVersion: 1,
    status: reasons.length === 0 ? "ready" : "unsafe",
    reasons,
  };

  return {
    payloadVersion: 1,
    transactionType: "Sale",
    localSaleId: input.localSaleId ?? null,
    invoiceNo: input.invoiceNo,
    clientTransactionId: input.clientTransactionId,
    createdAt: input.createdAt,
    customer: input.customer,
    items: input.items,
    payments: input.payments,
    cylinders: input.cylinders,
    totals: input.totals,
    replayReadiness,
  };
}

export function buildFinalizedPurchaseReplayContract(
  input: FinalizedPurchaseReplayContractInput & {
    clientTransactionId: string;
    createdAt: number;
  }
): FinalizedPurchaseReplayContractV1 {
  const reasons: TransactionReplayReadiness["reasons"] = [];

  if (input.localSaleId == null) {
    addUnsafeReason(reasons, {
      code: "missing_local_sale_id",
      message: "Finalized local Purchase id is missing.",
      localSaleId: null,
    });
  }

  if (!input.supplier.directPurchase && input.supplier.serverId == null) {
    addUnsafeReason(reasons, {
      code: "missing_supplier_server_id",
      message: "Selected supplier is not mapped to a backend row.",
      localSupplierId: input.supplier.localId,
    });
  }

  for (const item of input.items) {
    if (item.serverItemId == null) {
      addUnsafeReason(reasons, {
        code: "missing_server_item_id",
        message: "Purchase item is not mapped to a backend row.",
        localItemId: item.localItemId,
      });
    }

    if (
      !item.batchCreate ||
      item.batchCreate.localBatchId == null ||
      item.batchCreate.sourceSaleId == null ||
      !Number.isFinite(item.batchCreate.qtyPurchased) ||
      item.batchCreate.qtyPurchased <= 0 ||
      !Number.isFinite(item.batchCreate.balance) ||
      item.batchCreate.balance <= 0 ||
      !Number.isFinite(item.batchCreate.costPrice) ||
      item.batchCreate.costPrice < 0 ||
      typeof item.batchCreate.purchaseDate !== "string" ||
      item.batchCreate.purchaseDate.trim() === "" ||
      typeof item.batchCreate.invoiceNo !== "string" ||
      item.batchCreate.invoiceNo.trim() === ""
    ) {
      addUnsafeReason(reasons, {
        code: "missing_batch_create_metadata",
        message: "Purchase item is missing its local batch-create correlation metadata.",
        localItemId: item.localItemId,
        localBatchId: item.batchCreate?.localBatchId ?? null,
      });
    }

    if (
      item.requiresCylinderMutation &&
      !input.cylinders.some((cylinder) => cylinder.localItemId === item.localItemId)
    ) {
      addUnsafeReason(reasons, {
        code: "missing_cylinder_mapping",
        message: "Cylinder Purchase movement has no local cylinder mapping.",
        localItemId: item.localItemId,
      });
    }
  }

  for (const cylinder of input.cylinders) {
    if (cylinder.serverCylinderId == null) {
      addUnsafeReason(reasons, {
        code: "missing_server_cylinder_id",
        message: "Cylinder Purchase movement is not mapped to a backend cylinder row.",
        localItemId: cylinder.localItemId,
        localCylinderId: cylinder.localCylinderId,
      });
    }
  }

  const replayReadiness: TransactionReplayReadiness = {
    scope: "finalized_purchase",
    payloadVersion: 1,
    status: reasons.length === 0 ? "ready" : "unsafe",
    reasons,
  };

  return {
    payloadVersion: 1,
    transactionType: "Purchase",
    localSaleId: input.localSaleId ?? null,
    invoiceNo: input.invoiceNo,
    clientTransactionId: input.clientTransactionId,
    createdAt: input.createdAt,
    supplier: input.supplier,
    items: input.items,
    payments: input.payments,
    cylinders: input.cylinders,
    totals: input.totals,
    replayReadiness,
  };
}

export function buildFinalizedCustomerReturnReplayContract(
  input: FinalizedCustomerReturnReplayContractInput & {
    clientTransactionId: string;
    createdAt: number;
  }
): FinalizedCustomerReturnReplayContractV1 {
  const reasons: TransactionReplayReadiness["reasons"] = [];

  if (input.localSaleId == null) {
    addUnsafeReason(reasons, {
      code: "missing_local_sale_id",
      message: "Finalized local Customer Return id is missing.",
      localSaleId: null,
    });
  }

  if (input.customer.serverId == null) {
    addUnsafeReason(reasons, {
      code: "missing_customer_server_id",
      message: "Customer Return customer is not mapped to a backend row.",
      localCustomerId: input.customer.localId,
    });
  }

  for (const item of input.items) {
    if (item.serverItemId == null) {
      addUnsafeReason(reasons, {
        code: "missing_server_item_id",
        message: "Customer Return item is not mapped to a backend row.",
        localItemId: item.localItemId,
      });
    }

    if (
      !item.returnBatchCreate ||
      item.returnBatchCreate.localBatchId == null ||
      item.returnBatchCreate.sourceSaleId == null ||
      !Number.isFinite(item.returnBatchCreate.qtyReturned) ||
      item.returnBatchCreate.qtyReturned <= 0 ||
      !Number.isFinite(item.returnBatchCreate.balance) ||
      item.returnBatchCreate.balance <= 0 ||
      !Number.isFinite(item.returnBatchCreate.costPrice) ||
      item.returnBatchCreate.costPrice < 0 ||
      typeof item.returnBatchCreate.purchaseDate !== "string" ||
      item.returnBatchCreate.purchaseDate.trim() === "" ||
      typeof item.returnBatchCreate.invoiceNo !== "string" ||
      item.returnBatchCreate.invoiceNo.trim() === ""
    ) {
      addUnsafeReason(reasons, {
        code: "missing_return_batch_metadata",
        message: "Customer Return item is missing its local return-batch correlation metadata.",
        localItemId: item.localItemId,
        localBatchId: item.returnBatchCreate?.localBatchId ?? null,
      });
    }

    if (
      item.requiresCylinderMutation &&
      !input.cylinders.some((cylinder) => cylinder.localItemId === item.localItemId)
    ) {
      addUnsafeReason(reasons, {
        code: "missing_cylinder_mapping",
        message: "Cylinder Customer Return movement has no local cylinder mapping.",
        localItemId: item.localItemId,
      });
    }
  }

  for (const cylinder of input.cylinders) {
    if (cylinder.serverCylinderId == null) {
      addUnsafeReason(reasons, {
        code: "missing_server_cylinder_id",
        message: "Cylinder Customer Return movement is not mapped to a backend cylinder row.",
        localItemId: cylinder.localItemId,
        localCylinderId: cylinder.localCylinderId,
      });
    }

    if (
      !cylinder.customerHolding ||
      cylinder.customerHolding.localHoldingId == null ||
      cylinder.customerHolding.serverHoldingId == null
    ) {
      addUnsafeReason(reasons, {
        code: "missing_customer_holding_mapping",
        message: "Cylinder Customer Return holding is not mapped to a backend holding row.",
        localItemId: cylinder.localItemId,
        localCylinderId: cylinder.localCylinderId,
      });
    }
  }

  const replayReadiness: TransactionReplayReadiness = {
    scope: "finalized_customer_return",
    payloadVersion: 1,
    status: reasons.length === 0 ? "ready" : "unsafe",
    reasons,
  };

  return {
    payloadVersion: 1,
    transactionType: "Return",
    returnMode: "customer",
    localSaleId: input.localSaleId ?? null,
    invoiceNo: input.invoiceNo,
    clientTransactionId: input.clientTransactionId,
    createdAt: input.createdAt,
    customer: input.customer,
    items: input.items,
    payments: input.payments,
    cylinders: input.cylinders,
    totals: input.totals,
    replayReadiness,
  };
}

function buildUnavailableFinalizedCustomerReturnReplayContract(
  input: ReturnTransactionPayloadInput,
  clientTransactionId: string,
  createdAt: number
): FinalizedCustomerReturnReplayContractV1 {
  const contract = buildFinalizedCustomerReturnReplayContract({
    localSaleId: input.saleId,
    invoiceNo: input.sale.invoiceNo,
    clientTransactionId,
    createdAt,
    customer: {
      localId: input.sale.customerId ?? null,
      serverId: null,
      nameSnapshot: input.sale.customerName || "Customer Return",
    },
    items: [],
    payments: {
      paidAmount: Number(input.sale.paid) || 0,
      source: "pos-finalization",
      method: null,
    },
    cylinders: [],
    totals: {
      subtotal: input.sale.subtotal,
      discount: input.sale.discount,
      tax: input.sale.tax,
      dues: input.sale.dues,
      grandTotal: input.sale.grandTotal,
      paid: input.sale.paid,
      arrears: input.sale.arrears,
    },
  });

  addUnsafeReason(contract.replayReadiness.reasons, {
    code: "missing_finalized_customer_return_replay_contract",
    message: "Finalized Customer Return replay mapping contract was not captured.",
    localSaleId: input.saleId ?? null,
  });
  contract.replayReadiness.status = "unsafe";
  return contract;
}

function buildUnavailableFinalizedPurchaseReplayContract(
  input: SaleTransactionPayloadInput,
  clientTransactionId: string,
  createdAt: number
): FinalizedPurchaseReplayContractV1 {
  const directPurchase = input.sale.supplierId == null;
  const contract = buildFinalizedPurchaseReplayContract({
    localSaleId: input.saleId,
    invoiceNo: input.sale.invoiceNo,
    clientTransactionId,
    createdAt,
    supplier: {
      localId: input.sale.supplierId ?? null,
      serverId: null,
      nameSnapshot: input.sale.supplierName || "Direct Purchase",
      directPurchase,
    },
    items: [],
    payments: {
      paidAmount: Number(input.sale.paid) || 0,
      source: "pos-finalization",
      method: null,
    },
    cylinders: [],
    totals: {
      subtotal: input.sale.subtotal,
      discount: input.sale.discount,
      tax: input.sale.tax,
      dues: input.sale.dues,
      grandTotal: input.sale.grandTotal,
      paid: input.sale.paid,
      arrears: input.sale.arrears,
    },
  });

  addUnsafeReason(contract.replayReadiness.reasons, {
    code: "missing_finalized_purchase_replay_contract",
    message: "Finalized Purchase replay mapping contract was not captured.",
    localSaleId: input.saleId ?? null,
  });
  contract.replayReadiness.status = "unsafe";
  return contract;
}

function buildUnavailableFinalizedSaleReplayContract(
  input: SaleTransactionPayloadInput,
  clientTransactionId: string,
  createdAt: number
): FinalizedSaleReplayContractV1 {
  const contract = buildFinalizedSaleReplayContract({
    localSaleId: input.saleId,
    invoiceNo: input.sale.invoiceNo,
    clientTransactionId,
    createdAt,
    customer: null,
    items: [],
    payments: {
      paidAmount: Number(input.sale.paid) || 0,
      source: "pos-finalization",
      method: null,
    },
    cylinders: [],
    totals: {
      subtotal: input.sale.subtotal,
      discount: input.sale.discount,
      tax: input.sale.tax,
      dues: input.sale.dues,
      grandTotal: input.sale.grandTotal,
      paid: input.sale.paid,
      arrears: input.sale.arrears,
    },
  });

  addUnsafeReason(contract.replayReadiness.reasons, {
    code: "missing_finalized_sale_replay_contract",
    message: "Finalized Sale replay mapping contract was not captured.",
    localSaleId: input.saleId ?? null,
  });
  contract.replayReadiness.status = "unsafe";
  return contract;
}

export function buildSaleTransactionPayload(
  input: SaleTransactionPayloadInput
): OfflineTransactionPayload {
  /*
   * Capture before snapshots before local POS mutations start, then pass after
   * snapshots after the local sale/purchase save finishes. This builder only
   * packages the transaction; it must not apply stock/accounting changes.
   */
  const base = createPayloadBase("sale", input.clientTransactionId, input.createdAt);
  const isFinalizedSale =
    input.sale.transactionType === "Sale" && input.sale.isPostponed !== true;
  const isFinalizedPurchase =
    input.sale.transactionType === "Purchase" && input.sale.isPostponed !== true;

  if (isFinalizedSale) {
    const finalizedSaleReplay = input.finalizedSaleReplay
      ? buildFinalizedSaleReplayContract({
          ...input.finalizedSaleReplay,
          clientTransactionId: base.clientTransactionId,
          createdAt: base.createdAt,
        })
      : buildUnavailableFinalizedSaleReplayContract(
          input,
          base.clientTransactionId,
          base.createdAt
        );

    return {
      ...base,
      replayReadiness: finalizedSaleReplay.replayReadiness,
      payload: clone({
        sale: input.sale,
        saleId: input.saleId,
        saleItems: input.saleItems,
        finalizedSaleReplay,
      }),
    };
  }

  if (isFinalizedPurchase) {
    const finalizedPurchaseReplay = input.finalizedPurchaseReplay
      ? buildFinalizedPurchaseReplayContract({
          ...input.finalizedPurchaseReplay,
          clientTransactionId: base.clientTransactionId,
          createdAt: base.createdAt,
        })
      : buildUnavailableFinalizedPurchaseReplayContract(
          input,
          base.clientTransactionId,
          base.createdAt
        );

    return {
      ...base,
      replayReadiness: finalizedPurchaseReplay.replayReadiness,
      payload: clone({
        sale: input.sale,
        saleId: input.saleId,
        saleItems: input.saleItems,
        finalizedPurchaseReplay,
      }),
    };
  }

  return {
    ...base,
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
  const base = createPayloadBase("return", input.clientTransactionId, input.createdAt);
  const isFinalizedCustomerReturn =
    input.returnMode === "customer" &&
    input.sale.transactionType === "Return" &&
    input.sale.isPostponed !== true;

  if (isFinalizedCustomerReturn) {
    const finalizedCustomerReturnReplay = input.finalizedCustomerReturnReplay
      ? buildFinalizedCustomerReturnReplayContract({
          ...input.finalizedCustomerReturnReplay,
          clientTransactionId: base.clientTransactionId,
          createdAt: base.createdAt,
        })
      : buildUnavailableFinalizedCustomerReturnReplayContract(
          input,
          base.clientTransactionId,
          base.createdAt
        );

    return {
      ...base,
      replayReadiness: finalizedCustomerReturnReplay.replayReadiness,
      payload: clone({
        returnMode: input.returnMode,
        sale: input.sale,
        saleId: input.saleId,
        saleItems: input.saleItems,
        finalizedCustomerReturnReplay,
      }),
    };
  }

  return {
    ...base,
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
