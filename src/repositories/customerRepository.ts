import { Customer } from "../db";

export interface CustomerRepository {
  getAll(): Promise<Customer[]>;
  getPaged(page: number, pageSize: number, query?: string | null): Promise<{ total: number; data: Customer[] }>;
  add(customer: Omit<Customer, "id">): Promise<number>;
  update(customer: Customer): Promise<void>;
  delete(id: number): Promise<void>;
  search(query: string): Promise<Customer[]>;
}
