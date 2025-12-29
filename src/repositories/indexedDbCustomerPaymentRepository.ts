import { initDB, CustomerPayment, addCustomerPayment, updateCustomerPayment, deleteCustomerPayment, getAllCustomerPayments, getCustomerPaymentsByCustomer } from "../db";
import { CustomerPaymentRepository } from "./customerPaymentRepository";

export const indexedDbCustomerPaymentRepository: CustomerPaymentRepository = {
  getAll: async () => {
    return getAllCustomerPayments();
  },

  getByCustomer: async (customerId) => {
    return getCustomerPaymentsByCustomer(customerId);
  },

  add: async (customerId, amount, paymentDate, remarks = "", payableSnapshot) => {
    return addCustomerPayment(customerId, amount, paymentDate, remarks, payableSnapshot);
  },

  update: async (id, customerId, amount, paymentDate, remarks, payableSnapshot) => {
    return updateCustomerPayment(id, customerId, amount, paymentDate, remarks, payableSnapshot);
  },

  delete: async (id) => {
    return deleteCustomerPayment(id);
  }
};
