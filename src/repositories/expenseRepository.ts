import {
  Expense,
  getAllExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
} from "../db";

export type { Expense };

export const expenseRepository = {
  /* ---------- BASIC CRUD ---------- */

  getAll: async (): Promise<Expense[]> => {
    return await getAllExpenses();
  },

  getById: async (id: number): Promise<Expense | undefined> => {
    const all = await getAllExpenses();
    return all.find(e => e.id === id);
  },

  create: async (expense: Omit<Expense, "id">): Promise<number> => {
    return await addExpense(expense);
  },

  update: async (expense: Expense): Promise<void> => {
    await updateExpense(expense);
  },

  remove: async (id: number): Promise<void> => {
    await deleteExpense(id);
  },

  /* ---------- REPORT HELPERS ---------- */

  getByDateRange: async (
    start: string,
    end: string
  ): Promise<Expense[]> => {
    const all = await getAllExpenses();
    return all.filter(e => e.date >= start && e.date <= end);
  },

  getTotalByDateRange: async (
    start: string,
    end: string
  ): Promise<number> => {
    const filtered = await expenseRepository.getByDateRange(start, end);
    return filtered.reduce((sum, e) => sum + e.amount, 0);
  },
};