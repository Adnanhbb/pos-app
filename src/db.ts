// src/db.ts
import { openDB, DBSchema, IDBPDatabase } from "idb";
import { StackId } from "recharts/types/util/ChartUtils";

/* ==========================================================
   DATA TYPES
   ========================================================== */

export type Role = "admin" | "saleboy" | string;

export interface User {
  id?: number;
  Name: string;
  Mobile: string;
  Role: Role;
  Username: string;
  Password: string;
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
}

export interface Item {
  id?: number;
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

/* NEW - Expenses model: Date stored as string per your choice (A) */
export interface Expense {
  id?: number;
  date: string; // stored as string, e.g. "2025-11-26"
  amount: number;
  description?: string;
}

/* ====================== Settings ====================== */
export interface Settings {
  id?: number;
  businessName: string;
  email: string;
  contact: string;
  address: string;
  logo?: string; // base64 image
  cylBPrice: string;
  cylSPrice: string
  cylDPrice: string,   
  cylWPrice: string,
}

export interface CustomerPayment {
  id?: number;
  customerId: number;
  customerName: string;
  invoiceNo: string;
  amount: number;
  paymentDate: string;        // ISO date string
  remarks?: string;
  payableSnapshot: number;    // payable at time of payment
  balanceSnapshot: number;    // balance after this payment
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
  profit:number;
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

/* ==========================================================
   DATABASE SCHEMA
   ========================================================== */

 interface POSDB extends DBSchema {
  users: {
    key: number;
    value: User;
    indexes: { "by-username": string; "by-role": string };
  };

  customers: {
    key: number;
    value: Customer;
    indexes: { "by-name": string; "by-mobile": string };
  };

  suppliers: {
    key: number;
    value: Supplier;
    indexes: { "by-name": string; "by-mobile": string };
  };

  items: {
    key: number;
    value: Item;
    indexes: {
      "by-name": string;
      "by-barcode": string;
      "by-brand": string;
      "by-category": string;
    };
  };

  categories: {
    key: number;
    value: Category;
    indexes: { "by-name": string };
  };

  brands: {
    key: number;
    value: Brand;
    indexes: { "by-name": string };
  };

  units: {
    key: number;
    value: Unit;
    indexes: { "by-name": string };
  };

  discounts: {
    key: number;
    value: Discount;
    indexes: { "by-name": string };
  };

  taxes: {
    key: number;
    value: Tax;
    indexes: { "by-name": string };
  };

  expenses: {
    key: number;
    value: Expense;
    indexes: { "by-date": string; "by-description": string };
  };

  settings: {
    key: number;
    value: Settings;
    indexes: { "by-businessName": string };
  };

  customer_payments: {
    key: number;
    value: CustomerPayment;
    indexes: { "by-customer": number; "by-date": string };
  };

  supplier_payments: {
    key: number;
    value: SupplierPayment;
    indexes: { "by-supplier": number; "by-date": string };
  };

  // Use 0 or -1 for walk-ins
    sales: {
      key: number;
      value: DBSale;
      indexes: {
        "by-customer": number;  // NO null
        "by-transactionType": DBSale["transactionType"];
        "by-invoiceNo": string;
      };
    };

