// src/repositories/indexedDBCustomerRepository.ts

import * as db from "../db";
import type { Customer } from "../db";
import { customersRepository } from "./customerRepository";

/**
 * IndexedDB-backed implementation of customersRepository.
 * This MUST exactly match the customersRepository contract.
 */
export const indexedDbCustomerRepository: typeof customersRepository = {
  getAll: async (): Promise<Customer[]> => {
    return await db.getAllCustomers();
  },

  getById: async (id: number): Promise<Customer | undefined> => {
    return await db.getCustomerById(id);
  },

  getPaged: async (page: number, pageSize: number, query?: string) => {
    return await db.getCustomersPaged(page, pageSize, query ?? null);
  },

  search: async (q: string): Promise<Customer[]> => {
    return await db.searchCustomers(q);
  },

  create: async (customer: Omit<Customer, "id">): Promise<number> => {
    return await db.addCustomer(customer);
  },

  update: async (customer: Customer): Promise<void> => {
    await db.updateCustomer(customer);
  },

  remove: async (id: number): Promise<void> => {
    await db.deleteCustomer(id);
  },
};
