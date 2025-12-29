import { CustomerPayment } from "../db";

export interface CustomerPaymentRepository {
  getAll(): Promise<CustomerPayment[]>;
  getByCustomer(customerId: number): Promise<CustomerPayment[]>;
  add(customerId: number, amount: number, paymentDate: string, remarks?: string, payableSnapshot?: number): Promise<void>;
  update(id: number, customerId: number, amount: number, paymentDate: string, remarks: string, payableSnapshot?: number): Promise<void>;
  delete(id: number): Promise<void>;
}