  sale_items: {
    key: number;
    value: DBSaleItem;
    indexes: {
      "by-saleId": number;
    };
  };
}



/* ==========================================================
   INIT DB
   ========================================================== */

let _db: IDBPDatabase<POSDB> | null = null;

export async function initDB() {
  if (_db) return _db;

  _db = await openDB<POSDB>("POSDatabase", 10,{
    // bumped version to 9 to include expenses store
    upgrade(db, oldVersion, newVersion, transaction) {
      /* ---------------- USERS STORE ---------------- */
      if (!db.objectStoreNames.contains("users")) {
        const store = db.createObjectStore("users", { keyPath: "id", autoIncrement: true });
        store.createIndex("by-username", "Username");
        store.createIndex("by-role", "Role");

        // sample admin user
        store.add({
          Name: "Jawad",
          Mobile: "03000000000",
          Role: "admin",
          Username: "admin",
          Password: "1234",
        } as User);
      } else {
        const store = transaction.objectStore("users");
        try { store.index("by-username"); } catch { store.createIndex("by-username", "Username"); }
        try { store.index("by-role"); } catch { store.createIndex("by-role", "Role"); }
      }

      /* ---------------- CUSTOMERS STORE ---------------- */
      if (!db.objectStoreNames.contains("customers")) {
        const cstore = db.createObjectStore("customers", { keyPath: "id", autoIncrement: true });
        cstore.createIndex("by-name", "name");
        cstore.createIndex("by-mobile", "mobile");

        cstore.add({
          name: "Sample Customer",
          mobile: "03001234567",
          cnic: "12345-1234567-1",
          address: "Market Road",
          invoices: 0,
          payable: 0,
          paid: 0,
          balance: 0,
        } as Customer);
      } else {
        const cstore = transaction.objectStore("customers");
        try { cstore.index("by-name"); } catch { cstore.createIndex("by-name", "name"); }
        try { cstore.index("by-mobile"); } catch { cstore.createIndex("by-mobile", "mobile"); }
      }

      /* ---------------- SUPPLIERS STORE ---------------- */
      if (!db.objectStoreNames.contains("suppliers")) {
        const sstore = db.createObjectStore("suppliers", { keyPath: "id", autoIncrement: true });
        sstore.createIndex("by-name", "name");
        sstore.createIndex("by-mobile", "mobile");

        // optional seed sample supplier (comment/uncomment if you want)
        // sstore.add({
        //   name: "Sample Supplier",
        //   mobile: "03007654321",
        //   cnic: "",
        //   address: "Supplier Road",
        //   invoices: 0,
        //   payable: 0,
        //   paid: 0,
        //   balance: 0,
        // } as Supplier);
      } else {
        const sstore = transaction.objectStore("suppliers");
        try { sstore.index("by-name"); } catch { sstore.createIndex("by-name", "name"); }
        try { sstore.index("by-mobile"); } catch { sstore.createIndex("by-mobile", "mobile"); }
      }

      /* ---------------- ITEMS STORE ---------------- */
      if (!db.objectStoreNames.contains("items")) {
        const istore = db.createObjectStore("items", { keyPath: "id", autoIncrement: true });
        istore.createIndex("by-name", "name");
        istore.createIndex("by-barcode", "barcode");
        istore.createIndex("by-brand", "brand");
        istore.createIndex("by-category", "category");
      } else {
        const istore = transaction.objectStore("items");
        try { istore.index("by-name"); } catch { istore.createIndex("by-name", "name"); }
        try { istore.index("by-barcode"); } catch { istore.createIndex("by-barcode", "barcode"); }
        try { istore.index("by-brand"); } catch { istore.createIndex("by-brand", "brand"); }
        try { istore.index("by-category"); } catch { istore.createIndex("by-category", "category"); }
      }

      /* ---------------- CATEGORIES STORE ---------------- */
      if (!db.objectStoreNames.contains("categories")) {
        const store = db.createObjectStore("categories", { keyPath: "id", autoIncrement: true });
        store.createIndex("by-name", "name");
      } else {
        const store = transaction.objectStore("categories");
        try { store.index("by-name"); } catch { store.createIndex("by-name", "name"); }
      }

      /* ---------------- BRANDS STORE ---------------- */
      if (!db.objectStoreNames.contains("brands")) {
        const store = db.createObjectStore("brands", { keyPath: "id", autoIncrement: true });
        store.createIndex("by-name", "name");
      } else {
        const store = transaction.objectStore("brands");
        try { store.index("by-name"); } catch { store.createIndex("by-name", "name"); }
      }

      /* ---------------- UNITS STORE ---------------- */
      if (!db.objectStoreNames.contains("units")) {
        const store = db.createObjectStore("units", { keyPath: "id", autoIncrement: true });
        store.createIndex("by-name", "name");
      } else {
        const store = transaction.objectStore("units");
        try { store.index("by-name"); } catch { store.createIndex("by-name", "name"); }
      }

      /* ---------------- DISCOUNTS STORE ---------------- */
      if (!db.objectStoreNames.contains("discounts")) {
        const store = db.createObjectStore("discounts", { keyPath: "id", autoIncrement: true });
        store.createIndex("by-name", "name");
      } else {
        const store = transaction.objectStore("discounts");
        try { store.index("by-name"); } catch { store.createIndex("by-name", "name"); }
      }

      /* ---------------- TAXES STORE ---------------- */
      if (!db.objectStoreNames.contains("taxes")) {
        const store = db.createObjectStore("taxes", { keyPath: "id", autoIncrement: true });
        store.createIndex("by-name", "name");
      } else {
        const store = transaction.objectStore("taxes");
        try { store.index("by-name"); } catch { store.createIndex("by-name", "name"); }
      }

      /* ---------------- EXPENSES STORE ---------------- */
      if (!db.objectStoreNames.contains("expenses")) {
        const store = db.createObjectStore("expenses", { keyPath: "id", autoIncrement: true });
        // indexes to help search/filter by date or description
        store.createIndex("by-date", "date");
        store.createIndex("by-description", "description");
      } else {
        const store = transaction.objectStore("expenses");
        try { store.index("by-date"); } catch { store.createIndex("by-date", "date"); }
        try { store.index("by-description"); } catch { store.createIndex("by-description", "description"); }
      }

      /* ---------------- SETTINGS STORE ---------------- */
if (!db.objectStoreNames.contains("settings")) {
  const store = db.createObjectStore("settings", { keyPath: "id", autoIncrement: true });
  store.createIndex("by-businessName", "businessName");
} else {
  const store = transaction.objectStore("settings");
  try { store.index("by-businessName"); } catch { store.createIndex("by-businessName", "businessName"); }
}

/* ---------------- CUSTOMER PAYMENTS STORE ---------------- */
if (!db.objectStoreNames.contains("customer_payments")) {
  const store = db.createObjectStore("customer_payments", {
    keyPath: "id",
    autoIncrement: true,
  });
  store.createIndex("by-customer", "customerId");
  store.createIndex("by-date", "paymentDate");
}

/* ---------------- Supplier PAYMENTS STORE ---------------- */
if (!db.objectStoreNames.contains("supplier_payments")) {
  const store = db.createObjectStore("supplier_payments", {
    keyPath: "id",
    autoIncrement: true,
  });
  store.createIndex("by-supplier", "supplierId");
  store.createIndex("by-date", "paymentDate");
}

// SALES
if (!db.objectStoreNames.contains("sales")) {
  const store = db.createObjectStore("sales", {
    keyPath: "id",
    autoIncrement: true,
  });

  store.createIndex("by-customer", "customerId");

  // ✅ NEW — safe index for ALL invoices
  store.createIndex("by-transactionType", "transactionType");
  store.createIndex("by-invoiceNo", "invoiceNo");
}


// SALE ITEMS
if (!db.objectStoreNames.contains("sale_items")) {
  const store = db.createObjectStore("sale_items", {
    keyPath: "id",
    autoIncrement: true,
  });

  store.createIndex("by-saleId", "saleId");
}


    },
  });

  return _db;
}

/* ==========================================================
   USERS API
   ========================================================== */

export async function validateUser(username: string, password: string, role?: Role): Promise<User | null> {
  const db = await initDB();
  const idx = db.transaction("users").objectStore("users").index("by-username");
  const matches = await idx.getAll(username);
  for (const u of matches) {
    if (u.Username === username && u.Password === password) {
      if (!role || u.Role === role) return u;
    }
  }
  const all = await db.getAll("users");
  const found = all.find(
    (u) =>
      u.Username === username &&
      u.Password === password &&
      (!role || u.Role === role)
  );
  return found ?? null;
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const db = await initDB();
  const idx = db.transaction("users").objectStore("users").index("by-username");
  const matches = await idx.getAll(username);
  return matches[0] ?? null;
}

export async function getAllUsers(): Promise<User[]> {
  const db = await initDB();
  return await db.getAll("users");
}

export async function addUser(user: Omit<User, "id">): Promise<number> {
  const db = await initDB();
  return (await db.add("users", user as User)) as number;
}

export async function updateUser(user: User): Promise<void> {
  if (!user.id) throw new Error("updateUser requires user.id");
  const db = await initDB();
  await db.put("users", user);
}

export async function deleteUser(id: number): Promise<void> {
  const db = await initDB();
  await db.delete("users", id);
}

export async function searchUsers(q: string): Promise<User[]> {
  const all = await getAllUsers();
  if (!q) return all;
  const s = q.trim().toLowerCase();
  return all.filter(
    (u) =>
      u.Name.toLowerCase().includes(s) ||
      u.Username.toLowerCase().includes(s) ||
      u.Mobile.toLowerCase().includes(s) ||
      u.Role.toLowerCase().includes(s)
  );
}

export async function getUsersPaged(
  page: number,
  pageSize: number,
  sortBy: keyof User | null = "Name",
  sortDir: "asc" | "desc" = "asc",
  filterRole: Role | null = null,
  query: string | null = null
) {
  const all = await getAllUsers();
  let data = all.slice();
  if (filterRole) data = data.filter((d) => d.Role === filterRole);
  if (query) {
    const q = query.trim().toLowerCase();
    data = data.filter(
      (u) =>
        u.Name.toLowerCase().includes(q) ||
        u.Username.toLowerCase().includes(q) ||
        u.Mobile.toLowerCase().includes(q)
    );
  }
  if (sortBy) {
    data.sort((a, b) => {
      const A = ((a as any)[sortBy] ?? "").toString().toLowerCase();
      const B = ((b as any)[sortBy] ?? "").toString().toLowerCase();
      if (A < B) return sortDir === "asc" ? -1 : 1;
      if (A > B) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }
  const total = data.length;
  const start = (page - 1) * pageSize;
  const pageData = data.slice(start, start + pageSize);
  return { total, data: pageData };
}

/* ==========================================================
   CUSTOMERS API
   ========================================================== */

export async function getAllCustomers() {
  const db = await initDB();
  return await db.getAll("customers");
}

export async function addCustomer(customer: Omit<Customer, "id">) {
  const db = await initDB();
  const newCustomer: Customer = {
    invoices: 0,
    payable: 0,
    paid: 0,
    balance: 0,
    ...customer, // spread last so user values are used if provided
  };
  return (await db.add("customers", newCustomer)) as number;
}


export async function updateCustomer(customer: Customer) {
  if (!customer.id) throw new Error("updateCustomer requires customer.id");
  const db = await initDB();
  const updated: Customer = {
    invoices: customer.invoices ?? 0,
    payable: customer.payable ?? 0,
    paid: customer.paid ?? 0,
    balance: customer.balance ?? 0,
    ...customer, // spread last so numeric values from form are preserved
  };
  await db.put("customers", updated);
}


export async function deleteCustomer(id: number) {
  const db = await initDB();
  await db.delete("customers", id);
}

export async function searchCustomers(q: string) {
  const all = await getAllCustomers();
  if (!q) return all;
  const s = q.trim().toLowerCase();
  return all.filter(
    (c) =>
      c.name.toLowerCase().includes(s) ||
      c.mobile.toLowerCase().includes(s) ||
      (c.cnic ?? "").toLowerCase().includes(s) ||
      (c.address ?? "").toLowerCase().includes(s)
  );
}

export async function getCustomersPaged(page: number, pageSize: number, query: string | null = null) {
  let data = await getAllCustomers();
  if (query) {
    const q = query.trim().toLowerCase();
    data = data.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.mobile.toLowerCase().includes(q) ||
        (c.cnic ?? "").toLowerCase().includes(q) ||
        (c.address ?? "").toLowerCase().includes(q)
    );
  }
  const total = data.length;
  const start = (page - 1) * pageSize;
  const pageData = data.slice(start, start + pageSize);
  return { total, data: pageData };
}

/* ==========================================================
   SUPPLIERS API (same structure as Customers)
   ========================================================== */

export async function getAllSuppliers() {
  const db = await initDB();
  return await db.getAll("suppliers");
}

export async function addSupplier(supplier: Omit<Supplier, "id">) {
  const db = await initDB();
  const newSupplier: Supplier = {
    invoices: supplier.invoices ?? 0,
    payable: supplier.payable ?? 0,
    paid: supplier.paid ?? 0,
    balance: supplier.balance ?? supplier.payable ?? 0, // <-- set balance = payable if not provided
    ...supplier, // preserve user-entered values
  };
  return (await db.add("suppliers", newSupplier)) as number;
}


export async function updateSupplier(supplier: Supplier) {
  if (!supplier.id) throw new Error("updateSupplier requires supplier.id");
  const db = await initDB();
  const existing = await db.get("suppliers", supplier.id);
  if (!existing) throw new Error("Supplier not found");

  const updated: Supplier = {
    invoices: supplier.invoices ?? existing.invoices ?? 0,
    payable: supplier.payable ?? existing.payable ?? 0,
    paid: supplier.paid ?? existing.paid ?? 0,
    balance: supplier.balance ?? existing.balance ?? 0,
    ...supplier
  };

  await db.put("suppliers", updated);
}


export async function deleteSupplier(id: number) {
  const db = await initDB();
  await db.delete("suppliers", id);
}

export async function searchSuppliers(q: string) {
  const all = await getAllSuppliers();
  if (!q) return all;
  const s = q.trim().toLowerCase();
  return all.filter(
    (c) =>
      c.name.toLowerCase().includes(s) ||
      c.mobile.toLowerCase().includes(s) ||
      (c.cnic ?? "").toLowerCase().includes(s) ||
      (c.address ?? "").toLowerCase().includes(s)
  );
}

export async function updateSupplierPayment(
  id: number,
  supplierId: number,
  amount: number,
  paymentDate: string,
  remarks: string = "",
  payableSnapshot?: number
) {
  const db = await initDB();
  const supplier = await db.get("suppliers", supplierId);
  if (!supplier) throw new Error("Supplier not found");

  // Determine the current payable for this payment
  const currentPayable = payableSnapshot ?? supplier.payable ?? 0;

  // Compute new balance
  // We assume this is replacing an existing payment, so adjust old payment if needed
  const existingPayment: SupplierPayment | undefined = await db.get("supplier_payments", id);
  const oldAmount = existingPayment?.amount ?? 0;

  // New balance = old balance + old payment - new payment
  const previousBalance = supplier.balance ?? currentPayable;
  const balanceSnapshot = previousBalance + oldAmount - amount;

  // Save the updated payment
  await db.put("supplier_payments", {
    id,
    supplierId,
    amount,
    paymentDate,
    remarks,
    payableSnapshot: currentPayable,
    balanceSnapshot,
  } as SupplierPayment);

  // Update supplier totals
  const newPaid = (supplier.paid ?? 0) - oldAmount + amount;
  const newBalance = (supplier.payable ?? 0) - newPaid;

  await db.put("suppliers", {
    ...supplier,
    paid: newPaid,
    balance: balanceSnapshot,
  });
}

export async function getSuppliersPaged(page: number, pageSize: number, query: string | null = null) {
  let data = await getAllSuppliers();
  if (query) {
    const q = query.trim().toLowerCase();
    data = data.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.mobile.toLowerCase().includes(q) ||
        (c.cnic ?? "").toLowerCase().includes(q) ||
        (c.address ?? "").toLowerCase().includes(q)
    );
  }
  const total = data.length;
  const start = (page - 1) * pageSize;
  const pageData = data.slice(start, start + pageSize);
  return { total, data: pageData };
}

/* ==========================================================
   ITEMS API
   ========================================================== */

export async function getAllItems(): Promise<Item[]> {
  const db = await initDB();
  return await db.getAll("items");
}

export async function addItem(item: Omit<Item, "id">): Promise<number> {
  const db = await initDB();
  return (await db.add("items", item as Item)) as number;
}

export async function updateItem(item: Item): Promise<void> {
  if (!item.id) throw new Error("updateItem requires item.id");
  const db = await initDB();
  await db.put("items", item);
}

export async function deleteItem(id: number): Promise<void> {
  const db = await initDB();
  await db.delete("items", id);
}

export async function searchItems(q: string): Promise<Item[]> {
  const all = await getAllItems();
  if (!q) return all;
  const s = q.toLowerCase();
  return all.filter(
    (i) =>
      i.name.toLowerCase().includes(s) ||
      i.barcode.toLowerCase().includes(s) ||
      i.brand.toLowerCase().includes(s) ||
      i.category.toLowerCase().includes(s)
  );
}

export async function getItemsPaged(page: number, pageSize: number, query: string | null = null): Promise<{ total: number; data: Item[] }> {
  let data = await getAllItems();
  if (query) {
    const q = query.trim().toLowerCase();
    data = data.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.barcode.toLowerCase().includes(q) ||
        i.brand.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q)
    );
  }
  const total = data.length;
  const start = (page - 1) * pageSize;
  const pageData = data.slice(start, start + pageSize);
  return { total, data: pageData };
}

