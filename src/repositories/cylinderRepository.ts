import {
  db,
  getAllCylinders,
  updateCylinder,
  getCylinderCustomersByCylinder,
  updateCylinderCustomer,
  getCylinderByItemId,
  addCylinder,
} from "../db";
import type { Cylinder, CylinderCustomer } from "../types/entities";

import { itemsRepository } from "./itemsRepository";

/* =========================================================
   🔥 CORE: SYNC INVENTORY (FIXED)
========================================================= */
export async function syncCylinderInventoryForSale(cart: any[]) {
  const cylinders = await getAllCylinders();

  const cylinderMap = new Map<number, Cylinder>();
  cylinders.forEach(c => {
    if (c.itemId && !c.isDeleted) {
      cylinderMap.set(c.itemId, c);
    }
  });

  for (const ci of cart) {
    const item = await itemsRepository.getById(ci.originalItemId);
    if (!item) continue;

    const isCylinder =
      (item.category || "").toLowerCase().includes("gas") ||
      (item.category || "").toLowerCase().includes("cylinder");

    if (!isCylinder) continue;

    const isMaxUnit =
      ci.unitType === "max" ||
      ci.unit === item.maxunit;

    if (!isMaxUnit) continue;

    const cylinder = cylinderMap.get(item.id!);
    if (!cylinder) continue;

    const qty = Number(ci.qty || 0);
    if (qty <= 0) continue;

    /* ---------------- SALE ---------------- */
    if (ci.isSale) {
      cylinder.filledCylinders -= qty;
      cylinder.withCustomers += qty;
    }

    /* ---------------- PURCHASE ---------------- */
    if (ci.isPurchase) {
      cylinder.filledCylinders += qty;
    }

    /* ---------------- CUSTOMER RETURN ---------------- */
    if (ci.isCustomerReturn) {
      if (cylinder.withCustomers < qty) {
        throw new Error("Customer does not hold enough cylinders for this return.");
      }

      cylinder.withCustomers -= qty;
      cylinder.emptyCylinders += qty;
    }

    /* ---------------- SAFETY ---------------- */
    cylinder.filledCylinders = Math.max(0, cylinder.filledCylinders);
    cylinder.withCustomers = Math.max(0, cylinder.withCustomers);
    cylinder.emptyCylinders = Math.max(0, cylinder.emptyCylinders);

    cylinder.qtyInStock =
      cylinder.filledCylinders +
      cylinder.emptyCylinders +
      cylinder.withCustomers;

    await updateCylinder(cylinder);
  }
}

/* =========================================================
   CYLINDERS
========================================================= */

export async function cylinderRepo_getAll(): Promise<Cylinder[]> {
  return await getAllCylinders();
}

export async function cylinderRepo_update(cylinder: Cylinder) {
  // 🔥 ensure consistency
  cylinder.qtyInStock =
    cylinder.filledCylinders +
    cylinder.emptyCylinders +
    cylinder.withCustomers;

  return await updateCylinder(cylinder);
}

export async function cylinderRepo_getByItemId(itemId: number) {
  return await getCylinderByItemId(itemId);
}

export async function cylinderRepo_add(
  cylinder: Omit<Cylinder, "id">
): Promise<number> {
  return await addCylinder(cylinder);
}

/* =========================================================
   CYLINDER CUSTOMERS
========================================================= */

export async function cylinderRepo_getCustomers(cylinderId: number) {
  return await getCylinderCustomersByCylinder(cylinderId);
}

export async function cylinderRepo_updateCustomer(data: CylinderCustomer) {
  return await updateCylinderCustomer(data);
}

/* =========================================================
   🔥 SOFT DELETE HELPERS
========================================================= */

export async function cylinderRepo_softDelete(
  cylinder: Cylinder
) {
  return await updateCylinder({
    ...cylinder,
    isDeleted: true,
    deletedAt: Date.now(),
  });
}

export async function cylinderRepo_restore(
  cylinder: Cylinder
) {
  return await updateCylinder({
    ...cylinder,
    isDeleted: false,
    deletedAt: null,
  });
}

/* =========================================================
   🔥 CYLINDER CUSTOMER HELPERS
========================================================= */

export async function cylinderRepo_softDeleteCustomers(
  cylinderId: number
) {
  const customers =
    await getCylinderCustomersByCylinder(cylinderId);

  for (const c of customers) {
    if (!c.isDeleted) {
      await updateCylinderCustomer({
        ...c,
        isDeleted: true,
        deletedAt: Date.now(),
      });
    }
  }
}

export async function cylinderRepo_restoreCustomers(
  cylinderId: number
) {
  const customers =
    await getCylinderCustomersByCylinder(cylinderId);

  for (const c of customers) {
    if (c.isDeleted) {
      await updateCylinderCustomer({
        ...c,
        isDeleted: false,
        deletedAt: null,
      });
    }
  }
}

export async function cylinderRepo_delete(
  id: number
): Promise<void> {

  const conn = await db.open();

  return new Promise((resolve, reject) => {

    const tx = conn.transaction(
      "cylinders",
      "readwrite"
    );

    const store = tx.objectStore("cylinders");

    const req = store.delete(id);

    req.onsuccess = () => resolve();

    req.onerror = () => reject(req.error);

    tx.onerror = () => reject(tx.error);
  });
}
