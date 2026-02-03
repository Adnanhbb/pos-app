// src/POS.tsx
import React, { useEffect, useMemo, useState,useRef } from "react";
import { FaBarcode, FaEdit, FaTrash, FaTimes, FaCheck, FaPlus } from "react-icons/fa";

// 🔹 DB INTEGRATION
import { itemsRepository } from "./repositories/itemsRepository";
import { customersRepository } from "./repositories/customerRepository";
import { SupplierRepository } from "./repositories/suppliersRepository";
import { categoriesRepository } from "./repositories/categoriesRepository";
import { brandsRepository } from "./repositories/brandsRepository";
import type { Brand, Category,Item } from "./db";
import { salesRepository } from "./repositories/salesRepository";
import { customerPaymentRepository } from "./repositories/customerPaymentRepository";
import { discountRepository } from "./repositories/discountRepository";
import { taxRepository } from "./repositories/taxRepository";
import type { Discount, Tax } from "./db";

// =====================
// Types
// =====================
type UnitType = "min" | "max";

type CartItem = {
  id: number;
  name: string;

  /** Quantity is ALWAYS stored in MIN UNIT */
  qty: number;

  /** Selected unit in UI */
  unit: UnitType;

  /** Base price per MIN UNIT */
  minUnitPrice: number;

  /** Conversion info */
  convQty: number;
  minunit: string;
  maxunit: string;

  /** Existing pricing & tax fields */
  costPrice: number;
  discountType: "%" | "flat";
  discountValue: number;
  taxType: "%" | "flat";
  taxValue: number;

  originalItemId: number;
  priceCategory: "Retail" | "Discount" | "Wholesale";

  uiDeductedQty: number;
};


type Customer = {
  id: number;
  name: string;
  phone?: string;
  arrears: number;
  invoices?: number;
};

interface InvoiceAdjustmentModalProps {
  type: "discount" | "tax";
  isOpen: boolean;
  onClose: () => void;
  onApply: (data: {
    id: number;
    name: string;
    type: "percentage" | "Fixed Amount";
    value: number;
  }) => void;
}

/**
 * Normalize price to MIN UNIT
 */
export function normalizeToMinUnit(
  price: number,
  unit: UnitType,
  convQty: number
): number {
  return unit === "max" ? price / convQty : price;
}

/**
 * Convert normalized min-unit price to display unit
 */
export function priceForDisplay(
  minUnitPrice: number,
  unit: UnitType,
  convQty: number
): number {
  return unit === "max" ? minUnitPrice * convQty : minUnitPrice;
}

/**
 * Calculate total
 */
export function calculateTotal(
  qty: number,
  minUnitPrice: number
): number {
  return qty * minUnitPrice;
}

// =====================
// Helpers
// =====================

function calcLine(item: CartItem) {
  const base = item.qty * item.minUnitPrice;
  const discount =
    item.discountType === "%" ? (base * item.discountValue) / 100 : item.discountValue;
  const afterDiscount = Math.max(0, base - discount);
  const tax = item.taxType === "%" ? (afterDiscount * item.taxValue) / 100 : item.taxValue;
  const total = afterDiscount + tax;
  return { base, discount, tax, total };
}

function getNextInvoiceNo(current: string) {
  const num = parseInt(current.split("-")[1], 10);
  const nextNum = num + 1;
  return `SAL-${String(nextNum).padStart(4, "0")}`;
}

function applyAdjustment(
  base: number,
  adj: { type: "percentage" | "Fixed Amount"; value: number } | null
) {
  if (!adj) return 0;
  return adj.type === "percentage"
    ? (base * adj.value) / 100
    : adj.value;
}