/* ==========================================================
   CATEGORIES API
   ========================================================== */

export async function getAllCategories(): Promise<Category[]> {
  const db = await initDB();
  return await db.getAll("categories");
}

export async function addCategory(category: Omit<Category, "id">): Promise<number> {
  const db = await initDB();
  return await db.add("categories", category as Category) as number;
}

export async function updateCategory(category: Category): Promise<void> {
  if (!category.id) throw new Error("updateCategory requires id");
  const db = await initDB();
  await db.put("categories", category);
}

export async function deleteCategory(id: number): Promise<void> {
  const db = await initDB();
  await db.delete("categories", id);
}

/* ==========================================================
   BRANDS API
   ========================================================== */

export async function getBrands(): Promise<Brand[]> {
  const db = await initDB();
  return await db.getAll("brands");
}

export async function addBrand(brand: Omit<Brand, "id">): Promise<number> {
  const db = await initDB();
  return await db.add("brands", brand as Brand) as number;
}

export async function updateBrand(brand: Brand): Promise<void> {
  if (!brand.id) throw new Error("updateBrand requires id");
  const db = await initDB();
  await db.put("brands", brand);
}

export async function deleteBrand(id: number): Promise<void> {
  const db = await initDB();
  await db.delete("brands", id);
}

/* ==========================================================
   UNITS API
   ========================================================== */

