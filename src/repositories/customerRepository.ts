import {
  Customer,
  getAllCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  searchCustomers,
  getCustomersPaged,
  getCustomerById, // 👈 MUST exist in db.ts
} from "../db";

export type { Customer };

export const customersRepository = {
  getAll: async (): Promise<Customer[]> => {
    return await getAllCustomers();
  },

  getById: async (id: number): Promise<Customer | undefined> => {
    return await getCustomerById(id);
  },

  getPaged: async (page: number, pageSize: number, query?: string) => {
    return await getCustomersPaged(page, pageSize, query ?? null);
  },

  search: async (q: string): Promise<Customer[]> => {
    return await searchCustomers(q);
  },

  create: async (customer: Omit<Customer, "id">): Promise<number> => {
    return await addCustomer(customer);
  },

  update: async (customer: Customer): Promise<void> => {
    await updateCustomer(customer);
  },

  remove: async (id: number): Promise<void> => {
    await deleteCustomer(id);
  },
};
