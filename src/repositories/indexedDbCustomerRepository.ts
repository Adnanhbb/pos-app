import * as db from "../db";
import type { Customer } from "../types/entities";
import { customersRepository } from "./customerRepository";

/**
 * IndexedDB-backed implementation of customersRepository.
 * MUST match customersRepository contract exactly.
 */
export const indexedDbCustomerRepository: typeof customersRepository = {

  /** ---------------- ACTIVE ---------------- */

  getAll: async (): Promise<Customer[]> => {
  const all = await db.getAllCustomers();
  return all.filter(c => !c.isDeleted);
},

  getById: async (id: number): Promise<Customer | undefined> => {
    return await db.getCustomerById(id);
  },

  getPaged: async (page: number, pageSize: number, query?: string) => {
    const { total, data } =
      await db.getCustomersPaged(page, pageSize, query ?? null);

    const filtered = data.filter(c => !c.isDeleted);

    return {
      total: filtered.length,
      data: filtered,
    };
  },

  search: async (q: string): Promise<Customer[]> => {
  const results = await db.searchCustomers(q);
  return results.filter(c => !c.isDeleted);
},

  /** ---------------- DELETED ---------------- */

  getDeleted: async (): Promise<Customer[]> => {
    const all = await db.getAllCustomers();
    return all.filter(c => c.isDeleted === true);
  },

  /** ---------------- CREATE / UPDATE ---------------- */

  create: async (customer: Omit<Customer, "id">): Promise<number> => {
    return await db.addCustomer({
      ...customer,
      isDeleted: false,
      deletedAt: null,
    });
  },

  update: async (customer: Customer): Promise<void> => {
    await db.updateCustomer(customer);
  },

  /** ---------------- SOFT DELETE ---------------- */

  remove: async (id: number): Promise<void> => {
    const customer = await db.getCustomerById(id);
    if (!customer) throw new Error("Customer not found");

    await db.updateCustomer({
      ...customer,
      isDeleted: true,
      deletedAt: Date.now(),
    });
  },

  restore: async (id: number): Promise<void> => {
    const customer = await db.getCustomerById(id);
    if (!customer) throw new Error("Customer not found");

    await db.updateCustomer({
      ...customer,
      isDeleted: false,
      deletedAt: null,
    });
  },

  permanentDelete: async (id: number): Promise<void> => {
    await db.deleteCustomer(id);
  },
};