export async function getUnits(): Promise<Unit[]> {
  const db = await initDB();
  return await db.getAll("units");
}

export async function addUnit(unit: Omit<Unit, "id">): Promise<number> {
  const db = await initDB();
  return await db.add("units", unit as Unit) as number;
}

export async function updateUnit(unit: Unit): Promise<void> {
  if (!unit.id) throw new Error("updateUnit requires id");
  const db = await initDB();
  await db.put("units", unit);
}

export async function deleteUnit(id: number): Promise<void> {
  const db = await initDB();
  await db.delete("units", id);
}

/* ==========================================================
   DISCOUNTS API
   ========================================================== */

export async function getAllDiscounts(): Promise<Discount[]> {
  const db = await initDB();
  return await db.getAll("discounts");
}

export async function addDiscount(discount: Omit<Discount, "id">): Promise<number> {
  const db = await initDB();
  return await db.add("discounts", discount as Discount) as number;
}

export async function updateDiscount(discount: Discount): Promise<void> {
  if (!discount.id) throw new Error("updateDiscount requires discount.id");
  const db = await initDB();
  await db.put("discounts", discount);
}

export async function deleteDiscount(id: number): Promise<void> {
  const db = await initDB();
  await db.delete("discounts", id);
}

export async function searchDiscounts(q: string): Promise<Discount[]> {
  const all = await getAllDiscounts();
  if (!q) return all;
  const s = q.trim().toLowerCase();
  return all.filter(d => d.name.toLowerCase().includes(s));
}