function InvoiceAdjustmentModal({
  type,
  isOpen,
  onClose,
  onApply,
}: InvoiceAdjustmentModalProps) {
  const [list, setList] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [mode, setMode] = useState<"percentage" | "Fixed Amount">("percentage");
  const [value, setValue] = useState<number>(0);

  useEffect(() => {
    if (!isOpen) return;

    const load = async () => {
      const data =
        type === "discount"
          ? await discountRepository.getAll()
          : await taxRepository.getAll();

      setList(data);
    };

    load();
  }, [isOpen, type]);

  useEffect(() => {
    const selected = list.find(x => x.id === selectedId);
    if (selected) {
      setMode(selected.type);
      setValue(selected.value);
    }
  }, [selectedId, list]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
      <div className="bg-white p-4 rounded w-80">
        <h3 className="text-sm font-semibold mb-2">
          Apply {type === "discount" ? "Discount" : "Tax"}
        </h3>

        <select
          className="w-full mb-2 border p-1"
          value={selectedId ?? ""}
          onChange={e => setSelectedId(Number(e.target.value))}
        >
          <option value="">Select</option>
          {list.map(x => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>

        <select
          className="w-full mb-2 border p-1"
          value={mode}
          onChange={e => setMode(e.target.value as any)}
        >
          <option value="percentage">Percentage</option>
          <option value="Fixed Amount">Fixed Amount</option>
        </select>

        <input
          type="number"
          className="w-full mb-3 border p-1"
          value={value}
          onChange={e => setValue(Number(e.target.value))}
        />

        <div className="flex justify-end gap-2">
          <button className="text-xs" onClick={onClose}>
            Cancel
          </button>
          <button
            className="text-xs px-2 py-1 bg-black text-white rounded"
            onClick={() => {
              const selected = list.find(x => x.id === selectedId);
              if (!selected) return;

              onApply({
                id: selected.id,
                name: selected.name,
                type: mode,
                value,
              });
              onClose();
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

// =====================
// Component
// =====================

export default function SalesPOS() {
  const [items, setItems] = useState<Item[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editing, setEditing] = useState<CartItem | null>(null);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceNo, setInvoiceNo] = useState("");
  const [transactionType, setTransactionType] =
    useState<"Sale" | "Purchase" | "Return" | "Quotation">("Sale");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId) || null;
  const [customerArrears, setCustomerArrears] = useState(0);

  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [newCustomer, setNewCustomer] = useState({
    name: "",
    mobile: "",
    cnic: "",
    address: "",
    dues: 0,
  });

  const [showSupplierModal, setShowSupplierModal] = useState(false);
  const [newSupplier, setNewSupplier] = useState({
    name: "",
    mobile: "",
    cnic: "",
    address: "",
    dues: 0, // or opening balance if applicable
  });

  const [selectedCustomerName, setSelectedCustomerName] = useState("Walk-in Customer");
  const [customerInput, setCustomerInput] = useState("Walk-in Customer");
  const [isCustomerOpen, setIsCustomerOpen] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState(customers);

  type Supplier = {
  id: number;
  name: string;
  phone?: string;
  balance?: number;
  };
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState<number | null>(null);
  const [supplierInput, setSupplierInput] = useState("Direct Purchase");
  const [isSupplierOpen, setIsSupplierOpen] = useState(false);

  const filteredSuppliers = suppliers.filter(s =>
  s.name.toLowerCase().includes(supplierInput.toLowerCase())
  );

  const [Categories, setCategories] = useState<Category[]>([]);
  const [Brands, setBrands] = useState<Brand[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedBrand, setSelectedBrand] = useState<string>("");
  const [paid, setPaid] = useState<number>(0);
  const [invoiceDiscountId, setInvoiceDiscountId] = useState<number | null>(null);
  const [invoiceTaxId, setInvoiceTaxId] = useState<number | null>(null);
  const [showInvoiceDiscountModal, setShowInvoiceDiscountModal] = useState(false);
  const [showInvoiceTaxModal, setShowInvoiceTaxModal] = useState(false);
  
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [discountMode, setDiscountMode] = useState<"percentage" | "Fixed Amount">("percentage");
  const [discountValue, setDiscountValue] = useState<number>(0);
  const [taxMode, setTaxMode] = useState<"percentage" | "Fixed Amount">("percentage");
  const [taxValue, setTaxValue] = useState<number>(0);
  const [selectedDiscount, setSelectedDiscount] = useState<Discount | null>(null);
  const [selectedTax, setSelectedTax] = useState<Tax | null>(null);


  const PRICE_CATEGORIES = ["Retail", "Discount", "Wholesale"] as const;
  type PriceCategory = typeof PRICE_CATEGORIES[number];

  const salesRepo = salesRepository;

  const isPurchase = transactionType === "Purchase";

  const selectedSupplier =
  suppliers.find(s => s.id === selectedSupplierId) || null;

  const [supplierBalance, setSupplierBalance] = useState(0);

async function handleCompleteTransaction() {
  if (cart.length === 0) {
    alert("Cart is empty");
    return;
  }

  /* --------------------------------------------------
     1️⃣ PREPARE PARTY (CUSTOMER / SUPPLIER)
  -------------------------------------------------- */

  const customerId = !isPurchase ? selectedCustomerId ?? null : null;
  const supplierId = isPurchase ? selectedSupplierId ?? null : null;

  const customerName =
    !isPurchase && selectedCustomer
      ? selectedCustomer.name
      : "Walk-in Customer";

  const supplierName =
    isPurchase && selectedSupplier
      ? selectedSupplier.name
      : "Direct Purchase";

  const dues = isPurchase ? supplierBalance : customerArrears;

  /* --------------------------------------------------
     2️⃣ ITEM SUBTOTAL
  -------------------------------------------------- */

  let invoiceSubtotal = 0;
  cart.forEach(item => {
    const line = calcLine(item);
    invoiceSubtotal += line.total;
  });

  /* --------------------------------------------------
     3️⃣ INVOICE DISCOUNT & TAX
  -------------------------------------------------- */

  let invoiceDiscount = 0;
  let invoiceTax = 0;

  if (discountMode === "percentage") {
    invoiceDiscount = (invoiceSubtotal * Number(discountValue)) / 100;
  } else {
    invoiceDiscount = Number(discountValue) || 0;
  }

  const subtotalAfterDiscount = invoiceSubtotal - invoiceDiscount;

  if (taxMode === "percentage") {
    invoiceTax = (subtotalAfterDiscount * Number(taxValue)) / 100;
  } else {
    invoiceTax = Number(taxValue) || 0;
  }

  /* --------------------------------------------------
     4️⃣ GRAND TOTAL
  -------------------------------------------------- */

  const grandTotal = subtotalAfterDiscount + invoiceTax + dues;
  const paidAmount = Number(paid) || 0;
  const arrears = grandTotal - paidAmount;

  /* --------------------------------------------------
     5️⃣ PROFIT (SALE ONLY)
  -------------------------------------------------- */

  let profit = 0;
  if (!isPurchase) {
    cart.forEach(item => {
      const lineBase = item.qty * item.minUnitPrice;
      const costBase = item.qty * item.costPrice;

      const discountAmt =
        item.discountType === "%"
          ? (lineBase * item.discountValue) / 100
          : item.discountValue;

      profit += lineBase - discountAmt - costBase;
    });
  }

  /* --------------------------------------------------
     6️⃣ PREPARE ITEMS
  -------------------------------------------------- */

  const transactionItems = cart.map(ci => {
    const line = calcLine(ci);
    return {
      originalItemId: ci.originalItemId,
      name: ci.name,
      qty: ci.qty,
      price: ci.minUnitPrice,
      priceCategory: ci.priceCategory,
      discountType: ci.discountType,
      discountValue: line.discount,
      taxType: ci.taxType,
      taxValue: line.tax,
    };
  });

  /* --------------------------------------------------
     7️⃣ SAVE TRANSACTION
  -------------------------------------------------- */

  await salesRepository.addTransaction({
    invoiceNo,
    date: new Date().toISOString(),
    transactionType,

    customerId,
    customerName: !isPurchase ? customerName : "",

    supplierId,
    supplierName: isPurchase ? supplierName : "",

    subtotal: invoiceSubtotal,
    discount: invoiceDiscount,
    tax: invoiceTax,

    dues,
    grandTotal,
    paid: paidAmount,
    arrears,
    profit,

    items: transactionItems,
  });

  /* --------------------------------------------------
     8️⃣ UPDATE CUSTOMER (SALE)
  -------------------------------------------------- */

  if (!isPurchase && customerId) {
    const customer = await customersRepository.getById(customerId);
    if (customer) {
      const newPayable = (customer.payable ?? 0) + grandTotal - dues;
      const newPaid = (customer.paid ?? 0) + paidAmount;
      const newBalance = newPayable - newPaid;

      await customersRepository.update({
        ...customer,
        payable: newPayable,
        paid: newPaid,
        balance: newBalance,
        invoices: (customer.invoices ?? 0) + 1,
      });

      if (paidAmount > 0) {
        await customerPaymentRepository.add({
          customerId: customer.id!,
          customerName: customer.name,
          invoiceNo,
          amount: paidAmount,
          paymentDate: new Date().toISOString(),
          remarks: invoiceNo,
          payableSnapshot: grandTotal,
          balanceSnapshot: newBalance,
        });
      }
    }
  }

  /* --------------------------------------------------
     9️⃣ UPDATE SUPPLIER (PURCHASE) — MIRROR CUSTOMER LOGIC
  -------------------------------------------------- */

 if (isPurchase && supplierId) {
  const supplier = await SupplierRepository.getById(supplierId);
  if (supplier) {
    const newPayable = (supplier.payable ?? 0) + grandTotal - dues;
    const newPaid = (supplier.paid ?? 0) + paidAmount;
    const newBalance = newPayable - newPaid;

    await SupplierRepository.update({
      ...supplier,
      payable: newPayable,
      paid: newPaid,
      balance: newBalance,
      invoices: (supplier.invoices ?? 0) + 1,
    });

    if (paidAmount > 0) {
      await SupplierRepository.addPayment(
        supplier.id!,
        paidAmount,
        new Date().toISOString(),
        invoiceNo,
        newPayable,
        newBalance
      );
    }
  }
}


  /* --------------------------------------------------
     🔟 UPDATE STOCK
  -------------------------------------------------- */

  for (const ci of cart) {
    const item = await itemsRepository.getById(ci.originalItemId);
    if (!item) continue;

    await itemsRepository.update({
      ...item,
      availableStock: isPurchase
        ? item.availableStock + ci.qty
        : item.availableStock - ci.qty,
    });
  }

  /* --------------------------------------------------
     1️⃣1️⃣ RESET UI
  -------------------------------------------------- */

  setCart([]);
  setPaid(0);
  setDiscountValue(0);
  setTaxValue(0);

  setSelectedCustomerId(null);
  setCustomerInput("Walk-in Customer");

  setSelectedSupplierId(null);
  setSupplierInput("Direct Purchase");

  /* --------------------------------------------------
     1️⃣2️⃣ NEXT INVOICE
  -------------------------------------------------- */

  const prefix =
    transactionType === "Sale"
      ? "SAL"
      : transactionType === "Purchase"
      ? "PUR"
      : transactionType === "Return"
      ? "RET"
      : "QTN";

  const nextInvoice = await getNextInvoiceNoFromDB(prefix);
  setInvoiceNo(nextInvoice);

  alert(`${transactionType} completed successfully. Invoice #${invoiceNo}`);
}


interface UnitPriceContext {
  unit: UnitType;        // which unit the entered price belongs to
  price: number;         // price for THAT unit
}

function priceForUnit(
  ctx: UnitPriceContext,
  item: Item,
  targetUnit: UnitType
): number {
  if (ctx.unit === targetUnit) {
    return ctx.price;
  }

  if (ctx.unit === "min" && targetUnit === "max") {
    return ctx.price * item.ConvQty;
  }

  if (ctx.unit === "max" && targetUnit === "min") {
    return ctx.price / item.ConvQty;
  }

  return ctx.price; // safety fallback
}


  // =====================
  // INIT LOADS
  // =====================

  useEffect(() => {
    (async () => {
      const dbItems = await itemsRepository.getAll();
      setItems(dbItems);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const dbCustomers = await customersRepository.getAll();
      const mapped = dbCustomers.map(c => ({
        id: c.id!,
        name: c.name,
        phone: c.mobile,
        arrears: c.balance ?? 0,
        invoices: c.invoices ?? 0,
      }));

      setCustomers(mapped);

      setSelectedCustomerId(null);
      setSelectedCustomerId(null);
      setCustomerInput(isPurchase ? "Direct Purchase" : "Walk-in Customer");

    })();
  }, []);

  useEffect(() => {
    const customer = customers.find(c => c.id === selectedCustomerId);
    setCustomerArrears(customer?.arrears ?? 0);
  }, [selectedCustomerId, customers]);


  useEffect(() => {
  const q = customerInput.toLowerCase().trim();
  if (!q || q === "walk-in customer") {
    setFilteredCustomers(customers); // show all customers initially
  } else {
    setFilteredCustomers(
      customers.filter(c => c.name.toLowerCase().includes(q))
    );
  }
}, [customerInput, customers]);

useEffect(() => {
  const loadCategories = async () => {
    const data = await categoriesRepository.getAll(); // returns Category[]
    setCategories(data);
  };

  loadCategories();
}, []);

useEffect(() => {
  const loadBrands = async () => {
    const data = await brandsRepository.getAll(); // returns Brand[]
    setBrands(data);
  };

  loadBrands();
}, []);

useEffect(() => {
  const handleBeforeUnload = (e: BeforeUnloadEvent) => {
    if (cart.length > 0) {
      e.preventDefault();
      e.returnValue = ""; // Required for Chrome
    }
  };

  window.addEventListener("beforeunload", handleBeforeUnload);

  return () => {
    window.removeEventListener("beforeunload", handleBeforeUnload);
  };
}, [cart.length]);

useEffect(() => {
  const loadAdjustments = async () => {
    const dbDiscounts = await discountRepository.getAll();
    const dbTaxes = await taxRepository.getAll();
    setDiscounts(dbDiscounts);
    setTaxes(dbTaxes);
  };

  loadAdjustments();
}, []);

useEffect(() => {
  if (isPurchase) {
    setSelectedCustomerId(null);
    setCustomerInput("Walk-in Customer");

    setSelectedSupplierId(null);
    setSupplierInput("Direct Purchase");
  }
}, [transactionType]);

// whenever isPurchase changes
useEffect(() => {
  if (!cart || cart.length === 0) return;

  const updatedCart = cart.map(ci => {
    const item = items.find(i => i.id === ci.originalItemId);
    if (!item) return ci;

    if (isPurchase) {
      // Purchase mode → use buy/cost price
      return {
        ...ci,
        minUnitPrice: item.purchasePrice, // replace with your actual cost field
        // keep the original priceCategory to satisfy TypeScript
      };
    } else {
      // Sale mode → recalc price based on priceCategory
      const baseMinPrice = getBaseMinUnitPrice(item, ci.priceCategory);
      return {
        ...ci,
        minUnitPrice: baseMinPrice,
      };
    }
  });

  setCart(updatedCart);
}, [isPurchase]);

useEffect(() => {
  async function refreshInvoiceNo() {
    const prefix =
      transactionType === "Sale" ? "SAL" :
      transactionType === "Purchase" ? "PUR" :
      transactionType === "Return" ? "RET" :
      "QTN";

    const nextInvoice = await getNextInvoiceNoFromDB(prefix);
    setInvoiceNo(nextInvoice);
  }

  refreshInvoiceNo();
}, [transactionType]);

useEffect(() => {
  SupplierRepository.getAll().then(data =>
    setSuppliers(
      data.map(s => ({
        id: s.id!,
        name: s.name,
        phone: s.mobile,
        balance: s.balance ?? 0, // 👈 IMPORTANT
      }))
    )
  );
}, []);

useEffect(() => {
  if (!isPurchase) {
    setSupplierBalance(0);
    return;
  }

  const supplier = suppliers.find(s => s.id === selectedSupplierId);
  setSupplierBalance(supplier?.balance ?? 0);
}, [selectedSupplierId, suppliers, isPurchase]);

  // =====================
  // CART LOGIC
  // =====================

function cancelSale() {
  // restore only what was deducted in UI
  setItems(prev =>
    prev.map(i => {
      const ci = cart.find(c => c.originalItemId === i.id);
      if (!ci) return i;
      return { ...i, availableStock: i.availableStock + ci.uiDeductedQty };
    })
  );

  setCart([]);
  setPaid(0);
  setDiscountValue(0);
  setTaxValue(0);
  setSelectedCustomerId(null);
  setCustomerInput("Walk-in Customer");
}

function handleTransactionTypeChange(
  nextType: "Sale" | "Purchase" | "Return" | "Quotation"
) {
  cancelSale();
  setTransactionType(nextType); // 🔥 invoice handled by useEffect
}

  function handleBarcodeScan(code: string) {
    const item = items.find(i => i.barcode === code);
    if (item) {
      addToCart(item);
      setSearch("");
    } else {
      alert("Item not found for barcode: " + code);
    }
  }

function addToCart(item: Item) {

  // ❌ Block only for SALE, not PURCHASE
  if (!isPurchase && item.availableStock <= 0) return;

  // 1️⃣ Update UI stock ONLY for SALE
  if (!isPurchase) {
    setItems(prev =>
      prev.map(i =>
        i.id === item.id ? { ...i, availableStock: i.availableStock - 1 } : i
      )
    );
  }

  // 2️⃣ Add to cart
  setCart(prev => {
    const existing = prev.find(ci => ci.originalItemId === item.id);
    if (existing) {
      return prev.map(ci =>
        ci.originalItemId === item.id
          ? {
              ...ci,
              qty: ci.qty + 1,
              uiDeductedQty: isPurchase ? 0 : ci.uiDeductedQty + 1,
            }
          : ci
      );
    }

    return [
      ...prev,
      {
        id: Date.now(),
        name: item.name,
        qty: 1,
        unit: "min",

        // 🔴 IMPORTANT CHANGE
        minUnitPrice: isPurchase
          ? item.purchasePrice ?? 0
          : item.retailPrice,

        convQty: item.ConvQty,
        minunit: item.minunit,
        maxunit: item.maxunit,

        costPrice: item.purchasePrice ?? 0,
        priceCategory: "Retail",

        discountType: "%",
        discountValue: 0,
        taxType: "%",
        taxValue: 0,

        originalItemId: item.id!,
        uiDeductedQty: isPurchase ? 0 : 1,
      },
    ];
  });
}

function updateItem(updated: CartItem) {
  const originalItem = items.find(i => i.id === updated.originalItemId);
  if (!originalItem) return;

  const prevCartItem = cart.find(ci => ci.id === updated.id);
  if (!prevCartItem) return;

  // 1️⃣ Compute new MIN unit qty
  const newQtyMin = updated.unit === "max" ? updated.qty * originalItem.ConvQty : updated.qty;

  // 2️⃣ Compute difference in qty
  const diff = newQtyMin - prevCartItem.qty;

  // 3️⃣ Update UI stock by subtracting or restoring based on diff
  setItems(prev =>
    prev.map(i =>
      i.id === originalItem.id
        ? { ...i, availableStock: i.availableStock - diff }
        : i
    )
  );

  // 4️⃣ Update cart item, include uiDeductedQty
  setCart(prev =>
    prev.map(ci =>
      ci.id === updated.id
        ? {
            ...ci,
            qty: newQtyMin,
            unit: updated.unit,
            priceCategory: updated.priceCategory,
            discountType: updated.discountType,
            discountValue: updated.discountValue,
            taxType: updated.taxType,
            taxValue: updated.taxValue,
            minUnitPrice:
              updated.priceCategory === "Discount"
                ? originalItem.discountPrice ?? originalItem.retailPrice
                : updated.priceCategory === "Wholesale"
                ? originalItem.wholesalePrice
                : originalItem.retailPrice,
            convQty: originalItem.ConvQty,
            uiDeductedQty: prevCartItem.uiDeductedQty + diff, // update UI deduction
          }
        : ci
    )
  );

  setEditing(null);
}

 async function removeItem(cartItemId: number) {
  const cartItem = cart.find(ci => ci.id === cartItemId);
  if (!cartItem) return;

  const item = items.find(i => i.id === cartItem.originalItemId);
  if (!item) return;

  // Restore stock (UI + DB)
        setItems(prev =>
          prev.map(i =>
            i.id === item.id
              ? { ...i, availableStock: i.availableStock + cartItem.uiDeductedQty }
              : i
          )
        );

  // Remove from cart
  setCart(prev => prev.filter(ci => ci.id !== cartItemId));
}

async function applyEdit(updatedQty: number) {
  if (!editing) return;

  setCart(prev =>
    prev.map(ci =>
      ci.id === editing.id
        ? { ...ci, qty: updatedQty }
        : ci
    )
  );

  setEditing(null);
}


async function getNextInvoiceNoFromDB(
  prefix: string = "SAL"
): Promise<string> {
  const allSales = await salesRepository.getAllSales();

  // filter only invoices of the same prefix
  const sameTypeSales = allSales.filter(s =>
    s.invoiceNo?.startsWith(`${prefix}-`)
  );

  if (sameTypeSales.length === 0) {
    return `${prefix}-0001`;
  }

  // Extract numeric part and find the maximum
  const latestNumber = sameTypeSales
    .map(s => {
      const parts = s.invoiceNo.split("-");
      return parseInt(parts[1], 10);
    })
    .filter(n => !isNaN(n))
    .sort((a, b) => b - a)[0];

  return `${prefix}-${String(latestNumber + 1).padStart(4, "0")}`;
}

function formatStock(
  stockMin: number,
  convQty: number,
  minUnit: string,
  maxUnit: string
) {
  if (convQty <= 0) {
    return `${stockMin} ${minUnit}`;
  }

  const max = Math.floor(stockMin / convQty);
  const min = stockMin % convQty;

  const parts: string[] = [];
  if (max > 0) parts.push(`${max} ${maxUnit}`);
  if (min > 0) parts.push(`${min} ${minUnit}`);

  return parts.length > 0 ? parts.join(" ") : `0 ${minUnit}`;
}

  // =====================
  // FILTERS & TOTALS
  // =====================

  const categories = useMemo(
    () => Array.from(new Set(items.map(i => i.category).filter(Boolean))),
    [items]
  );

  const brands = useMemo(
    () => Array.from(new Set(items.map(i => i.brand).filter(Boolean))),
    [items]
  );

const totals = useMemo(() => {
  let subtotal = 0;      // includes cart item taxes
  let cartItemDiscount = 0; // info only

  cart.forEach(i => {
    const r = calcLine(i);
    subtotal += r.total;   // ✅ total already includes cart item discount & tax
    cartItemDiscount += r.discount; // just for info
  });

  // Apply invoice-level adjustments (on subtotal)
  const invoiceDiscountAmount = applyAdjustment(subtotal, selectedDiscount ? { type: discountMode, value: discountValue } : null);
  const invoiceTaxAmount = applyAdjustment(subtotal - invoiceDiscountAmount, selectedTax ? { type: taxMode, value: taxValue } : null);

  const dues = isPurchase ? supplierBalance : customerArrears;

  const grandTotal =
  subtotal - invoiceDiscountAmount + invoiceTaxAmount + dues;

  return {
  subtotal,
  cartItemDiscount,
  discount: invoiceDiscountAmount,
  tax: invoiceTaxAmount,
  arrears: dues, // 👈 unified
  grandTotal,
};

}, [
  cart,
  customerArrears,
  supplierBalance,
  selectedDiscount,
  discountMode,
  discountValue,
  selectedTax,
  taxMode,
  taxValue,
  isPurchase
]);


  const filteredItems = useMemo(() => {
  return items.filter((item) => {
    const matchesCategory =
      selectedCategory === "" || item.category === selectedCategory;
    const matchesBrand =
      selectedBrand === "" || item.brand === selectedBrand;
    const matchesSearch =
      search.trim() === "" ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.barcode?.includes(search.trim());

    return matchesCategory && matchesBrand && matchesSearch;
  });
}, [items, selectedCategory, selectedBrand, search]);

const balance = useMemo(() => {
  return Math.max(0, totals.grandTotal - paid);
}, [totals.grandTotal, paid]);

function normalizeToMinUnit(
  price: number,
  unit: UnitType,
  convQty: number
): number {
  return unit === "max" ? price / convQty : price;
}

  type UnitType = "min" | "max";

  function getPriceByCategory(
  item: Item,
  category: "Retail" | "Discount" | "Wholesale"
) {
  if (category === "Discount") return item.discountPrice ?? 0;
  if (category === "Wholesale") return item.wholesalePrice ?? 0;
  return item.retailPrice ?? 0;
}

function calculatePrice(
  item: Item,
  unit: "min" | "max",
  category: "Retail" | "Discount" | "Wholesale"
) {
  const basePrice = getPriceByCategory(item, category);
  return unit === "max"
    ? basePrice * (item.ConvQty ?? 1)
    : basePrice;
}

function getBaseMinUnitPrice(
  item: Item,
  category: "Retail" | "Discount" | "Wholesale"
) {
  if (category === "Discount") return item.discountPrice ?? item.retailPrice;
  if (category === "Wholesale") return item.wholesalePrice;
  return item.retailPrice;
}

function priceForDisplay(
  minUnitPrice: number,
  unit: UnitType,
  convQty: number
) {
  return unit === "max" ? minUnitPrice * convQty : minUnitPrice;
}

function formatStockDisplay(
  minQty: number,
  convQty: number,
  minUnit: string,
  maxUnit: string
) {
  if (!convQty || convQty <= 0) {
    return `${minQty} ${minUnit}`;
  }

  const max = Math.floor(minQty / convQty);
  const min = minQty % convQty;

  if (max > 0 && min > 0) {
    return `${max}${maxUnit} ${min}${minUnit}`;
  }

  if (max > 0) {
    return `${max}${maxUnit}`;
  }

  return `${min}${minUnit}`;
}

const dropdownList = isPurchase ? suppliers : customers;

const selectedName = isPurchase ? supplierInput : customerInput;

const setSelectedName = isPurchase ? setSupplierInput : setCustomerInput;

const setSelectedId = isPurchase ? setSelectedSupplierId : setSelectedCustomerId;

  return (
    <div className="h-full flex bg-gray-100">

      {/* LEFT – ITEMS */}
      <div className="w-2/3 p-4 border-r bg-white flex flex-col">
  {/* Top controls */}
  <div className="flex gap-2 mb-3">
    {/* Transaction Type Selector */}
      <div className="flex items-center gap-4 mb-3">
  {(["Sale", "Purchase", "Return", "Quotation"] as const).map(type => (
    <label
      key={type}
      className={`flex items-center gap-2 px-3 py-1 rounded cursor-pointer transition
        ${
          transactionType === type
            ? "bg-indigo-600 text-white"
            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
        }
      `}
    >
      <input
        type="radio"
        name="transactionType"
        value={type}
        className="hidden"
        checked={transactionType === type}
        onChange={() => {
          // 🔁 Always rollback cart + UI stock first
          handleTransactionTypeChange(type);
        }}
      />
      {type}
    </label>
  ))}
</div>

    <input
      type="text"
      placeholder="Search Items / Scan Barcode ..."
      className="border p-2 rounded flex-1 w-full"
      value={search}
      onChange={(e) => setSearch(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") handleBarcodeScan(search.trim());
      }}
    />
  </div>

  {/* Category & Brand filters */}
  <div className="flex gap-2 mb-3">
      {/* Category filter */}
<select
  value={selectedCategory}
  onChange={(e) => setSelectedCategory(e.target.value)}
  className="w-full border rounded px-2 py-1"
>
  <option value="">All Categories</option>
  {Categories.map((cat) => (
    <option key={cat.id} value={cat.name}>
      {cat.name}
    </option>
  ))}
</select>

<select
  value={selectedBrand}
  onChange={(e) => setSelectedBrand(e.target.value)}
  className="w-full border rounded px-2 py-1"
>
  <option value="">All Brands</option>
  {Brands.map((b) => (
    <option key={b.id} value={b.name}>
      {b.name}
    </option>
  ))}
</select>

  </div>

{/* Items grid */}
<div className="grid grid-cols-4 gap-2 auto-rows-min overflow-y-auto max-h-[calc(100vh-170px)]">
  {filteredItems.length === 0 ? (
    <div className="col-span-4 text-center text-gray-500 text-sm py-10">
      No items found. Adjust your search, category, or brand filters.
    </div>
  ) : (
    filteredItems.map(item => {
      // 🔹 Dynamic display price based on mode
      const displayPrice = isPurchase ? item.purchasePrice : item.retailPrice;

      return (
        <div
          key={item.id}
          onClick={() => addToCart(item)}
          className={`p-2 border-2 shadow rounded cursor-pointer text-sm select-none ${
            item.availableStock <= 0
              ? "bg-gray-200 cursor-not-allowed"
              : "hover:bg-blue-100"
          }`}
        >
          <div className="font-medium text-blue-400">{item.name}</div>

          <div className="text-xs text-green-500">
            <span className="text-yellow-500">Rs {displayPrice.toFixed(2)}</span> |{" "}
            {item.availableStock > 0
              ? formatStockDisplay(
                  item.availableStock,
                  item.ConvQty,
                  item.minunit,
                  item.maxunit
                )
              : "0"}
          </div>

          {item.availableStock <= 0 && (
            <div className="text-red-500 text-xs font-semibold mt-1">
              Out of Stock
            </div>
          )}
        </div>
      );
    })
  )}
</div>

</div>


      {/* RIGHT – CART */}
        <div className="w-3/10 flex flex-col ml-2">
  {/* HEADER */}
  <div className="bg-white p-3 rounded shadow mb-3">
  {/* Row 1: Invoice + Total Items */}
  <div className="flex justify-between items-center mb-1">
    <div className="text-lg font-semibold">
      Invoice #: {invoiceNo}
    </div>

    <div className="text-sm text-gray-700">
      Total Items: <span className="font-semibold">{cart.length}</span>
    </div>
  </div>

  {/* Row 2: Date + Customer */}
  <div className="flex justify-between items-center">
    {/* Date */}
    <div className="flex items-center gap-2 text-sm">
      <span>Date:</span>
      <input
        type="date"
        className="border px-2 py-1 rounded text-sm"
        value={selectedDate}
        onChange={(e) => setSelectedDate(e.target.value)}
      />
    </div>

    {/* Customer + Quick Add */}
    <div className="flex items-center gap-2">
  {/* Customer Input */}
{/* Customer / Supplier Input */}
<div className="relative w-56">
  <input
    type="text"
    value={isPurchase ? supplierInput : customerInput}
    className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
    onFocus={() => {
      if (isPurchase) {
        setIsSupplierOpen(true);
        // show all suppliers when focused
        if (supplierInput === "Direct Purchase") {
          setSupplierInput("");
        }
      } else {
        setIsCustomerOpen(true);
        // show all customers when focused
        if (customerInput === "Walk-in Customer") {
          setCustomerInput("");
          setFilteredCustomers(customers);
        }
      }
    }}
    onChange={(e) => {
      const val = e.target.value;
      if (isPurchase) {
        setSupplierInput(val);
        setSelectedSupplierId(null);
        setIsSupplierOpen(true);
      } else {
        setCustomerInput(val);
        setSelectedCustomerId(null);
        setIsCustomerOpen(true);

        const q = val.toLowerCase();
        setFilteredCustomers(
          customers.filter(c => c.name.toLowerCase().includes(q))
        );
      }
    }}
    onBlur={() => {
      setTimeout(() => {
        if (isPurchase) {
          setIsSupplierOpen(false);
          if (!supplierInput.trim()) {
            setSupplierInput("Direct Purchase");
            setSelectedSupplierId(null);
          }
        } else {
          setIsCustomerOpen(false);
          if (!customerInput.trim()) {
            setCustomerInput("Walk-in Customer");
            setSelectedCustomerId(null);
          }
        }
      }, 150);
    }}
  />

  {/* Dropdown */}
  {isPurchase ? (
    isSupplierOpen && filteredSuppliers.length > 0 && (
      <div className="absolute z-20 mt-1 w-full bg-white border rounded shadow max-h-48 overflow-y-auto">
        {filteredSuppliers.map(s => (
          <div
            key={s.id}
            className="px-2 py-1 text-sm cursor-pointer hover:bg-indigo-100"
            onMouseDown={() => {
              setSelectedSupplierId(s.id!);
              setSupplierInput(s.name);
              setIsSupplierOpen(false);
            }}
          >
            {s.name}
          </div>
        ))}
      </div>
    )
  ) : (
    isCustomerOpen && filteredCustomers.length > 0 && (
      <div className="absolute z-20 mt-1 w-full bg-white border rounded shadow max-h-48 overflow-y-auto">
        {filteredCustomers.map(c => (
          <div
            key={c.id}
            className="px-2 py-1 text-sm cursor-pointer hover:bg-indigo-100"
            onMouseDown={() => {
              setSelectedCustomerId(c.id);
              setCustomerInput(c.name);
              setIsCustomerOpen(false);
            }}
          >
            {c.name}
          </div>
        ))}
      </div>
    )
  )}
</div>

  <button
    onClick={() =>
      isPurchase
        ? setShowSupplierModal(true)
        : setShowCustomerModal(true)
    }
    className="p-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
    title={isPurchase ? "Add New Supplier" : "Add New Customer"}
  >
    <FaPlus size={12} />
  </button>
    </div>

  </div>
</div>


  {/* CART ITEMS */}
  <div className="flex-1 overflow-y-auto space-y-1 max-h-[285px]">
    {cart.map((ci) => {
      const r = calcLine(ci);
      return (
        <div key={ci.id} className="bg-white pl-2 pr-2 pb-1 rounded shadow">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium">{ci.name}</div>
              <div className="text-sm text-gray-500 leading-tight">
               <span className="text-blue-400">{ci.unit === "max"? ci.qty / ci.convQty : ci.qty}{ci.unit === "max" ? ci.maxunit : ci.minunit}×
                            {priceForDisplay(ci.minUnitPrice, ci.unit, ci.convQty)}</span>  | <span className="text-green-400">Disc: {ci.discountValue}{ci.discountType}</span> | <span className="text-red-400">Tax: {ci.taxValue}{ci.taxType}</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                  onClick={() => {
                   const item = items.find(i => i.id === ci.originalItemId);
  if (!item) return;

  setEditing({
    ...ci,

    // ✅ convert qty BACK for display
    qty:
      ci.unit === "max"
        ? ci.qty / item.ConvQty
        : ci.qty,
  });
                  }}
                  className="p-2 bg-green-500 text-white rounded"
                >
                  <FaEdit />
              </button>

              <button onClick={() => removeItem(ci.id)} className="p-2 bg-red-500 text-white rounded">
                <FaTrash />
              </button>
            </div>
          </div>
          <div className="text-right font-semibold leading-tight">{r.total.toFixed(2)}</div>
        </div>
      );
    })}
  </div>

  {/* TOTALS */}
  <div className="bg-white p-4 rounded shadow mt-4">
  {/* GRID FOR DESKTOP, STACK FOR MOBILE */}
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 text-sm">

    {/* LEFT COLUMN — EXISTING TOTALS */}
    <div className="space-y-2">
      <div className="flex justify-between">
        <span>Subtotal</span>
        <span>{totals.subtotal.toFixed(2)}</span>
      </div>

      <div className="flex justify-between">
        <span>Discount 
        <button
        className="ml-1 text-[10px] px-1 border rounded bg-green-500 text-white"
        onClick={() => setShowInvoiceDiscountModal(true)}>
            +
    </button>
        </span>
        <span>-{totals.discount.toFixed(2)}</span>
      </div>

      <div className="flex justify-between">
        <span>Tax
          <button
          className="ml-1 text-[10px] px-1 border rounded bg-red-500 text-white"
          onClick={() => setShowInvoiceTaxModal(true)}>
            +
    </button>
        </span>
        <span>{totals.tax.toFixed(2)}</span>
      </div>

     {!isPurchase &&
  selectedCustomerId !== null &&
  customerArrears > 0 && (
    <div className="flex justify-between text-red-600 font-medium">
      <span>Previous Dues</span>
      <span>{customerArrears.toFixed(2)}</span>
    </div>
)}

{isPurchase &&
  selectedSupplierId !== null &&
  supplierBalance > 0 && (
    <div className="flex justify-between text-red-600 font-medium">
      <span>Previous Dues</span>
      <span>{supplierBalance.toFixed(2)}</span>
    </div>
)}

      <div className="flex justify-between font-semibold border-t pt-2 text-base">
        <span className="text-blue-600">Payable Amount</span>
        <span className="text-blue-600">{totals.grandTotal.toFixed(2)}</span>
      </div>
    </div>

    {/* RIGHT COLUMN — PAYMENT INFO (UI ONLY, NO NEW VARIABLES) */}
    <div className="space-y-3 mt-1">
       <div className="flex items-center gap-4 ml-2">
          <label className="text-xl font-medium text-green-500 whitespace-nowrap">
            Paid
          </label>

          <input
            type="number"
            min="0"
            value={paid}
            onChange={(e) => setPaid(Number(e.target.value) || 0)}
            className="flex-1 p-2 border w-full rounded text-center text-xl text-green-500"
          />
        </div>

      <div className="flex justify-between items-center bg-gray-50 p-3 rounded">
        <span className="font-medium text-xl text-red-600">Balance</span>
        <span className="text-lg font-bold text-red-600 mr-10">
          {balance.toFixed(2)}
        </span>
      </div>
    </div>
  </div>

  {/* ACTION BUTTONS — UNCHANGED */}
  <div className="flex gap-2 mt-6">
    <button
      className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
      onClick={handleCompleteTransaction}
    >
      <FaCheck /> Complete {transactionType}
    </button>

    <button
      className="flex-1 flex items-center justify-center gap-2 bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition"
      onClick={cancelSale}
    >
      <FaTimes /> Cancel {transactionType}
    </button>
  </div>
</div>

</div>


     {/* EDIT MODAL */}
{editing && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
    <div className="bg-white p-5 rounded w-96">
      <div className="flex justify-between items-start mb-3">
        <h3 className="font-semibold text-red-500">
          {editing.name}
        </h3>

        <span className="text-xs text-green-500 text-right">
          Stock:&nbsp;
          {formatStock(
            items.find(i => i.id === editing.originalItemId)?.availableStock ?? 0,
            editing.convQty,
            editing.minunit,
            editing.maxunit
          )}
        </span>
      </div>

      <div className="mb-2">
        <label className="text-xs font-medium">Unit</label>
        <select
          className="w-full p-2 border rounded"
          value={editing.unit}
          onChange={(e) => {
            if (!editing) return;
            const newUnit = e.target.value as UnitType;
            setEditing({ ...editing, unit: newUnit });
          }}
        >
          <option value="min">{editing.minunit}</option>
          <option value="max">{editing.maxunit}</option>
        </select>
      </div>

      <label className="text-sm">Quantity</label>
      <input
        type="number"
        className="w-full p-2 border rounded mb-2"
        value={editing.qty}
        onChange={e => setEditing({ ...editing, qty: Number(e.target.value) })}
      />

      {/* Price Category / Buy Price */}
      {isPurchase ? (
        <>
          <label className="text-sm font-medium block mb-1">Buy Price</label>
          <input
            type="number"
            className="w-full p-2 border rounded mb-2"
            value={editing.minUnitPrice}
            onChange={(e) => {
              const price = Number(e.target.value) || 0;
              setEditing({
                ...editing,
                minUnitPrice: normalizeToMinUnit(price, editing.unit, editing.convQty),
              });
            }}
          />
        </>
      ) : (
        <>
          <label className="text-sm font-medium block mb-1">Price</label>
          <div className="flex gap-3 text-sm mb-2">
            {PRICE_CATEGORIES.map(cat => (
              <label key={cat} className="flex items-center gap-1">
                <input
                  type="radio"
                  checked={editing.priceCategory === cat}
                  onChange={() => {
                    if (!editing) return;
                    const item = items.find(i => i.id === editing.originalItemId);
                    if (!item) return;
                    const baseMinPrice = getBaseMinUnitPrice(item, cat);

                    setEditing({
                      ...editing,
                      priceCategory: cat,
                      minUnitPrice: baseMinPrice,
                    });
                  }}
                />
                {cat}
              </label>
            ))}
          </div>

          <input
            type="number"
            className="w-full p-2 border rounded mb-2"
            value={priceForDisplay(editing.minUnitPrice, editing.unit, editing.convQty)}
            onChange={(e) => {
              const price = Number(e.target.value) || 0;
              setEditing({
                ...editing,
                minUnitPrice: normalizeToMinUnit(price, editing.unit, editing.convQty),
              });
            }}
          />
        </>
      )}

      <label className="text-sm">Discount</label>
      <div className="flex gap-2 mb-2">
        <select
          value={editing.discountType}
          onChange={e => setEditing({ ...editing, discountType: e.target.value as "%" | "flat" })}
          className="border p-1 rounded flex-1"
        >
          <option value="%">%</option>
          <option value="flat">Flat</option>
        </select>
        <input
          type="number"
          className="border p-2 rounded flex-1"
          value={editing.discountValue}
          onChange={e => setEditing({ ...editing, discountValue: Number(e.target.value) })}
        />
      </div>

      <label className="text-sm">Tax</label>
      <div className="flex gap-2 mb-3">
        <select
          value={editing.taxType}
          onChange={e => setEditing({ ...editing, taxType: e.target.value as "%" | "flat" })}
          className="border p-1 rounded flex-1"
        >
          <option value="%">%</option>
          <option value="flat">Flat</option>
        </select>
        <input
          type="number"
          className="border p-2 rounded flex-1"
          value={editing.taxValue}
          onChange={e => setEditing({ ...editing, taxValue: Number(e.target.value) })}
        />
      </div>

      <div className="flex justify-end gap-2">
        <button onClick={() => setEditing(null)}>Cancel</button>
        <button onClick={() => updateItem(editing)} className="bg-indigo-600 text-white px-4 py-2 rounded">
          Save
        </button>
      </div>
    </div>
  </div>
)}


      {showCustomerModal && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white p-5 rounded w-96 shadow">
      <h3 className="font-semibold mb-3">Create New Customer</h3>

      <label className="text-sm">Customer Name</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newCustomer.name}
        onChange={(e) =>
          setNewCustomer({ ...newCustomer, name: e.target.value })
        }
      />

      <label className="text-sm">Mobile</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newCustomer.mobile}
        onChange={(e) =>
          setNewCustomer({ ...newCustomer, mobile: e.target.value })
        }
      />

        <label className="text-sm">CNIC</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newCustomer.cnic}
        onChange={(e) =>
          setNewCustomer({ ...newCustomer, cnic: e.target.value })
        }
      />

        <label className="text-sm">Address</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newCustomer.address}
        onChange={(e) =>
          setNewCustomer({ ...newCustomer, address: e.target.value })
        }
      />

      <label className="text-sm">Previous Dues</label>
      <input
        type="number"
        className="w-full p-2 border rounded mb-4"
        value={newCustomer.dues}
        onChange={(e) =>
          setNewCustomer({
            ...newCustomer,
            dues: Number(e.target.value),
          })
        }
      />

      <div className="flex justify-end gap-2">
        <button
          onClick={() => setShowCustomerModal(false)}
          className="px-3 py-1"
        >
          Cancel
        </button>

        <button
                    className="bg-indigo-600 text-white px-4 py-2 rounded"
                    onClick={async () => {
                      if (!newCustomer.name.trim()) return alert("Customer name is required");

                      // 1️⃣ Fetch all customers to check for duplicate name
                      const allCustomers = await customersRepository.getAll();
                      const nameExists = allCustomers.some(
                        (c) => c.name.trim().toLowerCase() === newCustomer.name.trim().toLowerCase()
                      );
                      if (nameExists) {
                        return alert(`A customer with the name "${newCustomer.name}" already exists.`);
                      }

                      // 2️⃣ Save to IndexedDB
                      const id = await customersRepository.create({
                        name: newCustomer.name,
                        mobile: newCustomer.mobile,
                        cnic: newCustomer.cnic,
                        address: newCustomer.address,
                        balance: newCustomer.dues,
                      });

                      // 3️⃣ Reload customers from DB (single source of truth)
                      const dbCustomers = await customersRepository.getAll();
                      const mapped = dbCustomers.map(c => ({
                        id: c.id!,
                        name: c.name,
                        phone: c.mobile,
                        arrears: c.balance ?? 0,
                      }));

                      // 4️⃣ Update UI state
                      setCustomers(mapped);
                      setSelectedCustomerId(id);
                      setCustomerInput(newCustomer.name);

                      // 5️⃣ Reset modal
                      setNewCustomer({
                        name: "",
                        mobile: "",
                        cnic: "",
                        address: "",
                        dues: 0,
                      });
                      setShowCustomerModal(false);
                    }}
                  >
  Save
</button>

      </div>
    </div>
  </div>
      )}

