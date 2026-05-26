import {
  getAllCylinderCustomers,
  getCylinderCustomersByCylinder,
  updateCylinderCustomer,
  addCylinderCustomer,
  deleteCylinderCustomer, // ✅ NEW
} from "../db";
import type { CylinderCustomer } from "../types/entities";

/* =========================================================
   🔥 HELPERS
========================================================= */
function safeNumber(val: any) {
  return Number(val) || 0;
}

/* =========================================================
   CORE REPOSITORY
========================================================= */
export const cylinderCustomerRepository = {

  /* ---------------- GET ---------------- */

  async getAll(): Promise<CylinderCustomer[]> {
    return await getAllCylinderCustomers();
  },

  async getByCylinder(cylinderId: number): Promise<CylinderCustomer[]> {
    const all = await getCylinderCustomersByCylinder(cylinderId);
    return all.filter(c => !c.isDeleted);
  },

  async getAllByCylinder(cylinderId: number): Promise<CylinderCustomer[]> {
    return await getCylinderCustomersByCylinder(cylinderId);
  },

  async update(customer: CylinderCustomer): Promise<void> {
    await updateCylinderCustomer(customer);
  },

  /* ---------------- UPSERT (MAIN LOGIC) ---------------- */

  async upsertHolding(
    cylinderId: number,
    cylinderType: string,
    customerName: string,
    qtyChange: number
  ): Promise<void> {

    const all = await getCylinderCustomersByCylinder(cylinderId);

    const existing = all.find(
      c =>
        c.customerName === customerName &&
        !c.isDeleted
    );

    if (existing) {
      const newQty = safeNumber(existing.qtyHeld) + safeNumber(qtyChange);

      await updateCylinderCustomer({
        ...existing,
        qtyHeld: Math.max(0, newQty),
      });

    } else {
      await addCylinderCustomer({
        cylinderId,
        cylinderType,
        customerName,
        qtyHeld: Math.max(0, qtyChange),
        isDeleted: false,
        deletedAt: null,
      });
    }
  },

  /* ---------------- SOFT DELETE ---------------- */

  async softDeleteByCylinder(cylinderId: number): Promise<void> {
    const all = await getCylinderCustomersByCylinder(cylinderId);

    for (const c of all) {
      if (!c.isDeleted) {
        await updateCylinderCustomer({
          ...c,
          isDeleted: true,
          deletedAt: Date.now(),
        });
      }
    }
  },

  async restoreByCylinder(cylinderId: number): Promise<void> {
    const all = await getCylinderCustomersByCylinder(cylinderId);

    for (const c of all) {
      if (c.isDeleted) {
        await updateCylinderCustomer({
          ...c,
          isDeleted: false,
          deletedAt: null,
        });
      }
    }
  },

  /* ---------------- HARD DELETE ---------------- */

async permanentDeleteByCylinder(
  cylinderId: number
): Promise<void> {

  const all =
    await getCylinderCustomersByCylinder(cylinderId);

  for (const c of all) {

    if (c.id != null) {
      await deleteCylinderCustomer(c.id);
    }
  }
},
};

/* =========================================================
   🔥 POS COMPATIBILITY FUNCTION (FIX FOR YOUR ERROR)
========================================================= */

export async function cylinderCustomerRepo_addOrUpdate({
  cylinderId,
  cylinderType,
  customerName,
  qtyChange,
}: {
  cylinderId: number;
  cylinderType: string;
  customerName: string;
  qtyChange: number;
}) {
  return cylinderCustomerRepository.upsertHolding(
    cylinderId,
    cylinderType,
    customerName,
    qtyChange
  );
}
