export type Role = "admin" | "saleboy" | "Dev" | string;

export interface User {
  id?: number;
  Name: string;
  Mobile: string;
  Role: Role;
  Username: string;
  Password: string;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface Customer {
  id?: number;
  name: string;
  mobile: string;
  cnic?: string;
  address?: string;
  invoices?: number;
  payable?: number;
  paid?: number;
  balance?: number;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface Supplier {
  id?: number;
  name: string;
  mobile: string;
  cnic?: string;
  address?: string;
  invoices?: number;
  payable?: number;
  paid?: number;
  balance?: number;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface Item {
  id?: number;
  serverId?: number | string | null;
  name: string;
  barcode: string;
  brand: string;
  category: string;
  minunit: string;
  maxunit: string;
  ConvQty: number;
  purchasePrice: number;
  retailPrice: number;
  discountPrice?: number;
  wholesalePrice: number;
  description?: string;
  availableStock: number;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface Category {
  id?: number;
  name: string;
  itemCount: number;
}

export interface Brand {
  id?: number;
  name: string;
  itemCount: number;
}

export interface Unit {
  id?: number;
  name: string;
  itemCount: number;
}

export interface Discount {
  id?: number;
  name: string;
  type: "percentage" | "amount";
  value: number;
}

export interface Tax {
  id?: number;
  name: string;
  type: "percentage" | "amount";
  value: number;
}

export interface Expense {
  id?: number;
  date: string;
  category: string;
  amount: number;
  description?: string;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface ExpCateg {
  id?: number;
  category: string;
}

export interface Settings {
  id?: number;
  businessName: string;
  email: string;
  contact: string;
  address: string;
  logo?: string;
  cylBPrice: string;
  cylSPrice: string;
  cylDPrice: string;
  cylWPrice: string;
  printer: "pos" | "a4";
  language: "en" | "ur";
}

export interface CustomerPayment {
  id?: number;
  customerId: number;
  customerName: string;
  invoiceNo: string;
  amount: number;
  paymentDate: string;
  remarks?: string;
  payableSnapshot: number;
  balanceSnapshot: number;
}

export interface SupplierPayment {
  id?: number;
  supplierId: number;
  supplierName: string;
  invoiceNo: string;
  amount: number;
  paymentDate: string;
  remarks?: string;
  payableSnapshot: number;
  balanceSnapshot: number;
}

export interface DBSale {
  id?: number;
  invoiceNo: string;
  date: string;
  transactionType: "Sale" | "Purchase" | "Return" | "Quotation";
  customerId: number | null;
  supplierId: number | null;
  customerName: string;
  supplierName: string;
  subtotal: number;
  discount: number;
  tax: number;
  dues: number;
  grandTotal: number;
  paid: number;
  arrears: number;
  profit: number;
  isPostponed?: boolean;
}

export interface DBSaleItem {
  id?: number;
  saleId: number;
  originalItemId: number;
  name: string;
  qty: number;
  price: number;
  priceCategory: "Retail" | "Discount" | "Wholesale";
  discountType: "%" | "flat";
  discountValue: number;
  taxType: "%" | "flat";
  taxValue: number;
}

export interface DBHeld {
  id?: number;
  invoiceNo: string;
  date: string;
  transactionType: "Sale" | "Purchase" | "Return" | "Quotation";
  customerId: number | null;
  supplierId: number | null;
  customerName: string;
  supplierName: string;
  subtotal: number;
  discount: number;
  tax: number;
  grandTotal: number;
  paid: number;
  discountMode: "%" | "flat";
  discountValue: number;
  taxMode: "%" | "flat";
  taxValue: number;
  returnMode?: "customer" | "supplier";
  items: DBHeldItem[];
}

export interface DBHeldItem {
  id?: number;
  heldId: number;
  originalItemId: number;
  name: string;
  qty: number;
  price: number;
  convQty: number;
  priceCategory: "Retail" | "Discount" | "Wholesale";
  discountType: "%" | "flat";
  discountValue: number;
  taxType: "%" | "flat";
  taxValue: number;
  unitMode: "min" | "max";
  unit: string;
  costPrice?: number;
}

export interface ItemBatch {
  id?: number;
  serverId?: number | string | null;
  itemId: number;
  purchaseDate: string;
  qtyPurchased: number;
  qtySold: number;
  balance: number;
  costPrice: number;
  sourceSaleId: number;
  invoiceNo: string;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface Cylinder {
  id?: number;
  itemId: number;
  title: string;
  qtyInStock: number;
  filledCylinders: number;
  emptyCylinders: number;
  withCustomers: number;
  convQty: number;
  isDeleted: boolean;
  deletedAt: number | null;
}

export interface CylinderCustomer {
  id?: number;
  cylinderId: number;
  cylinderType: string;
  customerName: string;
  qtyHeld: number;
  isDeleted: boolean;
  deletedAt: number | null;
}
