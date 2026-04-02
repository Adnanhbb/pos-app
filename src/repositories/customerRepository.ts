// src/customersRepository.ts

import {
  Customer,
  getAllCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  searchCustomers,
  getCustomersPaged,
  getCustomerById,
} from "../db";

export type { Customer };

export const customersRepository = {

  /** -----------------------------
   *  ACTIVE CUSTOMERS
   *  ----------------------------- */

  /** Get all non-deleted customers */
  getAll: async (): Promise<Customer[]> => {
    const all = await getAllCustomers();
    return all.filter(c => !c.isDeleted);
  },

  /** Get customer by ID */
  getById: async (id: number): Promise<Customer | undefined> => {
    return await getCustomerById(id);
  },

  /** Get paged customers (non-deleted by default) */
  getPaged: async (
    page: number,
    pageSize: number,
    query?: string
  ) => {
    const { total, data } =
      await getCustomersPaged(page, pageSize, query ?? null);

    const filtered = data.filter(c => !c.isDeleted);

    return {
      total: filtered.length,
      data: filtered,
    };
  },

  /** Search customers (non-deleted only) */
  search: async (q: string): Promise<Customer[]> => {
    const all = await searchCustomers(q);
    return all.filter(c => !c.isDeleted);
  },

  /** -----------------------------
   *  DELETED CUSTOMERS (NEW)
   *  ----------------------------- */

  /** Get ONLY deleted customers */
  getDeleted: async (): Promise<Customer[]> => {
    const all = await getAllCustomers();
    return all.filter(c => c.isDeleted === true);
  },

  /** -----------------------------
   *  CREATE / UPDATE
   *  ----------------------------- */

  /** Create customer */
  create: async (customer: Omit<Customer, "id">): Promise<number> => {

    const cust: Omit<Customer, "id"> = {
      ...customer,
      isDeleted: false,
      deletedAt: null,
    };

    return await addCustomer(cust);
  },

  /** Update customer */
  update: async (customer: Customer): Promise<void> => {
    await updateCustomer(customer);
  },

  /** -----------------------------
   *  SOFT DELETE SYSTEM
   *  ----------------------------- */

  /** Soft delete */
  remove: async (id: number): Promise<void> => {
    const customer = await getCustomerById(id);
    if (!customer) throw new Error("Customer not found");

    await updateCustomer({
      ...customer,
      isDeleted: true,
      deletedAt: Date.now(),
    });
  },

  /** Restore deleted */
  restore: async (id: number): Promise<void> => {
    const customer = await getCustomerById(id);
    if (!customer) throw new Error("Customer not found");

    await updateCustomer({
      ...customer,
      isDeleted: false,
      deletedAt: null,
    });
  },

  /** Permanent delete */
  permanentDelete: async (id: number): Promise<void> => {
    await deleteCustomer(id);
  },
};