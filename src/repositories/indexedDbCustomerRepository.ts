import * as db from "../db";
import { CustomerRepository } from "./customerRepository";
import { Customer } from "../db";

export const indexedDbCustomerRepository: CustomerRepository = {
  getAll: db.getAllCustomers,
  getPaged: db.getCustomersPaged,
  add: db.addCustomer,
  update: db.updateCustomer,
  delete: db.deleteCustomer,
  search: db.searchCustomers,
};