/* ==========================================================
   TAXES API
   ========================================================== */

export async function getAllTaxes(): Promise<Tax[]> {
  const db = await initDB();
  return await db.getAll("taxes");
}

export async function addTax(tax: Omit<Tax, "id">): Promise<number> {
  const db = await initDB();
  return await db.add("taxes", tax as Tax) as number;
}

export async function updateTax(tax: Tax): Promise<void> {
  if (!tax.id) throw new Error("updateTax requires tax.id");
  const db = await initDB();
  await db.put("taxes", tax);
}

export async function deleteTax(id: number): Promise<void> {
  const db = await initDB();
  await db.delete("taxes", id);
}

export async function searchTaxes(q: string): Promise<Tax[]> {
  const all = await getAllTaxes();
  if (!q) return all;
  const s = q.trim().toLowerCase();
  return all.filter(t => t.name.toLowerCase().includes(s));
}

/* ==========================================================
   EXPENSES API
   ========================================================== */

export async function getAllExpenses(): Promise<Expense[]> {
  const db = await initDB();
  return await db.getAll("expenses");
}

export async function addExpense(expense: Omit<Expense, "id">): Promise<number> {
  const db = await initDB();
  // basic normalization/validation
  const e: Expense = {
    date: expense.date,
    amount: Number(expense.amount || 0),
    description: expense.description || "",
  };
  return (await db.add("expenses", e as Expense)) as number;
}

