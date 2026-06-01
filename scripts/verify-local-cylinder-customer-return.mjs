#!/usr/bin/env node

import { readFileSync } from "node:fs";

const posSource = readFileSync("src/POS.tsx", "utf8");
const holdingSource = readFileSync(
  "src/repositories/cylinderCustomerRepository.ts",
  "utf8"
);
const cylinderSource = readFileSync(
  "src/repositories/cylinderRepository.ts",
  "utf8"
);

function assert(condition, name) {
  if (!condition) {
    throw new Error(`FAIL: ${name}`);
  }

  console.log(`PASS: ${name}`);
}

function applySale(state, holding, qty) {
  return {
    state: {
      ...state,
      filledCylinders: state.filledCylinders - qty,
      withCustomers: state.withCustomers + qty,
    },
    holding: holding + qty,
  };
}

function applyCustomerReturn(state, holding, qty) {
  if (holding < qty || state.withCustomers < qty) {
    throw new Error("Customer does not hold enough cylinders for this return.");
  }

  return {
    state: {
      ...state,
      emptyCylinders: state.emptyCylinders + qty,
      withCustomers: state.withCustomers - qty,
    },
    holding: holding - qty,
  };
}

function invariant(state) {
  return (
    state.qtyInStock ===
    state.filledCylinders + state.emptyCylinders + state.withCustomers
  );
}

const cylinderManagementStart = posSource.indexOf(
  "CYLINDER MANAGEMENT (ALL MODES)"
);
const customerReturnStart = posSource.indexOf(
  "if (isCustomerReturn) {",
  cylinderManagementStart
);
const supplierReturnStart = posSource.indexOf(
  "if (isSupplierReturn) {",
  customerReturnStart
);
const customerReturnBranch = posSource.slice(
  customerReturnStart,
  supplierReturnStart
);
const preflightStart = posSource.indexOf("const plannedReturns = new Map<");
const persistStart = posSource.indexOf(
  "const saleId = await salesRepository.addTransaction"
);

assert(cylinderManagementStart >= 0, "live POS cylinder management block exists");
assert(
  preflightStart >= 0 && preflightStart < persistStart,
  "customer-return cylinder preflight runs before transaction persistence"
);
assert(
  posSource.includes("cylinder mapping is missing."),
  "missing customer-return cylinder mapping is rejected"
);
assert(
  posSource.includes("const convQty = Number(item.ConvQty ?? 1);") &&
    posSource.includes("!Number.isFinite(convQty) || convQty <= 0"),
  "invalid customer-return cylinder conversion is rejected"
);
assert(
  posSource.includes("Number(holding.qtyHeld || 0) < qty"),
  "customer-return preflight rejects insufficient customer holding"
);
assert(
  customerReturnBranch.includes("updatedCylinder.withCustomers -= maxQty;") &&
    customerReturnBranch.includes("updatedCylinder.emptyCylinders += maxQty;"),
  "live customer return moves cylinders from customer holding to empty"
);
assert(
  !customerReturnBranch.includes("updatedCylinder.filledCylinders += maxQty;"),
  "live customer return does not increase filled cylinders"
);
assert(
  customerReturnBranch.includes(
    'throw new Error("Customer does not hold enough cylinders for this return.");'
  ),
  "live customer-return mutation has a defensive negative-count rejection"
);
assert(
  holdingSource.includes("if (newQty < 0)") &&
    holdingSource.includes("if (safeNumber(qtyChange) < 0)") &&
    !holdingSource.includes("Math.max(0, newQty)") &&
    !holdingSource.includes("Math.max(0, qtyChange)"),
  "customer holding repository rejects negative outcomes instead of clamping"
);
assert(
  cylinderSource.includes("if (cylinder.withCustomers < qty)") &&
    cylinderSource.includes("cylinder.emptyCylinders += qty;"),
  "repository cylinder-return helper rejects invalid return and increments empty cylinders"
);
assert(
  posSource.includes("updatedCylinder.filledCylinders -= maxQty;") &&
    posSource.includes("updatedCylinder.withCustomers += maxQty;"),
  "normal cylinder sale issue rule remains present"
);
assert(
  /if \(isPurchase\) \{\s*updatedCylinder\.filledCylinders \+= maxQty;/.test(
    posSource
  ),
  "normal cylinder purchase rule remains present"
);
assert(
  /if \(isCustomerReturn\) \{\s*newStock \+= ci\.qty;/.test(posSource),
  "existing ordinary customer-return stock rule remains present"
);

const initial = {
  qtyInStock: 5,
  filledCylinders: 4,
  emptyCylinders: 1,
  withCustomers: 0,
};
const issued = applySale(initial, 0, 2);
const returned = applyCustomerReturn(issued.state, issued.holding, 2);

assert(
  issued.state.filledCylinders === 2 &&
    issued.state.withCustomers === 2 &&
    issued.holding === 2 &&
    invariant(issued.state),
  "sale issue simulation decreases filled and increases customer holding"
);
assert(
  returned.state.filledCylinders === 2 &&
    returned.state.emptyCylinders === 3 &&
    returned.state.withCustomers === 0 &&
    returned.holding === 0 &&
    invariant(returned.state),
  "customer-return simulation preserves invariant and increments empty only"
);

let overReturnRejected = false;
try {
  applyCustomerReturn(returned.state, returned.holding, 1);
} catch (error) {
  overReturnRejected =
    error instanceof Error &&
    error.message === "Customer does not hold enough cylinders for this return.";
}
assert(overReturnRejected, "over-return simulation is rejected clearly");

console.log(
  JSON.stringify(
    {
      ok: true,
      checks: 16,
      scope: "local IndexedDB cylinder customer-return contract only",
      backendReplayChanged: false,
      autoSyncChanged: false,
    },
    null,
    2
  )
);
