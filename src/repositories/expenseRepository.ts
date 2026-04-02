import {
  Expense,
  getAllExpenses,
  addExpense,
  updateExpense,
  deleteExpense,
  searchExpenses,
  getAllExpCategories,
  addExpCategory,
} from "../db";

export type { Expense };

export const expenseRepository = {

  /* =====================================================
     BASIC CRUD
  ===================================================== */

  /** Get non-deleted expenses */
  getAll: async (): Promise<Expense[]> => {
    const all = await getAllExpenses();
    return all.filter(e => !e.isDeleted);
  },

  /** Get deleted expenses (for modal) */
  getDeleted: async (): Promise<Expense[]> => {
    const all = await getAllExpenses();
    return all.filter(e => e.isDeleted);
  },

  getById: async (id: number): Promise<Expense | undefined> => {
    const all = await getAllExpenses();
    return all.find(e => e.id === id);
  },

  create: async (expense: Omit<Expense, "id">): Promise<number> => {
    return await addExpense({
      ...expense,
      isDeleted: false,
      deletedAt: null,
    });
  },

  update: async (expense: Expense): Promise<void> => {
    await updateExpense(expense);
  },

  /** SOFT DELETE */
  remove: async (id: number): Promise<void> => {
    const all = await getAllExpenses();
    const exp = all.find(e => e.id === id);
    if (!exp) throw new Error("Expense not found");

    await updateExpense({
      ...exp,
      isDeleted: true,
      deletedAt: Date.now(),
    });
  },

  /** RESTORE */
  restore: async (id: number): Promise<void> => {
    const all = await getAllExpenses();
    const exp = all.find(e => e.id === id);
    if (!exp) throw new Error("Expense not found");

    await updateExpense({
      ...exp,
      isDeleted: false,
      deletedAt: null,
    });
  },

  /** PERMANENT DELETE */
  permanentDelete: async (id: number): Promise<void> => {
    await deleteExpense(id);
  },

  /* =====================================================
     SEARCH
  ===================================================== */

  search: async (query: string): Promise<Expense[]> => {
    if (!query.trim()) return await expenseRepository.getAll();

    const results = await searchExpenses(query);
    return results.filter(e => !e.isDeleted);
  },

  /* =====================================================
     DATE FILTERING
  ===================================================== */

  getByDateRange: async (start: string, end: string) => {
    const all = await expenseRepository.getAll();

    return all.filter(
      e => e.date >= start && e.date <= end
    );
  },

  getTotalByDateRange: async (start: string, end: string) => {
    const filtered = await expenseRepository.getByDateRange(start, end);

    return filtered.reduce((sum, e) => sum + e.amount, 0);
  },

  /* =====================================================
     CATEGORIES
  ===================================================== */

  getCategories: async (): Promise<string[]> => {
    const cats = await getAllExpCategories();
    return cats.map(c => c.category);
  },

  addCategory: async (category: string): Promise<number> => {
    return await addExpCategory(category);
  },
};