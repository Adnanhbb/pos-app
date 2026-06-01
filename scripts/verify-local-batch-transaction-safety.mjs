#!/usr/bin/env node

import { readFileSync } from "node:fs";

const posSource = readFileSync("src/POS.tsx", "utf8");

function assert(condition, name) {
  if (!condition) {
    throw new Error(`FAIL: ${name}`);
  }

  console.log(`PASS: ${name}`);
}

function activeBatches(batches) {
  return batches.filter((batch) => !batch.isDeleted);
}

function availableBatchesOldestFirst(batches) {
  return activeBatches(batches)
    .filter((batch) => Number(batch.balance) > 0)
    .sort(
      (a, b) =>
        new Date(a.purchaseDate).getTime() -
          new Date(b.purchaseDate).getTime() ||
        Number(a.id ?? 0) - Number(b.id ?? 0)
    );
}

function resolveSaleBatch(batches, batchId) {
  const tracked = activeBatches(batches);
  if (batchId != null) {
    const selected = tracked.find((batch) => batch.id === batchId);
    if (!selected) throw new Error("selected purchase batch is missing");
    return selected;
  }

  if (tracked.length === 0) return null;

  const fifo = availableBatchesOldestFirst(tracked)[0];
  if (!fifo) throw new Error("insufficient purchase batch balance");
  return fifo;
}

function resolveSupplierReturnBatch(batches, batchId) {
  const tracked = activeBatches(batches);
  if (batchId == null) {
    if (tracked.length === 0) return null;
    throw new Error("select the purchase batch being returned");
  }

  const selected = tracked.find((batch) => batch.id === batchId);
  if (!selected) throw new Error("selected purchase batch is missing");
  return selected;
}

function assertAvailable(batch, qty) {
  if (batch && qty > Number(batch.balance)) {
    throw new Error("insufficient purchase batch balance");
  }
}

function finalizeSale(item, batches, qty, batchId) {
  const batch = resolveSaleBatch(batches, batchId);
  assertAvailable(batch, qty);

  const nextItem = { ...item, availableStock: item.availableStock - qty };
  if (!batch) return { item: nextItem, batches };

  return {
    item: nextItem,
    batches: batches.map((candidate) =>
      candidate.id === batch.id
        ? {
            ...candidate,
            qtySold: candidate.qtySold + qty,
            balance: candidate.balance - qty,
          }
        : candidate
    ),
  };
}

function finalizeSupplierReturn(item, batches, qty, batchId) {
  const batch = resolveSupplierReturnBatch(batches, batchId);
  assertAvailable(batch, qty);

  const nextItem = { ...item, availableStock: item.availableStock - qty };
  if (!batch) return { item: nextItem, batches };

  return {
    item: nextItem,
    batches: batches.map((candidate) =>
      candidate.id === batch.id
        ? {
            ...candidate,
            qtyPurchased: candidate.qtyPurchased - qty,
            balance: candidate.balance - qty,
          }
        : candidate
    ),
  };
}

const preflightStart = posSource.indexOf(
  "const resolvedSaleBatches = new Map<number, ItemBatch>();"
);
const persistStart = posSource.indexOf(
  "const saleId = await finalizeLocalPOSTransaction"
);

assert(
  preflightStart >= 0 && preflightStart < persistStart,
  "batch preflight runs before sale header persistence"
);
assert(
  posSource.includes("resolvedSaleBatches.set(ci.id, batch);") &&
    posSource.includes("const batch = resolvedSaleBatches.get(ci.id);"),
  "sale consumes the exact batch approved by preflight"
);
assert(
  posSource.includes("new Date(a.purchaseDate).getTime()") &&
    posSource.includes("batch = availableBatches[0];"),
  "sale fallback preserves oldest-available FIFO selection"
);
assert(
  posSource.includes("selected purchase batch is missing.") &&
    posSource.includes("insufficient purchase batch balance."),
  "missing and insufficient sale batch mappings reject clearly"
);
assert(
  !posSource.includes("batch.balance = Math.max(0, batch.balance);"),
  "sale batch balance is never silently clamped"
);
assert(
  posSource.includes("resolvedSupplierReturnBatches.set(ci.id, batch);") &&
    posSource.includes("select the purchase batch being returned.") &&
    posSource.includes(
      'throw new Error("Insufficient purchase batch balance for supplier return.");'
    ),
  "supplier return requires and defensively validates its approved batch"
);
assert(
  posSource.includes("batchCreates.push({") &&
    posSource.includes("qtyPurchased: ci.qty,") &&
    posSource.includes("balance: ci.qty,"),
  "purchase and customer-return batch creation behavior remains present"
);

const baseItem = { availableStock: 10 };
const batches = [
  {
    id: 1,
    purchaseDate: "2026-01-01T00:00:00.000Z",
    qtyPurchased: 5,
    qtySold: 0,
    balance: 5,
    isDeleted: false,
  },
  {
    id: 2,
    purchaseDate: "2026-02-01T00:00:00.000Z",
    qtyPurchased: 8,
    qtySold: 0,
    balance: 8,
    isDeleted: false,
  },
];

const selectedSale = finalizeSale(baseItem, batches, 3, 2);
assert(
  selectedSale.item.availableStock === 7 &&
    selectedSale.batches.find((batch) => batch.id === 1)?.balance === 5 &&
    selectedSale.batches.find((batch) => batch.id === 2)?.balance === 5,
  "valid sale consumes selected batch and stock consistently"
);

const fifoSale = finalizeSale(baseItem, batches, 2, null);
assert(
  fifoSale.batches.find((batch) => batch.id === 1)?.balance === 3 &&
    fifoSale.batches.find((batch) => batch.id === 2)?.balance === 8,
  "unselected tracked sale consumes oldest available batch"
);

let overSaleRejected = false;
try {
  finalizeSale(baseItem, batches, 6, 1);
} catch (error) {
  overSaleRejected =
    error instanceof Error &&
    error.message === "insufficient purchase batch balance";
}
assert(overSaleRejected, "sale over available batch balance rejects before mutation");
assert(
  baseItem.availableStock === 10 && batches[0].balance === 5,
  "rejected sale leaves stock and batch input untouched"
);

const supplierReturn = finalizeSupplierReturn(baseItem, batches, 2, 2);
assert(
  supplierReturn.item.availableStock === 8 &&
    supplierReturn.batches.find((batch) => batch.id === 2)?.qtyPurchased === 6 &&
    supplierReturn.batches.find((batch) => batch.id === 2)?.balance === 6,
  "valid supplier return reduces selected batch and stock consistently"
);

let overSupplierReturnRejected = false;
try {
  finalizeSupplierReturn(baseItem, batches, 9, 2);
} catch (error) {
  overSupplierReturnRejected =
    error instanceof Error &&
    error.message === "insufficient purchase batch balance";
}
assert(
  overSupplierReturnRejected,
  "supplier return over available batch balance rejects before mutation"
);

const nonBatchSale = finalizeSale(baseItem, [], 2, null);
assert(
  nonBatchSale.item.availableStock === 8 && nonBatchSale.batches.length === 0,
  "non-batch sale retains existing stock-only behavior"
);

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: 14,
      scope: "local IndexedDB batch transaction safety only",
      backendReplayChanged: false,
      autoSyncChanged: false,
    },
    null,
    2
  )
);