{showSupplierModal && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white p-5 rounded w-96 shadow">
      <h3 className="font-semibold mb-3">Create New Supplier</h3>

      <label className="text-sm">Supplier Name</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newSupplier.name}
        onChange={(e) =>
          setNewSupplier({ ...newSupplier, name: e.target.value })
        }
      />

      <label className="text-sm">Mobile</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newSupplier.mobile}
        onChange={(e) =>
          setNewSupplier({ ...newSupplier, mobile: e.target.value })
        }
      />

      <label className="text-sm">CNIC</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newSupplier.cnic}
        onChange={(e) =>
          setNewSupplier({ ...newSupplier, cnic: e.target.value })
        }
      />

      <label className="text-sm">Address</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newSupplier.address}
        onChange={(e) =>
          setNewSupplier({ ...newSupplier, address: e.target.value })
        }
      />

      <label className="text-sm">Opening Payable</label>
      <input
        type="number"
        className="w-full p-2 border rounded mb-4"
        value={newSupplier.dues}
        onChange={(e) =>
          setNewSupplier({
            ...newSupplier,
            dues: Number(e.target.value),
          })
        }
      />

      <div className="flex justify-end gap-2">
        <button
          onClick={() => setShowSupplierModal(false)}
          className="px-3 py-1"
        >
          Cancel
        </button>

        <button
          className="bg-indigo-600 text-white px-4 py-2 rounded"
          onClick={async () => {
            if (!newSupplier.name.trim()) {
              return alert("Supplier name is required");
            }

            // 1️⃣ Duplicate check
            const allSuppliers = await SupplierRepository.getAll();
            const exists = allSuppliers.some(
              s =>
                s.name.trim().toLowerCase() ===
                newSupplier.name.trim().toLowerCase()
            );

            if (exists) {
              return alert(
                `A supplier with the name "${newSupplier.name}" already exists.`
              );
            }

            // 2️⃣ Save to DB
            const id = await SupplierRepository.add({
              name: newSupplier.name,
              mobile: newSupplier.mobile,
              cnic: newSupplier.cnic,
              address: newSupplier.address,
              payable: newSupplier.dues,
            });

            // 3️⃣ Reload suppliers
            const dbSuppliers = await SupplierRepository.getAll();
            setSuppliers(dbSuppliers.map(s => ({ ...s, id: s.id! })));

            // 4️⃣ Auto-select
            setSelectedSupplierId(id);
            setSupplierInput(newSupplier.name);

            // 5️⃣ Reset modal
            setNewSupplier({
              name: "",
              mobile: "",
              cnic: "",
              address: "",
              dues: 0,
            });

            setShowSupplierModal(false);
          }}
        >
          Save
        </button>
      </div>
    </div>
  </div>
)}