export async function updateExpense(expense: Expense): Promise<void> {
  if (!expense.id) throw new Error("updateExpense requires expense.id");
  const db = await initDB();
  const e: Expense = {
    id: expense.id,
    date: expense.date,
    amount: Number(expense.amount || 0),
    description: expense.description || "",
  };
  await db.put("expenses", e);
}

export async function deleteExpense(id: number): Promise<void> {
  const db = await initDB();
  await db.delete("expenses", id);
}

export async function searchExpenses(q: string): Promise<Expense[]> {
  const all = await getAllExpenses();
  if (!q) return all;
  const s = q.trim().toLowerCase();
  return all.filter(e =>
    (e.description ?? "").toLowerCase().includes(s) ||
    (e.date ?? "").toLowerCase().includes(s) ||
    String(e.amount).toLowerCase().includes(s)
  );
}

// Settings API
export async function getSettings(): Promise<Settings | null> {
  const db = await initDB();
  const all = await db.getAll("settings");
  return all[0] ?? null;
}

export async function saveSettings(settings: Omit<Settings, "id">) {
  const db = await initDB();
  const existing = await getSettings();
  if (existing) {
    await db.put("settings", { ...existing, ...settings });
  } else {
    await db.add("settings", settings as Settings);
  }
}

/**
 * Paged expenses with optional query (search by date/description/amount)
 * returns { total, data }
 */
export async function getExpensesPaged(page: number, pageSize: number, query: string | null = null): Promise<{ total: number; data: Expense[] }> {
  let data = await getAllExpenses();
  if (query) {
    const q = query.trim().toLowerCase();
    data = data.filter(
      (e) =>
        (e.description ?? "").toLowerCase().includes(q) ||
        (e.date ?? "").toLowerCase().includes(q) ||
        String(e.amount).toLowerCase().includes(q)
    );
  }

  // sort by date descending (recent first) if dates look like ISO strings; otherwise keep insertion order
  try {
    data.sort((a, b) => {
      const da = new Date(a.date).getTime() || 0;
      const dbt = new Date(b.date).getTime() || 0;
      return dbt - da;
    });
  } catch {
    // ignore sort errors
  }

  const total = data.length;
  const start = (page - 1) * pageSize;
  const pageData = data.slice(start, start + pageSize);
  return { total, data: pageData };
}

