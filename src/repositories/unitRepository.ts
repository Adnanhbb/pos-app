// src/repositories/unitRepository.ts
import {
  Unit,
  getUnits,
  addUnit,
  updateUnit,
  deleteUnit,
} from "../db";

export type { Unit };

export const unitRepository = {
  getAll: async (): Promise<Unit[]> => {
    return await getUnits();
  },

  getById: async (id: number): Promise<Unit | undefined> => {
    const all = await getUnits();
    return all.find(u => u.id === id);
  },

  create: async (unit: Omit<Unit, "id">): Promise<number> => {
    return await addUnit(unit);
  },

  update: async (unit: Unit): Promise<void> => {
    await updateUnit(unit);
  },

  remove: async (id: number): Promise<void> => {
    await deleteUnit(id);
  },

  /* ---------- USAGE HELPERS ---------- */

  incrementItemCount: async (id: number): Promise<void> => {
    const unit = await unitRepository.getById(id);
    if (!unit) return;

    await updateUnit({
      ...unit,
      itemCount: (unit.itemCount ?? 0) + 1,
    });
  },

  decrementItemCount: async (id: number): Promise<void> => {
    const unit = await unitRepository.getById(id);
    if (!unit) return;

    await updateUnit({
      ...unit,
      itemCount: Math.max(0, (unit.itemCount ?? 0) - 1),
    });
  },
};