{showInvoiceDiscountModal && (
  <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
    <div className="bg-white p-4 rounded w-80">
      <h3 className="font-semibold mb-3">Invoice Discount</h3>

      {/* Discount Name */}
      <select
        className="w-full border p-2 rounded mb-2"
        value={selectedDiscount?.id ?? ""}
        onChange={e => {
          const d = discounts.find(d => d.id === Number(e.target.value));
          if (d) {
            setSelectedDiscount(d);
            setDiscountMode(d.type === "percentage" ? "percentage" : "Fixed Amount");
            setDiscountValue(d.value);
          } else {
            setSelectedDiscount(null);
            setDiscountMode("percentage");
            setDiscountValue(0);
          }
        }}
      >
        <option value="">Select Discount</option>
        {discounts.map(d => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      {/* Discount Type */}
      <select
        className="w-full border p-2 mb-2 rounded"
        value={discountMode}
        onChange={e => setDiscountMode(e.target.value as "percentage" | "Fixed Amount")}
      >
        <option value="percentage">Percentage</option>
        <option value="Fixed Amount">Fixed Amount</option>
      </select>

      {/* Discount Value */}
      <input
        type="number"
        className="w-full border p-2 mb-3 rounded"
        value={discountValue}
        onChange={e => setDiscountValue(Number(e.target.value))}
      />

      <div className="flex justify-end gap-2">
        {/* <button
          className="px-3 py-1 border rounded"
          onClick={() => setShowInvoiceDiscountModal(false)}
        >
          Cancel
        </button> */}
        <button
          className="px-3 py-1 bg-blue-600 text-white rounded"
          onClick={() => {            
            setShowInvoiceDiscountModal(false);
          }}
        >
          Ok
        </button>
      </div>
    </div>
  </div>
)}

{showInvoiceTaxModal && (
  <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
    <div className="bg-white p-4 rounded w-80">
      <h3 className="font-semibold mb-3">Invoice Tax</h3>

      {/* Tax Name */}
      <select
        className="w-full border p-2 rounded mb-2"
        value={selectedTax?.id ?? ""}
        onChange={e => {
          const t = taxes.find(t => t.id === Number(e.target.value));
          if (t) {
            setSelectedTax(t);
            setTaxMode(t.type === "percentage" ? "percentage" : "Fixed Amount");
            setTaxValue(t.value);
          } else {
            setSelectedTax(null);
            setTaxMode("percentage");
            setTaxValue(0);
          }
        }}
      >
        <option value="">Select Tax</option>
        {taxes.map(t => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      {/* Tax Type */}
      <select
        className="w-full border p-2 mb-2 rounded"
        value={taxMode}
        onChange={e => setTaxMode(e.target.value as "percentage" | "Fixed Amount")}
      >
        <option value="percentage">Percentage</option>
        <option value="Fixed Amount">Fixed Amount</option>
      </select>

      {/* Tax Value */}
      <input
        type="number"
        className="w-full border p-2 mb-3 rounded"
        value={taxValue}
        onChange={e => setTaxValue(Number(e.target.value))}
      />

      <div className="flex justify-end gap-2">
        {/* <button
          className="px-3 py-1 border rounded"
          onClick={() => setShowInvoiceTaxModal(false)}
        >
          Cancel
        </button> */}
        <button
          className="px-3 py-1 bg-blue-600 text-white rounded"
          onClick={() => {
            if (selectedTax) {
              setShowInvoiceTaxModal(false);
            }
            setShowInvoiceTaxModal(false);
          }}
        >
          Ok
        </button>
      </div>
    </div>
  </div>
)}

    </div>    
  );
}