/* ==========================================================
   CUSTOMER PAYMENTS API
   ========================================================== */

export async function getAllCustomerPayments(): Promise<CustomerPayment[]> {
  const db = await initDB();
  return await db.getAll("customer_payments");
}

export async function getCustomerPaymentsByCustomer(customerId: number): Promise<CustomerPayment[]> {
  const db = await initDB();
  const idx = db
    .transaction("customer_payments")
    .objectStore("customer_payments")
    .index("by-customer");
  return await idx.getAll(customerId);
}

export async function deleteCustomerPayment(id: number) {
  const db = await initDB();
  const payment = await db.get("customer_payments", id);
  if (!payment) return;

  // adjust customer totals
  const customer = await db.get("customers", payment.customerId);
  if (customer) {
    const newPaid = (customer.paid ?? 0) - payment.amount;
    const newBalance = (customer.payable ?? 0) - newPaid;
    await db.put("customers", { ...customer, paid: newPaid, balance: newBalance });
  }

  await db.delete("customer_payments", id);
}

export async function updateCustomerPayment(
  id: number,
  customerId: number,
  amount: number,
  paymentDate: string,
  remarks: string,
  payableSnapshot?: number
) {
  const db = await initDB();
  const customer = await db.get("customers", customerId);
  if (!customer) throw new Error("Customer not found");

  const currentPayable = payableSnapshot ?? (customer.balance ?? 0);
  const newPaid = amount; // assume editing replaces old amount
  const balanceSnapshot = currentPayable - newPaid;

  await db.put("customer_payments", {
    id,
    customerId,
    amount,
    paymentDate,
    remarks,
    payableSnapshot: currentPayable,
    balanceSnapshot,
  } as CustomerPayment);

  await db.put("customers", {
    ...customer,
    paid: newPaid,
    balance: balanceSnapshot,
  });
}

export async function addCustomerPayment(
  customerId: number,
  amount: number,
  paymentDate: string,
  remarks: string = "",
  payableSnapshot?: number // optional
) {
  const db = await initDB();
  const customer = await db.get("customers", customerId);
  if (!customer) throw new Error("Customer not found");
  
  const currentBalance = customer.balance ?? 0;
  const currentPayable = payableSnapshot ?? currentBalance;

  const newPaid = (customer.paid ?? 0) + amount;
  const newBalance = currentBalance - amount;

  await db.add("customer_payments", {
    customerId,
    amount,
    paymentDate,
    remarks,
    payableSnapshot: currentPayable,
    balanceSnapshot: newBalance,
  } as CustomerPayment);

  await db.put("customers", {
    ...customer,
    paid: newPaid,
    balance: newBalance,
  });
}

/* ==========================================================
   Supplier PAYMENTS API
   ========================================================== */
export async function getAllSupplierPayments(): Promise<SupplierPayment[]> {
  const db = await initDB();
  return await db.getAll("supplier_payments");
}

export async function addSupplierPayment(
  supplierId: number,
  amount: number,
  paymentDate: string,
  remarks: string = "",
  payableSnapshot: number,
  balanceSnapshot: number
) {
  const db = await initDB();
  const supplier = await db.get("suppliers", supplierId);
  if (!supplier) throw new Error("Supplier not found");

  // ✅ Save the payment record only
  await db.add("supplier_payments", {
    supplierId,
    amount,
    paymentDate,
    remarks,
    payableSnapshot,
    balanceSnapshot,
  } as SupplierPayment);

  // ❌ Do NOT update supplier.paid here anymore
  // handleCompleteTransaction() will update paid & balance
}

export async function deleteSupplierPayment(id: number) {
  const db = await initDB();
  const payment = await db.get("supplier_payments", id);
  if (!payment) return;

  const supplier = await db.get("suppliers", payment.supplierId);
  if (supplier) {
    const newPaid = (supplier.paid ?? 0) - payment.amount;
    const newBalance = (supplier.payable ?? 0) - newPaid;
    await db.put("suppliers", { ...supplier, paid: newPaid, balance: newBalance });
  }

  await db.delete("supplier_payments", id);
}

export async function completeSaleFull(
  customerId: number | null,
  cartItems: {
    originalItemId: number;
    name: string;
    qty: number;
    price: number;
    priceCategory: "Retail" | "Discount" | "Wholesale";
    discountType: "%" | "flat";
    discountValue: number;
    taxType: "%" | "flat";
    taxValue: number;
  }[],
  paid: number,
  transactionType: "Sale" | "Purchase" | "Return" | "Quotation" = "Sale"
) {
  if (cartItems.length === 0) throw new Error("Cart is empty");

  const db = await initDB();

  // 1️⃣ Calculate totals
  let subtotal = 0;
  let totalDiscount = 0;
  let totalTax = 0;

  for (const item of cartItems) {
    subtotal += item.qty * item.price;

    const discountAmount =
      item.discountType === "%"
        ? (item.qty * item.price * item.discountValue) / 100
        : item.discountValue;
    totalDiscount += discountAmount;

    const taxAmount =
      item.taxType === "%"
        ? ((item.qty * item.price - discountAmount) * item.taxValue) / 100
        : item.taxValue;
    totalTax += taxAmount;
  }

  const grandTotal = subtotal - totalDiscount + totalTax;
  const arrears = grandTotal - paid;

  // 2️⃣ Generate invoice number (simple auto-increment)
  const lastSale = (await db.getAll("sales")).slice(-1)[0];
  const invoiceNo = lastSale ? `INV-${Number(lastSale.id ?? 0) + 1}` : "INV-1";

  // 3️⃣ Add sale record
  const saleId = await db.add("sales", {
    invoiceNo,
    date: new Date().toISOString(),
    transactionType,
    customerId,
    subtotal,
    discount: totalDiscount,
    tax: totalTax,
    grandTotal,
    paid,
    arrears,
  } as DBSale);

  // 4️⃣ Add each sale item and update stock
  for (const item of cartItems) {
    await db.add("sale_items", {
      saleId,
      ...item,
    } as DBSaleItem);

    // update stock if this is a Sale (not Purchase/Return)
    if (transactionType === "Sale") {
      const dbItem = await db.get("items", item.originalItemId);
      if (dbItem) {
        await db.put("items", {
          ...dbItem,
          availableStock: (dbItem.availableStock ?? 0) - item.qty,
        });
      }
    }
  }

  // 5️⃣ Update customer totals
  if (customerId) {
    const customer = await db.get("customers", customerId);
    if (customer) {
      await db.put("customers", {
        ...customer,
        invoices: (customer.invoices ?? 0) + 1,
        paid: (customer.paid ?? 0) + paid,
        balance: (customer.balance ?? 0) + arrears,
      });
    }
  }

  return { saleId, invoiceNo, grandTotal, arrears };
}

/* ==========================================================
   GET SINGLE RECORD BY ID
   ========================================================== */

export async function getCustomerById(id: number): Promise<Customer | undefined> {
  const conn = await db.open();

  return new Promise(resolve => {
    const tx = conn.transaction("customers", "readonly");
    const store = tx.objectStore("customers");
    const req = store.get(id);

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

export async function getSupplierById(id: number): Promise<Supplier | undefined> {
  const conn = await db.open();

  return new Promise(resolve => {
    const tx = conn.transaction("suppliers", "readonly");
    const store = tx.objectStore("suppliers");
    const req = store.get(id);

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

export async function getItemById(id: number): Promise<Item | null> {
  const db = await initDB();
  const item = await db.get("items", id);
  return item ?? null;
}

const DB_NAME = "POSDatabase";
const DB_VERSION = 10;

class Database {
  private conn: IDBDatabase | null = null;

  async open(): Promise<IDBDatabase> {
    if (this.conn) return this.conn;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const conn = request.result;

        if (!conn.objectStoreNames.contains("customer_payments")) {
            conn.createObjectStore("customer_payments", {
              keyPath: "id",
              autoIncrement: true,
            });
          }

        if (!conn.objectStoreNames.contains("sales")) {
          conn.createObjectStore("sales", {
            keyPath: "id",
            autoIncrement: true,
          });
        }

        if (!conn.objectStoreNames.contains("sale_items")) {
          const store = conn.createObjectStore("sale_items", {
            keyPath: "id",
            autoIncrement: true,
          });
          store.createIndex("saleId", "saleId");
        }

          // customers store
  if (!conn.objectStoreNames.contains("customers")) {
    conn.createObjectStore("customers", { keyPath: "id", autoIncrement: true });
  }

  // customer_payments store
  if (!conn.objectStoreNames.contains("customer_payments")) {
    const store = conn.createObjectStore("customer_payments", { keyPath: "id", autoIncrement: true });
    store.createIndex("customerId", "customerId");
  }
      };

      request.onsuccess = () => {
        this.conn = request.result;
        resolve(this.conn);
      };

      request.onerror = () => reject(request.error);
    });
  }}
export const db = new Database();


