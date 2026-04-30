// src/POS.tsx
import { useEffect, useMemo, useState,useRef } from "react";
import { FaBarcode, FaEdit, FaTrash, FaTimes, FaCheck, FaPlus, FaHandHolding, FaHandHoldingUsd, FaClock, FaEye } from "react-icons/fa";

// 🔹 DB INTEGRATION
import { itemsRepository } from "./repositories/itemsRepository";
import { customersRepository } from "./repositories/customerRepository";
import { suppliersRepository as supplierRepo } from "./repositories/suppliersRepository";
import { categoriesRepository } from "./repositories/categoriesRepository";
import { brandsRepository } from "./repositories/brandsRepository";
import { updateCylinderCustomer, type Brand, type Category,type DBHeld,type DBHeldItem,type Item, type ItemBatch } from "./db";
import { salesRepository } from "./repositories/salesRepository";
import { customerPaymentRepository } from "./repositories/customerPaymentRepository";
import { supplierPaymentRepository } from "./repositories/supplierPaymentRepository";
import { discountRepository } from "./repositories/discountRepository";
import { taxRepository } from "./repositories/taxRepository";
import type { Discount, Tax } from "./db";
import { printInvoice } from "./services/printing/printService";
import { useLang } from "./i18n/LanguageContext";
import { heldRepository } from "./repositories/heldRepository";
import { batchRepository } from "./repositories/batchRepository";
import { syncCylinderInventoryForSale,cylinderRepo_getByItemId,cylinderRepo_update } from "./repositories/cylinderRepository";
import {cylinderCustomerRepo_addOrUpdate} from "./repositories/cylinderCustomerRepository";

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

  batchId?: number;
};


type Customer = {
  id: number;
  name: string;
  phone?: string;
  arrears: number;
  invoices?: number;
};

type ReturnMode = "customer" | "supplier" | null;

type ReturnParty = "customer" | "supplier" | null;

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
function priceForDisplay(
  minUnitPrice: number,
  unit: UnitType,
  convQty: number
) {
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

//round off function
export const roundTo = (num: number, decimals = 2) => {
  return Number(num.toFixed(decimals));
};

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
}: InvoiceAdjustmentModalProps)
 {
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

interface POSProps {
  currentUser: { username: string; role: "admin" | "saleboy" | "Dev" };
  onCartStateChange?: (hasItems: boolean) => void;
}

export default function SalesPOS({ currentUser, onCartStateChange }: POSProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editing, setEditing] = useState<CartItem | null>(null);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceNo, setInvoiceNo] = useState("");
  const { t, lang, setLang } = useLang();
  type TransactionType = "Sale" | "Purchase" | "Return" | "Quotation";
  const [transactionType, setTransactionType] =
  useState<TransactionType>("Sale");
  const transactionTypes: { value: TransactionType; label: string }[] = [
  { value: "Sale", label: t("sale") },
  { value: "Purchase", label: t("purchase") },
  { value: "Return", label: t("return") },
  { value: "Quotation", label: t("quotation") },
];

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const selectedCustomer = customers.find(c => c.id === selectedCustomerId) || null;
  const [customerArrears, setCustomerArrears] = useState(0);

  const [resumeCustomerId, setResumeCustomerId] = useState<number | null>(null);
  const [resumeSupplierId, setResumeSupplierId] = useState<number | null>(null);

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
  const [filteredSuppliers, setFilteredSuppliers] = useState<Supplier[]>([]);

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

  const [modalDiscount, setModalDiscount] = useState<Discount | null>(null);
  const [modalDiscountMode, setModalDiscountMode] =
  useState<"percentage" | "Fixed Amount">("percentage");
  const [modalDiscountValue, setModalDiscountValue] = useState(0);

  const [modalTax, setModalTax] = useState<Tax | null>(null);
  const [modalTaxMode, setModalTaxMode] =
  useState<"percentage" | "Fixed Amount">("percentage");
  const [modalTaxValue, setModalTaxValue] = useState(0);

  const [returnMode, setReturnMode] = useState<ReturnMode>(null);

  const PRICE_CATEGORIES = ["Retail", "Discount", "Wholesale"] as const;
  type PriceCategory = typeof PRICE_CATEGORIES[number];

  const salesRepo = salesRepository;

  const isSale = transactionType === "Sale";
  const isPurchase = transactionType === "Purchase";
  const isReturn = transactionType === "Return";
  const isQuotation = transactionType === "Quotation";
  const treatAsPurchase =
  isPurchase || (isReturn && returnMode === "supplier");


  const isCustomerReturn = isReturn && returnMode === "customer";
  const isSupplierReturn = isReturn && returnMode === "supplier";

  const stockIncreases = isPurchase || isCustomerReturn;
  const stockDecreases = isSale || isSupplierReturn;
  const stockUnaffected = isQuotation;

  const [returnParty, setReturnParty] = useState<ReturnParty>(null);

  const selectedSupplier =
  suppliers.find(s => s.id === selectedSupplierId) || null;

  const [supplierBalance, setSupplierBalance] = useState(0);

  const showSupplierDropdown = isPurchase || (transactionType === "Return" && returnMode === "supplier");
  const showCustomerDropdown = !isPurchase && !(transactionType === "Return" && returnMode === "supplier");
  
  const [heldList, setHeldList] = useState<DBHeld[]>([]);
  const [showHeld, setShowHeld] = useState(false);

  const customersLoadedRef = useRef(false);

  const [batches, setBatches] = useState<ItemBatch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);

 useEffect(() => {
  if (!editing?.originalItemId) return;

  loadBatchesForItem(editing.originalItemId);
}, [editing?.originalItemId]);

// Notify parent component when cart state changes
useEffect(() => {
  onCartStateChange?.(cart.length > 0);
}, [cart, onCartStateChange]);

useEffect(() => {
  if (transactionType !== "Return") return;
  if (!selectedCustomerId) return;

  const customer = customers.find(c => c.id === selectedCustomerId);
  if (!customer) return;

  // Customer arrears (balance)
  const arrears = customer.arrears ?? 0;
  setCustomerArrears(arrears);

  // Force PAID to be negative in RETURN
  setPaid(prev => (prev > 0 ? -prev : prev));
}, [transactionType, selectedCustomerId, customers]);

 useEffect(() => {
  if (transactionType !== "Return") {
    setReturnMode(null);
  }
}, [transactionType]);

useEffect(() => {
  if (returnMode === "customer") {
    setSelectedSupplierId(null);
    setSupplierInput("Direct Purchase");
  }

  if (returnMode === "supplier") {
    setSelectedCustomerId(null);
    setCustomerInput("Walk-in Customer");
  }
}, [returnMode]);

/* -----------------------------
   EFFECT TO RESTORE CUSTOMER
------------------------------*/
useEffect(() => {
  if (resumeCustomerId == null) return;
  if (!customers.length) return;

  const customer = customers.find(
    c => c.id === resumeCustomerId
  );

  if (!customer) return;

  requestAnimationFrame(() => {
    setSelectedCustomerId(customer.id);
    setCustomerInput(customer.name);
    setResumeCustomerId(null);
  });

}, [customers, resumeCustomerId]);

/* -----------------------------
   EFFECT TO RESTORE SUPPLIER
------------------------------*/
useEffect(() => {
  if (resumeSupplierId === null) return;
  if (suppliers.length === 0) return;

  const supplier = suppliers.find(s => s.id === resumeSupplierId);
  setSelectedSupplierId(resumeSupplierId);
  setSupplierInput(supplier?.name ?? "Direct Purchase");

  // reset the temporary ID
  setResumeSupplierId(null);
}, [suppliers, resumeSupplierId]);

useEffect(() => {
  if (transactionType === "Return" && !returnMode) {
    setReturnMode("customer");
  }
}, [transactionType]);

// ✅ Normalize DB customer → POS customer
function mapDbCustomerToPosCustomer(dbCustomer: any): Customer {
  return {
    id: dbCustomer.id,
    name: dbCustomer.name,
    phone: dbCustomer.phone,

    // VERY IMPORTANT
    arrears:
      dbCustomer.arrears ??
      dbCustomer.dues ??
      dbCustomer.balance ??
      0,

    invoices: dbCustomer.invoices ?? 0,
  };
}

const loadBatchesForItem = async (itemId: number) => {
  const data = await batchRepository.getBatchesByItem(itemId);

  // FIFO → oldest first
  const sorted = [...data].sort(
    (a, b) =>
      new Date(a.purchaseDate).getTime() -
      new Date(b.purchaseDate).getTime()
  );

  setBatches(sorted);

  if (sorted.length > 0) {
    const first = sorted[0];

    setSelectedBatchId(first.id!);

    setEditing((prev) =>
      prev
        ? {
            ...prev,
            costPrice: first.costPrice,
            batchId: first.id,
          }
        : prev
    );
  }
};

function isCylinderItem(item: any) {
  const cat = (item.category || "").toLowerCase();

  return (
    cat.includes("gas") ||
    cat.includes("cylinder") ||
    cat.includes("lpg")
  );
}

async function handleCompleteTransaction(isPostponed: boolean) {
  if (cart.length === 0) {
    alert("Cart is empty");
    return;
  }

  /* --------------------------------------------------
     1️⃣ PREPARE PARTY (CUSTOMER / SUPPLIER)
  -------------------------------------------------- */
  const isCustomerContext =
  isSale || isQuotation || isCustomerReturn;

const isSupplierContext =
  isPurchase || isSupplierReturn;

const customerId = isCustomerContext
  ? selectedCustomerId ?? null
  : null;

const supplierId = isSupplierContext
  ? selectedSupplierId ?? null
  : null;

const customerName = isCustomerContext
  ? selectedCustomer?.name ||
    customerInput?.trim() ||
    "Walk-in Customer"
  : "";

const supplierName = isSupplierContext
  ? selectedSupplier?.name ||
    supplierInput?.trim() ||
    "Direct Purchase"
  : "";

const dues = isSupplierContext
  ? supplierBalance
  : customerArrears;

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
   4️⃣ GRAND TOTAL (MODE-AWARE)
-------------------------------------------------- */
const baseAmount = subtotalAfterDiscount + invoiceTax;

let invoicePayable = 0;

// 🔹 dues should already be either customerArrears or supplierBalance
// 🔹 baseAmount should be your invoiceTotal (subtotal - discount + tax)

if (isSale || isPurchase) {
  invoicePayable = dues + baseAmount;
}
else if (isCustomerReturn || isSupplierReturn) {
  invoicePayable = dues - baseAmount;
}


let grandTotal = 0;

if (isReturn) {
  // 🔁 Return reduces customer arrears
  grandTotal = dues - baseAmount;
} else if (isSale || isPurchase) {
  grandTotal = baseAmount + dues;
} else {
  // Quotation
  grandTotal = baseAmount;
}

const paidAmountRaw = Number(paid) || 0;
const paidAmount = isReturn ? -Math.abs(paidAmountRaw) : paidAmountRaw;

const arrears = grandTotal - paidAmount;

  /* --------------------------------------------------
   5️⃣ PROFIT (SALE & RETURN)
-------------------------------------------------- */
let profit = 0;

if (isSale || isCustomerReturn) {
  cart.forEach(item => {
    const lineBase = item.qty * item.minUnitPrice;
    const costBase = item.qty * item.costPrice;

    const discountAmt =
      item.discountType === "%"
        ? (lineBase * item.discountValue) / 100
        : item.discountValue;

    const lineProfit = lineBase - discountAmt - costBase;

    profit += isSale ? lineProfit : -lineProfit;
  });
}


  /* --------------------------------------------------
     6️⃣ PREPARE ITEMS
  -------------------------------------------------- */
  const transactionItems = cart.map(ci => ({
  originalItemId: ci.originalItemId,
  name: ci.name,
  qty: ci.qty,
  price: ci.minUnitPrice,
  priceCategory: ci.priceCategory,

  // ✅ SAVE USER INPUT (NOT CALCULATED VALUES)
  discountType: ci.discountType,
  discountValue: ci.discountValue,

  taxType: ci.taxType,
  taxValue: ci.taxValue,
  
  costPrice: ci.costPrice,
  batchId: ci.batchId ?? null,
}));

  /* --------------------------------------------------
     7️⃣ SAVE TRANSACTION
  -------------------------------------------------- */
  const saleId = await salesRepository.addTransaction({
    invoiceNo,
    date: selectedDate ? new Date(selectedDate).toISOString() : new Date().toISOString(),
    transactionType,

    customerId,
    customerName: isCustomerContext ? customerName : "",

    supplierId,
    supplierName: isSupplierContext ? supplierName : "",

    subtotal: invoiceSubtotal,
    discount: invoiceDiscount,
    tax: invoiceTax,

    dues,
    grandTotal,
    paid: paidAmount,
    arrears,
    profit,
    isPostponed,

    items: transactionItems,
  });


/* --------------------------------------------------
   🔥 CYLINDER MANAGEMENT (SALE ONLY)
-------------------------------------------------- */
/* --------------------------------------------------
   🔥 CYLINDER MANAGEMENT (ALL MODES)
-------------------------------------------------- */
if (isSale || isPurchase || isCustomerReturn || isSupplierReturn) {

  for (const ci of cart) {

    const item = await itemsRepository.getById(ci.originalItemId);
    if (!item) continue;

    const isCylinder =
      (item.category || "").toLowerCase().includes("gas") ||
      (item.category || "").toLowerCase().includes("cylinder");

    if (!isCylinder) continue;

    /* ---------------- NORMALIZE TO MAX UNIT ---------------- */
    const convQty = Number(item.ConvQty || 1);

    // 🔥 ALWAYS treat cart qty as MIN UNIT
    const qty = Math.floor(ci.qty / convQty);

    if (qty <= 0) continue;

    /* ---------------- GET CYLINDER ---------------- */
    const cylinder = await cylinderRepo_getByItemId(item.id!);

    if (!cylinder || cylinder.isDeleted) {
      console.warn("Cylinder not found for item:", item.id);
      continue;
    }

    /* ==================================================
       🔥 APPLY LOGIC PER TRANSACTION TYPE
    ================================================== */

    let updatedCylinder = { ...cylinder };

    /* ---------------- SALE ---------------- */
    if (isSale) {
      updatedCylinder.filledCylinders -= qty;
      updatedCylinder.withCustomers += qty;

      // CUSTOMER HOLDING
      if (customerName && cylinder.id) {
        await cylinderCustomerRepo_addOrUpdate({
          cylinderId: cylinder.id,
          cylinderType: cylinder.title,
          customerName,
          qtyChange: qty,
        });
      }
    }

    /* ---------------- PURCHASE ---------------- */
    if (isPurchase) {
      updatedCylinder.filledCylinders += qty;
    }

    /* ---------------- CUSTOMER RETURN ---------------- */
    if (isCustomerReturn) {
      updatedCylinder.filledCylinders += qty;
      updatedCylinder.withCustomers -= qty;

      // reduce customer holding
      if (customerName && cylinder.id) {
        await cylinderCustomerRepo_addOrUpdate({
          cylinderId: cylinder.id,
          cylinderType: cylinder.title,
          customerName,
          qtyChange: -qty, // 🔥 subtract
        });
      }
    }

    /* ---------------- SUPPLIER RETURN ---------------- */
    if (isSupplierReturn) {
      updatedCylinder.filledCylinders -= qty;
    }

    /* ---------------- SAFETY ---------------- */
    updatedCylinder.filledCylinders = Math.max(0, updatedCylinder.filledCylinders);
    updatedCylinder.withCustomers = Math.max(0, updatedCylinder.withCustomers);
    updatedCylinder.emptyCylinders = Math.max(0, updatedCylinder.emptyCylinders);

    /* ---------------- SAVE ---------------- */
    await cylinderRepo_update(updatedCylinder);
  }
}

  /* --------------------------------------------------
   8️⃣ UPDATE CUSTOMER (SALE & RETURN)
-------------------------------------------------- */
if ((isSale || isReturn) && customerId) {
  const customer = await customersRepository.getById(customerId);
  if (customer) {

    const effectivePaid = isReturn
      ? -Math.abs(paidAmountRaw)
      : paidAmountRaw;

    const newPayable =
      isReturn
        ? (customer.payable ?? 0) - baseAmount
        : (customer.payable ?? 0) + baseAmount;

    const newPaid = (customer.paid ?? 0) + effectivePaid;
    const newBalance = newPayable - newPaid;

    await customersRepository.update({
      ...customer,
      payable: newPayable,
      paid: newPaid,
      balance: newBalance,
      invoices: (customer.invoices ?? 0) + 1,
    });

    // 🔁 Payment entry (negative for Return)
    if (effectivePaid !== 0) {
      await customerPaymentRepository.add({
        customerId: customer.id!,
        customerName: customer.name,
        invoiceNo,
        amount: effectivePaid, // NEGATIVE for Return
        paymentDate: new Date().toISOString(),
        remarks: isReturn
          ? `Return adjustment ${invoiceNo}`
          : invoiceNo,

        // ✅ FIXED
        payableSnapshot: invoicePayable,
        balanceSnapshot: newBalance,
      });
}
  }
}

  /* --------------------------------------------------
     9️⃣ UPDATE SUPPLIER (PURCHASE)
  -------------------------------------------------- */
  if ((isPurchase || isSupplierReturn) && supplierId) {
  const supplier = await supplierRepo.getById(supplierId);
  if (supplier) {

    const effectivePaid = isSupplierReturn
      ? -Math.abs(paidAmount)
      : paidAmount;

    const newPayable =
      isSupplierReturn
        ? (supplier.payable ?? 0) - baseAmount
        : (supplier.payable ?? 0) + baseAmount;

    const newPaid = (supplier.paid ?? 0) + effectivePaid;

    const newBalance = newPayable - newPaid;

    await supplierRepo.update({
      ...supplier,
      payable: newPayable,
      paid: newPaid,
      balance: newBalance,
      invoices: (supplier.invoices ?? 0) + 1,
    });

    // 🔁 Payment entry (negative for Supplier Return)
    if (effectivePaid !== 0) {
      await supplierPaymentRepository.add({
        supplierId: supplier.id!,
        supplierName: supplier.name,
        invoiceNo,
        amount: effectivePaid, // NEGATIVE for Supplier Return
        paymentDate: new Date().toISOString(),
        remarks: isSupplierReturn
          ? `Supplier Return adjustment ${invoiceNo}`
          : invoiceNo,

        payableSnapshot: invoicePayable,
        balanceSnapshot: newBalance,
      });
    }
  }
}

/* --------------------------------------------------
   🔟 UPDATE STOCK + CREATE BATCHES
-------------------------------------------------- */

for (const ci of cart) {
  const item = await itemsRepository.getById(ci.originalItemId);
  if (!item) continue;

  let newStock = item.availableStock;

  /* ---------------- SALE ---------------- */
  if (isSale) {
    newStock -= ci.qty;

    // ✅ UPDATE EXISTING BATCH (reduce stock)
    if (ci.batchId) {
      const batches = await batchRepository.getAllBatchesByItem(ci.originalItemId);
      const batch = batches.find(b => b.id === ci.batchId);

      if (batch) {
        batch.qtySold += ci.qty;
        batch.balance -= ci.qty;

        await batchRepository.updateBatch(batch);
      }
    }
  }

  /* ---------------- PURCHASE ---------------- */
  if (isPurchase) {
    newStock += ci.qty;

    await batchRepository.addBatch({
      itemId: ci.originalItemId,
      purchaseDate: selectedDate
        ? new Date(selectedDate).toISOString()
        : new Date().toISOString(),

      qtyPurchased: ci.qty,
      qtySold: 0,
      balance: ci.qty,

      costPrice: ci.minUnitPrice,

      sourceSaleId: saleId,
      invoiceNo,
    });
  }

  /* ---------------- CUSTOMER RETURN ---------------- */
  if (isCustomerReturn) {
    newStock += ci.qty;

    // ✅ CREATE NEW RETURN BATCH (your chosen design)
    await batchRepository.addBatch({
      itemId: ci.originalItemId,
      purchaseDate: new Date().toISOString(),

      qtyPurchased: ci.qty,
      qtySold: 0,
      balance: ci.qty,

      // 🔥 CRITICAL: ORIGINAL COST
      costPrice: ci.costPrice,

      sourceSaleId: saleId,
      invoiceNo,
    });
  }

  /* ---------------- SUPPLIER RETURN ---------------- */
if (isSupplierReturn) {
  newStock -= ci.qty;

  if (!ci.batchId) continue;

  const batches = await batchRepository.getAllBatchesByItem(ci.originalItemId);
  const batch = batches.find(b => b.id === ci.batchId);

  if (!batch) {
    console.warn("Batch not found:", ci.batchId);
    continue;
  }

  if (ci.qty > batch.balance) {
    alert("Cannot return more than available batch balance");
    continue;
  }

  batch.qtyPurchased -= ci.qty;
  batch.balance -= ci.qty;

  await batchRepository.updateBatch(batch);
}

  /* ---------------- SAVE STOCK ---------------- */
  await itemsRepository.update({
    ...item,
    availableStock: newStock,
  });
}

// ✅ refresh customers so latest dues appear
const updatedCustomers = await customersRepository.getAll();

setCustomers(
  updatedCustomers.map(mapDbCustomerToPosCustomer)
);

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

  setReturnMode("customer"); // ✅ IMPORTANT


  /* --------------------------------------------------
     1️⃣2️⃣ NEXT INVOICE
  -------------------------------------------------- */
 const prefix =
  transactionType === "Sale"
    ? "SAL"
    : transactionType === "Purchase"
    ? "PUR"
    : transactionType === "Return"
    ? returnMode === "supplier"
      ? "RET-S"
      : "RET-C"
    : "QTN";

  const nextInvoice = await getNextInvoiceNoFromDB(prefix);
  setInvoiceNo(nextInvoice);

  const shouldPrint = window.confirm(
  `Transaction saved.\n\nDo you want to print the invoice?`
);

if (shouldPrint) {

  const previousDues = isCustomerContext
  ? customerArrears ?? 0
  : isSupplierContext
  ? supplierBalance ?? 0
  : 0;

  await printInvoice({

    invoiceNo,
    date: new Date(),
    name: isCustomerContext
    ? customerName
    : isSupplierContext
    ? supplierName
    : "Walk-in Customer", // fallback,
    previousDues,

    items: transactionItems,
    subtotal: invoiceSubtotal,
    discount: invoiceDiscount,
    tax: invoiceTax,
    grandTotal,
    paid: paidAmount,
    arrears,
  });
}

// alert(`${transactionType} completed successfully. Invoice #${invoiceNo}`);
}

async function handleHoldTransaction() {
  if (cart.length === 0) {
    alert("Cart is empty");
    return;
  }

  /* -----------------------------
     CALCULATE TOTALS
  ------------------------------*/
  let subtotal = 0;

  cart.forEach(item => {
    const line = calcLine(item);
    subtotal += line.total;
  });

  const discount =
    discountMode === "percentage"
      ? (subtotal * Number(discountValue)) / 100
      : Number(discountValue) || 0;

  const afterDiscount = subtotal - discount;

  const tax =
    taxMode === "percentage"
      ? (afterDiscount * Number(taxValue)) / 100
      : Number(taxValue) || 0;

  const grandTotal = afterDiscount + tax;

  /* -----------------------------
     PREPARE ITEMS
  ------------------------------*/
  const heldItems: Omit<DBHeldItem, "id" | "heldId">[] = cart.map(ci => ({
    originalItemId: ci.originalItemId,
    name: ci.name,
    qty: ci.qty,
    price: ci.minUnitPrice,

    convQty: ci.convQty,

    priceCategory: ci.priceCategory,

    discountType: ci.discountType,
    discountValue: ci.discountValue,
    taxType: ci.taxType,
    taxValue: ci.taxValue,

    // ✅ separation restored
    unitMode: ci.unit,
    unit: ci.unit === "min" ? ci.minunit : ci.maxunit,

    costPrice: ci.costPrice,
  }));

  /* -----------------------------
     SAVE HOLD
  ------------------------------*/
heldRepository.addHeld(
  {
    invoiceNo,
    date: selectedDate.toString(),
    transactionType,
    customerId: selectedCustomerId ?? null,
    supplierId: selectedSupplierId ?? null,
    customerName: selectedCustomer?.name ?? "Walk-in Customer",
    supplierName: selectedSupplier?.name ?? "Direct Purchase",
    subtotal,
    discount,
    tax,
    grandTotal,
    paid: Number(paid) || 0,
    discountMode: discountMode === "percentage" ? "%" : "flat",
    discountValue,
    taxMode: taxMode === "percentage" ? "%" : "flat",
    taxValue,
    returnMode: returnMode ?? undefined,
  } as Omit<DBHeld, "items">, // ⚡ correct
  heldItems
);

  // refresh held list
  const updatedHeldList = await heldRepository.getAll();
  setHeldList(updatedHeldList);
  
  cancelSale();

  alert("Transaction placed on HOLD");
}

async function resumeHeld(heldId: number) {
  const held = heldList.find(h => h.id === heldId);
  if (!held) return;

  const items = await heldRepository.getItemsByHeldId(heldId);

  setPaid(held.paid);
  setReturnMode(held.returnMode ?? "customer");

  // TEMP: just store IDs, actual objects will be restored by useEffect
  setResumeCustomerId(held.customerId ?? null);
  setResumeSupplierId(held.supplierId ?? null);

  setDiscountMode(held.discountMode === "%" ? "percentage" : "Fixed Amount");
  setDiscountValue(held.discountValue);

  setTaxMode(held.taxMode === "%" ? "percentage" : "Fixed Amount");
  setTaxValue(held.taxValue);

  setSelectedDate(held.date);

  const restoredCart: CartItem[] = items.map(heldItem => ({
    id: heldItem.id ?? 0,
    originalItemId: heldItem.originalItemId,
    name: heldItem.name,
    unit: heldItem.unitMode,
    minunit: heldItem.unit,
    maxunit: heldItem.unit,
    convQty: heldItem.convQty ?? 1,
    qty: heldItem.qty,
    minUnitPrice: heldItem.price,
    priceCategory: heldItem.priceCategory,
    discountType: heldItem.discountType,
    discountValue: heldItem.discountValue,
    taxType: heldItem.taxType,
    taxValue: heldItem.taxValue,
    uiDeductedQty: 0,
    costPrice: heldItem.costPrice ?? heldItem.price,
  }));

  setCart(restoredCart);

  await heldRepository.deleteHeld(heldId);
  setShowHeld(false);
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

  // ✅ After loading customers
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

    setCustomers(
  mapped.map(mapDbCustomerToPosCustomer)
);
    customersLoadedRef.current = true;

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
    let prefix: string;

    if (transactionType === "Return") {
      prefix = returnMode === "supplier" ? "RET-S" : "RET-C";
    } else if (transactionType === "Purchase") {
      prefix = "PUR";
    } else if (transactionType === "Sale") {
      prefix = "SAL";
    } else {
      prefix = "QTN";
    }

    const nextInvoice = await getNextInvoiceNoFromDB(prefix);
    setInvoiceNo(nextInvoice);
  }

  refreshInvoiceNo();
}, [transactionType, returnMode]);

useEffect(() => {
  supplierRepo.getAll().then(data =>
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
  if (!isReturn || returnMode !== "supplier") return;
  if (!selectedSupplierId) return;

  const supplier = suppliers.find(s => s.id === selectedSupplierId);
  if (!supplier) return;

  // Supplier arrears (balance)
  setSupplierBalance(supplier.balance ?? 0);

  // Force PAID to be negative for Supplier Return (if applicable)
  setPaid(prev => (prev > 0 ? -prev : prev));
}, [isReturn, returnMode, selectedSupplierId, suppliers]);

useEffect(() => {
  if (returnMode === "customer") {
    setFilteredCustomers(customers);
    setCustomerInput("Walk-in Customer");
    setSelectedCustomerId(null);
    setIsCustomerOpen(false);
  } else {
    setFilteredSuppliers(suppliers);
    setSupplierInput("Direct Purchase");
    setSelectedSupplierId(null);
    setIsSupplierOpen(false);
  }
}, [returnMode, customers, suppliers]);

useEffect(() => {
  if (transactionType !== "Return") return;

  const treatAsPurchase = returnMode === "supplier";

  setCart(prev =>
    prev.map(ci => {
      const item = items.find(i => i.id === ci.originalItemId);
      if (!item) return ci;

      return {
        ...ci,
        minUnitPrice: treatAsPurchase
          ? item.purchasePrice ?? 0
          : item.retailPrice,
      };
    })
  );
}, [returnMode, transactionType, items]);

  // =====================
  // CART LOGIC
  // =====================

function cancelSale() {
  setItems(prev =>
    prev.map(i => {
      const ci = cart.find(c => c.originalItemId === i.id);
      if (!ci) return i;

      // SALE → restore all deducted stock
      if (!isPurchase && !isReturn && !isQuotation) {
        return {
          ...i,
          availableStock: i.availableStock + ci.qty, // use total qty in cart, not uiDeductedQty
        };
      }

      // PURCHASE → rollback added stock
      if (isPurchase) {
        return {
          ...i,
          availableStock: i.availableStock - ci.qty,
        };
      }

      // RETURN → rollback stock based on return type
      if (isReturn) {
        if (returnMode === "customer") {
          // Customer return → stock increases
          return {
            ...i,
            availableStock: i.availableStock - ci.qty,
          };
        }
        if (returnMode === "supplier") {
          // Supplier return → stock decreases
          return {
            ...i,
            availableStock: i.availableStock + ci.qty,
          };
        }
      }

      return i;
    })
  );

  // Reset POS state
setCart([]);
setPaid(0);
setDiscountValue(0);
setTaxValue(0);

// Reset parties
setSelectedCustomerId(null);
setCustomerInput("Walk-in Customer");

setSelectedSupplierId(null);
setSupplierInput("Direct Purchase");

// Reset return mode safely
if (isReturn) {
  setReturnMode("customer"); // default return
}

}

async function loadHeldTransactions() {
  const held = await heldRepository.getAllHeld();
  setHeldList(held.reverse()); // newest first
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

  const isSupplierReturn =
    transactionType === "Return" && returnMode === "supplier";

  const treatAsPurchase =
    transactionType === "Purchase" || isSupplierReturn;

  // ❌ Block ONLY when stock must decrease
  // if (stockDecreases && item.availableStock <= 0) return;

  // 1️⃣ Update UI stock (UNCHANGED)
  setItems(prev =>
    prev.map(i => {
      if (i.id !== item.id) return i;

      if (stockDecreases) {
        return { ...i, availableStock: i.availableStock - 1 };
      }

      if (stockIncreases) {
        return { ...i, availableStock: i.availableStock + 1 };
      }

      return i;
    })
  );

  // 2️⃣ Add to cart
  setCart(prev => {
    const existing = prev.find(ci => ci.originalItemId === item.id);

    if (existing) {
      return prev.map(ci =>
        ci.originalItemId === item.id
          ? {
              ...ci,
              qty: ci.qty + 1,
              uiDeductedQty: stockDecreases
                ? ci.uiDeductedQty + 1
                : ci.uiDeductedQty,
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

    minUnitPrice: treatAsPurchase
      ? item.purchasePrice ?? 0
      : item.retailPrice,

    convQty: item.ConvQty,
    minunit: item.minunit,
    maxunit: item.maxunit,

    costPrice: item.purchasePrice ?? 0,

    priceCategory: "Retail", // ✅ VALID CartItem type

    discountType: "%",
    discountValue: 0,
    taxType: "%",
    taxValue: 0,

    originalItemId: item.id!,
    uiDeductedQty: stockDecreases ? 1 : 0,
  },
];

  });
}

function updateItem(updated: CartItem) {
  const originalItem = items.find(i => i.id === updated.originalItemId);
  if (!originalItem) return;

  const prevCartItem = cart.find(ci => ci.id === updated.id);
  if (!prevCartItem) return;

  /* --------------------------------------------------
     1️⃣ Compute new MIN-unit qty
  -------------------------------------------------- */
  const newQtyMin =
    updated.unit === "max"
      ? updated.qty * originalItem.ConvQty
      : updated.qty;

  const roundedQty = roundTo(newQtyMin, 2);

  /* --------------------------------------------------
     2️⃣ Compute diff against previous qty
  -------------------------------------------------- */
  const diff = roundedQty - prevCartItem.qty;

  /* --------------------------------------------------
     3️⃣ Update UI stock
  -------------------------------------------------- */
  setItems(prev =>
    prev.map(i => {
      if (i.id !== originalItem.id) return i;

      if (stockDecreases) {
        return {
          ...i,
          availableStock: roundTo(i.availableStock - diff, 2),
        };
      }

      if (stockIncreases) {
        return {
          ...i,
          availableStock: roundTo(i.availableStock + diff, 2),
        };
      }

      return i;
    })
  );

  /* --------------------------------------------------
     4️⃣ PRICE — DO NOT RECALCULATE
     Use the edited price from modal
     (already MIN UNIT price)
  -------------------------------------------------- */
  const roundedMinUnitPrice = roundTo(updated.minUnitPrice, 2);

  /* --------------------------------------------------
     5️⃣ Update cart item
  -------------------------------------------------- */
  setCart(prev =>
    prev.map(ci =>
      ci.id === updated.id
        ? {
            ...ci,
            qty: roundedQty,
            unit: updated.unit,
            priceCategory: updated.priceCategory,
            discountType: updated.discountType,
            discountValue: updated.discountValue,
            taxType: updated.taxType,
            taxValue: updated.taxValue,
            minUnitPrice: roundedMinUnitPrice, // 🔥 use edited price
            convQty: originalItem.ConvQty,
            uiDeductedQty: !isPurchase && !isReturn ? roundedQty : 0,
            costPrice: updated.costPrice ?? ci.costPrice,
            batchId: updated.batchId ?? ci.batchId,
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

  /* --------------------------------------------------
     1️⃣ Restore / rollback UI stock (mode-aware)
  -------------------------------------------------- */
  setItems(prev =>
    prev.map(i => {
      if (i.id !== item.id) return i;

      if (!isPurchase && !isReturn) {
        // SALE → restore deducted stock
        return { ...i, availableStock: i.availableStock + cartItem.qty };
      }

      if (isPurchase || isReturn) {
        // PURCHASE or RETURN → rollback added stock
        return { ...i, availableStock: i.availableStock - cartItem.qty };
      }

      return i; // Quotation
    })
  );

  /* --------------------------------------------------
     2️⃣ Remove from cart
  -------------------------------------------------- */
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

  // Only invoices of this prefix
  const sameTypeSales = allSales.filter(s =>
    s.invoiceNo?.startsWith(`${prefix}-`)
  );

  if (sameTypeSales.length === 0) {
    return `${prefix}-0001`;
  }

  const latestNumber =
    Math.max(
      ...sameTypeSales
        .map(s => {
          const match = s.invoiceNo?.match(/(\d+)$/);
          return match ? Number(match[1]) : 0;
        })
        .filter(n => !isNaN(n))
    ) || 0;

  return `${prefix}-${String(latestNumber + 1).padStart(4, "0")}`;
}


function formatStock(
  stockMin: number,
  convQty: number,
  minUnit: string,
  maxUnit: string
) {
  const roundedStock = +stockMin.toFixed(2);

  if (convQty <= 0) {
    return `${roundedStock} ${minUnit}`;
  }

  const max = Math.floor(roundedStock / convQty);

  // Avoid floating precision issues
  const remainderRaw = roundedStock - max * convQty;
  const min = +remainderRaw.toFixed(2);

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
  let subtotal = 0;
  let cartItemDiscount = 0;

  cart.forEach(i => {
    const r = calcLine(i);
    subtotal += r.total;
    cartItemDiscount += r.discount;
  });

  const invoiceDiscountAmount = applyAdjustment(
  subtotal,
  discountValue > 0
    ? { type: discountMode, value: discountValue }
    : null
);

  const invoiceTaxAmount = applyAdjustment(
    subtotal - invoiceDiscountAmount,
    taxValue > 0
  ? { type: taxMode, value: taxValue }
  : null
  );

  const invoiceTotal = subtotal - invoiceDiscountAmount + invoiceTaxAmount;

  // 🔹 Previous arrears
  let previousArrears = 0;
  if (!isPurchase && returnMode !== "supplier") {
    // Customer or Sale
    previousArrears = selectedCustomerId ? customerArrears : 0;
  } else if (isPurchase || (isReturn && returnMode === "supplier")) {
    // Supplier / Supplier Return
    previousArrears = selectedSupplierId ? supplierBalance : 0;
  }

  // 🔹 Total payable BEFORE considering paid amount
  let totalPayable = 0;
  if (isReturn && returnMode === "customer") {
    // Customer Return: reduce invoice from arrears
    totalPayable = previousArrears - invoiceTotal;
  } else if (isReturn && returnMode === "supplier") {
    // Supplier Return: reduce what we owe to supplier
    totalPayable = previousArrears - invoiceTotal;
  } else {
    // Sale / Purchase
    totalPayable = previousArrears + invoiceTotal;
  }

  return {
    subtotal,
    cartItemDiscount,
    discount: invoiceDiscountAmount,
    tax: invoiceTaxAmount,
    arrears: previousArrears,
    invoiceTotal,
    grandTotal: totalPayable, // total payable before paid
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
  selectedCustomerId,
  selectedSupplierId,
  isReturn,
  isPurchase,
  returnMode,
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
}, [items, selectedCategory, selectedBrand, search, treatAsPurchase]);

const balance = useMemo(() => {
  const paidValue = paid || 0; // on UI for return, paid is already negative
  return totals.grandTotal - paidValue;
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
  // 🔁 Purchase & Supplier Return use purchase price
  if (treatAsPurchase) {
    return item.purchasePrice ?? 0;
  }

  if (category === "Discount") return item.discountPrice ?? item.retailPrice;
  if (category === "Wholesale") return item.wholesalePrice ?? item.retailPrice;
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

const priceForDisplay = (
  minPrice: number,
  unit: UnitType,
  convQty: number
) => {
  const value =
    unit === "min"
      ? minPrice
      : minPrice * convQty;

  return parseFloat(value.toFixed(2));
};

function formatStockDisplay(
  minQty: number,
  convQty: number,
  minUnit: string,
  maxUnit: string
) {
  if (!convQty || convQty <= 0) {
    return `${minQty} ${minUnit}`;
  }

  const max = Math.trunc(minQty / convQty);
  const min = minQty % convQty;

  if (max > 0 && min > 0) {
    return `${max}${maxUnit} ${min.toFixed(1)}${minUnit}`;
  }

  if (max > 0) {
    return `${max}${maxUnit}`;
  }

  if (max < 0 || min < 0) {
    return `${max}${maxUnit} ${min.toFixed(1)}${minUnit}`;
  }

  return `${min}${minUnit}`;
}

const isCustomerContext =
  isSale ||
  isQuotation ||
  (isReturn && returnMode === "customer");

const isSupplierContext =
  isPurchase ||
  (isReturn && returnMode === "supplier");

const dropdownList = isSupplierContext ? filteredSuppliers : filteredCustomers;
const selectedId = isSupplierContext ? selectedSupplierId : selectedCustomerId;
const inputValue = isSupplierContext ? supplierInput : customerInput;
const setInputValue = isSupplierContext ? setSupplierInput : setCustomerInput;
const setSelectedId = isSupplierContext ? setSelectedSupplierId : setSelectedCustomerId;

return (
    <div className="h-full flex bg-gray-100">

      {/* LEFT – ITEMS */}
      <div className="w-2/3 p-4 border-r bg-white flex flex-col">
  {/* Top controls */}
  <div className="flex gap-2 mb-3">
    {/* Transaction Type Selector */}
    <div className="flex items-center gap-4 mb-3">
  {transactionTypes.map(type => (
    <label
      key={type.value}
      className={`flex items-center gap-2 px-3 py-1 rounded cursor-pointer transition
        ${
          transactionType === type.value
            ? "bg-indigo-600 text-white"
            : "bg-gray-200 text-gray-700 hover:bg-gray-300"
        }
      `}
    >
      <input
        type="radio"
        name="transactionType"
        value={type.value}
        className="hidden"
        checked={transactionType === type.value}
        onChange={() => handleTransactionTypeChange(type.value)}
      />
      {type.label}
    </label>
  ))}
</div>

    <input
      type="text"
      placeholder={t("searchitembarcode")}
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
  <option value="">{t("allcategories")}</option>
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
  <option value="">{t("allbrands")}</option>
  {Brands.map((b) => (
    <option key={b.id} value={b.name}>
      {b.name}
    </option>
  ))}
</select>

    <button
      className="w-full flex items-center justify-center gap-2 bg-white text-black border-2 px-4 py-2 rounded hover:bg-gray-100 transition"
      onClick={async () => {await loadHeldTransactions();
                              setShowHeld(true);
  }}
    >
      <FaEye />  Held {transactionType}s
    </button>
  </div>

{/* Items grid */}
<div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 auto-rows-min overflow-y-auto max-h-[calc(100vh-170px)]">
  {filteredItems.length === 0 ? (
    <div className="col-span-4 text-center text-gray-500 text-sm py-10">
      No items found. Adjust your search, category, or brand filters.
    </div>
  ) : (
    filteredItems.map(item => {
      // 🔹 Dynamic display price based on mode
      const treatAsPurchase =
      transactionType === "Purchase" ||
      (transactionType === "Return" && returnMode === "supplier");

      const displayPrice = treatAsPurchase
      ? item.purchasePrice ?? 0
      : item.retailPrice;


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
            <span className="text-yellow-500">Rs {displayPrice.toFixed(1)}</span> |{" "}
            {/* {item.availableStock > 0
              ?  */
              formatStockDisplay(
                  item.availableStock,
                  item.ConvQty,
                  item.minunit,
                  item.maxunit
                )
              // : item.availableStock
            }
          </div>

          {item.availableStock <= 0 && (
            <div className="text-red-500 text-xs font-semibold mt-1">
              {t("outofstock")}
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
      {t("invoice")}: {invoiceNo}
    </div>

 {transactionType === "Return" ? (
  <div className="flex gap-4 text-sm font-semibold text-gray-400">
    <label className="flex items-center gap-1 cursor-pointer">
      <input
        type="radio"
        name="returnMode"
        value="customer"
        checked={returnMode === "customer"}
        onChange={() => setReturnMode("customer")}
      />
      {t("customerreturn")}
    </label>

    <label className="flex items-center gap-1 cursor-pointer">
      <input
        type="radio"
        name="returnMode"
        value="supplier"
        checked={returnMode === "supplier"}
        onChange={() => setReturnMode("supplier")}
      />
      {t("supplierreturn")}
    </label>
  </div>
) : (
  <div className="text-sm text-gray-700">
    {t("totalitems")}: <span className="font-semibold">{cart.length}</span>
  </div>
)}
</div>

{/* Row 2: Date + Customer / Supplier */}
<div className="flex justify-between items-center">
  {/* Date */}
  <div className="flex items-center gap-2 text-sm">
    <span>{t("date")}:</span>
    <input
      type="date"
      className="border px-2 py-1 rounded text-sm"
      value={selectedDate}
      onChange={(e) => setSelectedDate(e.target.value)}
    />
  </div>

  {/* Customer / Supplier */}
  <div className="flex items-center gap-2">
    <div className="relative w-56">
      {(() => {
        const showSupplier =
          isPurchase || (transactionType === "Return" && returnMode === "supplier");

        return (
          <>
            <input
              type="text"
              className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
              value={showSupplier ? supplierInput : customerInput}
              onFocus={() =>
                showSupplier
                  ? setIsSupplierOpen(true)
                  : setIsCustomerOpen(true)
              }
              onChange={(e) => {
                const val = e.target.value;

                if (showSupplier) {
                  setSupplierInput(val);
                  setSelectedSupplierId(null);
                  setIsSupplierOpen(true);
                } else {
                  setCustomerInput(val);
                  setSelectedCustomerId(null);
                  setFilteredCustomers(
                    customers.filter(c =>
                      c.name.toLowerCase().includes(val.toLowerCase())
                    )
                  );
                  setIsCustomerOpen(true);
                }
              }}
              onBlur={() => {
                setTimeout(() => {
                  if (showSupplier) {
                    setIsSupplierOpen(false);
                    if (!supplierInput.trim()) {
                      setSupplierInput("Direct Purchase");
                      setSelectedSupplierId(null);
                      setSupplierBalance(0); // ✅ reset arrears
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

            {/* Supplier Dropdown */}
            {showSupplier && isSupplierOpen && filteredSuppliers.length > 0 && (
              <div className="absolute z-20 mt-1 w-full bg-white border rounded shadow max-h-48 overflow-y-auto">
                {filteredSuppliers.map(s => (
                  <div
                    key={s.id}
                    className="px-2 py-1 text-sm cursor-pointer hover:bg-indigo-100"
                   onMouseDown={() => {
                  setSelectedSupplierId(s.id!);
                  setSupplierInput(s.name);

                  // ✅ LOAD PREVIOUS ARREARS
                  setSupplierBalance(s.balance ?? 0);

                  setIsSupplierOpen(false);
                      }}
                  >
                    {s.name}
                  </div>
                ))}
              </div>
            )}

            {/* Customer Dropdown */}
            {!showSupplier && isCustomerOpen && filteredCustomers.length > 0 && (
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
            )}
          </>
        );
      })()}
    </div>

    {currentUser?.role === "admin" && (
  <button
    onClick={() => {
      const showSupplier =
        isPurchase || (transactionType === "Return" && returnMode === "supplier");

      showSupplier
        ? setShowSupplierModal(true)
        : setShowCustomerModal(true);
    }}
    className="p-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
    title={
      isPurchase || (transactionType === "Return" && returnMode === "supplier")
        ? t("addnewsupplier")
        : t("addnewcustomer")
    }
  >
    <FaPlus size={12} />
  </button>
)}

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
                            {priceForDisplay(ci.minUnitPrice, ci.unit, ci.convQty)}</span>  | <span className="text-green-400">{t("disc")}: {ci.discountValue}{ci.discountType}</span> | <span className="text-red-400">{t("tax")}: {ci.taxValue}{ci.taxType}</span>
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
        <span>{t("subtotal")}</span>
        <span>{totals.subtotal.toFixed(2)}</span>
      </div>

      <div className="flex justify-between">
        <span>{t("discount")} 
        <button
        className="ml-1 text-[10px] px-1 border rounded bg-green-500 text-white"
        onClick={() => setShowInvoiceDiscountModal(true)}>
            +
    </button>
        </span>
        <span>-{totals.discount.toFixed(2)}</span>
      </div>

      <div className="flex justify-between">
        <span>{t("tax")}
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
      <span>{t("previousdues")}</span>
      <span>{customerArrears.toFixed(2)}</span>
    </div>
)}

{(isPurchase || isSupplierReturn) &&
  selectedSupplierId !== null &&
  supplierBalance > 0 && (
    <div className="flex justify-between text-red-600 font-medium">
      <span>{t("previousdues")}</span>
      <span>{supplierBalance.toFixed(2)}</span>
    </div>
)}

      <div className="flex justify-between font-semibold border-t pt-2 text-base">
        <span className="text-blue-600">{t("payableamount")}</span>
        <span className="text-blue-600">{totals.grandTotal.toFixed(2)}</span>
      </div>
    </div>

    {/* RIGHT COLUMN — PAYMENT INFO (UI ONLY, NO NEW VARIABLES) */}
    <div className="space-y-3 mt-1">
       <div className="flex items-center gap-4 ml-2">
          <label className="text-xl font-medium text-green-500 whitespace-nowrap">
            {t("paid")}
          </label>

          <input
              type="number"
              value={paid}
              onChange={(e) => {
                let val = Number(e.target.value) || 0;

                if (transactionType === "Return") {
                  val = -Math.abs(val); // 🔴 force negative
                }

                setPaid(val);
              }}
              className="flex-1 p-2 border w-full rounded text-center text-xl text-green-500"
            />

        </div>

      <div className="flex justify-between items-center bg-gray-50 p-3 rounded">
        <span className="font-medium text-xl text-red-600">{t("balance")}</span>
        <span className="text-lg font-bold text-red-600 mr-10">
          {balance.toFixed(2)}
        </span>
      </div>
    </div>
  </div>

  {/* ACTION BUTTONS — UNCHANGED */}
  <div className="flex gap-2 mt-2">
    <button
      className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
      onClick={() => handleCompleteTransaction(false)}
    >
      <FaCheck /> {t("complete")} {t(transactionType.toLowerCase())}
    </button>

    <button
      className="flex-1 flex items-center justify-center gap-2 bg-yellow-500 text-white px-4 py-2 rounded hover:bg-red-600 transition"
      onClick={() => handleCompleteTransaction(true)}
    >
      <FaClock /> {t("postpone")} {t(transactionType.toLowerCase())}
    </button>
    
  </div>

  <div className="flex gap-2 mt-1">
    <button
      className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
      onClick={handleHoldTransaction}
    >
      <FaHandHoldingUsd /> {t("hold")} {t(transactionType.toLowerCase())}
    </button>

    <button
      className="flex-1 flex items-center justify-center gap-2 bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition"
      onClick={cancelSale}
    >
      <FaTimes /> {t("cancel")} {t(transactionType.toLowerCase())}
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
          {t("stock")}:&nbsp;
          {formatStock(
            items.find(i => i.id === editing.originalItemId)?.availableStock ?? 0,
            editing.convQty,
            editing.minunit,
            editing.maxunit
          )}
        </span>
      </div>

{/* BATCH SELECTOR */}
{(isSale || isSupplierReturn) && (
<div className="mb-3">
  <label className="text-xs font-medium">Select Purchase Batch</label>

  <select
    className="w-full p-2 border rounded"
    value={selectedBatchId?.toString() ?? ""}
    onChange={(e) => {
      const id = Number(e.target.value);
      setSelectedBatchId(id);

      const batch = batches.find((b) => b.id === id);
      if (!batch || !editing) return;

      setEditing({
        ...editing,
        costPrice: batch.costPrice,
        batchId: batch.id,
      });
    }}
  >
    {batches.map((b) => (
      <option key={b.id} value={b.id?.toString()}>
        {new Date(b.purchaseDate).toLocaleDateString()} | Qty: {b.balance} | Rs {b.costPrice}
      </option>
    ))}
  </select>
</div>
)}
      <div className="mb-2">
        <label className="text-xs font-medium">{t("unit")}</label>
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

      <label className="text-sm">{t("quantity")}</label>
      <input
        type="number"
        className="w-full p-2 border rounded mb-2"
        value={editing.qty}
        onChange={e => setEditing({ ...editing, qty: Number(e.target.value) })}
      />

      {/* Price Category / Buy Price */}
      {treatAsPurchase ? (
        <>
          <label className="text-sm font-medium block mb-1">{t("buyprice")}</label>
          <input
            type="number"
            className="w-full p-2 border rounded mb-2"
            value={Number(
            priceForDisplay(
              editing.minUnitPrice,
              editing.unit,
              editing.convQty
            ).toFixed(2)
                        )}
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
          <label className="text-sm font-medium block mb-1">{t("price")}</label>
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
            value={Number(priceForDisplay(editing.minUnitPrice, editing.unit, editing.convQty).toFixed(2))}
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

      <label className="text-sm">{t("discount")}</label>
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

      <label className="text-sm">{t("tax")}</label>
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
        <button onClick={() => setEditing(null)}>{t("cancel")}</button>
        <button onClick={() => updateItem(editing)} className="bg-indigo-600 text-white px-4 py-2 rounded">
          {t("save")}
        </button>
      </div>
    </div>
  </div>
)}

{showHeld && (
  <div className="fixed inset-0 bg-black/40 flex justify-center items-center z-50">
    <div className="bg-white w-[600px] max-h-[80vh] overflow-auto rounded shadow-lg p-4">

     <h2 className="flex justify-between items-center text-lg font-semibold mb-3">
  Held Transactions
  <button
    onClick={() => setShowHeld(false)}
    className="px-3 py-1 border rounded"
    title="Close"
  >
    X
  </button>
</h2>

      {heldList.length === 0 && (
        <p className="text-sm text-gray-500">
          No held transactions
        </p>
        
      )}

      {heldList.map(h => (
        <div
          key={h.id}
          className="border p-3 rounded mb-2 flex justify-between items-center"
        >
          <div>
            <div className="font-medium">
              {h.customerName}
            </div>

            <div className="text-xs text-gray-500">
              {new Date(h.date).toLocaleString()}
            </div>

            <div className="text-sm">
              Rs {h.grandTotal}
            </div>
          </div>

          <button
            onClick={() => resumeHeld(h.id!)}
            className="bg-green-600 text-white px-3 py-1 rounded"
          >
            Resume
          </button>
        </div>
      ))}

      
    </div>
  </div>
)}

      {showCustomerModal && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white p-5 rounded w-96 shadow">
      <h3 className="font-semibold mb-3">{t("createcustomer")}</h3>

      <label className="text-sm">{t("customername")}</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newCustomer.name}
        onChange={(e) =>
          setNewCustomer({ ...newCustomer, name: e.target.value })
        }
      />

      <label className="text-sm">{t("mobile")}</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newCustomer.mobile}
        onChange={(e) =>
          setNewCustomer({ ...newCustomer, mobile: e.target.value })
        }
      />

        <label className="text-sm">{t("cnic")}</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newCustomer.cnic}
        onChange={(e) =>
          setNewCustomer({ ...newCustomer, cnic: e.target.value })
        }
      />

        <label className="text-sm">{t("address")}</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newCustomer.address}
        onChange={(e) =>
          setNewCustomer({ ...newCustomer, address: e.target.value })
        }
      />

      <label className="text-sm">{t("previousdues")}</label>
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
          {t("cancel")}
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
                        isDeleted: false,
                        deletedAt: null
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
  {t("save")}
        </button>

      </div>
    </div>
  </div>
      )}

{showSupplierModal && (
  <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
    <div className="bg-white p-5 rounded w-96 shadow">
      <h3 className="font-semibold mb-3">{t("createsupplier")}</h3>

      <label className="text-sm">{t("suppliername")}</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newSupplier.name}
        onChange={(e) =>
          setNewSupplier({ ...newSupplier, name: e.target.value })
        }
      />

      <label className="text-sm">{t("mobile")}</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newSupplier.mobile}
        onChange={(e) =>
          setNewSupplier({ ...newSupplier, mobile: e.target.value })
        }
      />

      <label className="text-sm">{t("cnic")}</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newSupplier.cnic}
        onChange={(e) =>
          setNewSupplier({ ...newSupplier, cnic: e.target.value })
        }
      />

      <label className="text-sm">{t("address")}</label>
      <input
        type="text"
        className="w-full p-2 border rounded mb-2"
        value={newSupplier.address}
        onChange={(e) =>
          setNewSupplier({ ...newSupplier, address: e.target.value })
        }
      />

      <label className="text-sm">{t("previousdues")}</label>
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
          {t("cancel")}
        </button>

        <button
          className="bg-indigo-600 text-white px-4 py-2 rounded"
          onClick={async () => {
            if (!newSupplier.name.trim()) {
              return alert("Supplier name is required");
            }

            // 1️⃣ Duplicate check
            const allSuppliers = await supplierRepo.getAll();
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
            const id = await supplierRepo.create({
              name: newSupplier.name,
              mobile: newSupplier.mobile,
              cnic: newSupplier.cnic,
              address: newSupplier.address,
              payable: newSupplier.dues,
              isDeleted: false,
              deletedAt: null
            });

            // 3️⃣ Reload suppliers
            const dbSuppliers = await supplierRepo.getAll();
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
          {t("save")}
        </button>
      </div>
    </div>
  </div>
)}

{showInvoiceDiscountModal && (
  <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
    <div className="bg-white p-4 rounded w-80">
      <h3 className="font-semibold mb-3">{t("invoice")} {t("discount")}</h3>

      {/* Discount Name */}
      <select
      className="w-full border p-2 rounded mb-2"
      value={modalDiscount?.id ?? ""}
      onChange={(e) => {
        const selectedId = e.target.value;

        // ✅ If nothing selected → allow manual discount
        if (selectedId === "") {
          setModalDiscount(null);
          return; // IMPORTANT: do NOT reset values
        }

        const d = discounts.find(
          d => d.id === Number(selectedId)
        );

        if (!d) return;

        // ✅ Populate fields only
        setModalDiscount(d);
        setModalDiscountMode(
          d.type === "percentage"
            ? "percentage"
            : "Fixed Amount"
        );
        setModalDiscountValue(d.value);
      }}
    >
      <option value="">Manual Discount</option>

      {discounts.map(d => (
        <option key={d.id} value={d.id}>
          {d.name}
        </option>
      ))}
    </select>

      {/* Discount Type */}
      <select
        className="w-full border p-2 mb-2 rounded"
        value={modalDiscountMode}
        onChange={(e) =>
          setModalDiscountMode(
            e.target.value as "percentage" | "Fixed Amount"
          )
        }
      >
        <option value="percentage">{t("percentage")}</option>
        <option value="Fixed Amount">{t("fixedamount")}</option>
      </select>

      {/* Discount Value */}
      <input
        type="number"
        className="w-full border p-2 mb-3 rounded"
        value={modalDiscountValue}
        onChange={(e) =>
          setModalDiscountValue(Number(e.target.value))
        }
      />

      <div className="flex justify-end gap-2">
        {/* CANCEL */}
        <button
          className="px-3 py-1 border rounded"
          onClick={() => setShowInvoiceDiscountModal(false)}
        >
          {t("cancel")}
        </button>

        {/* SAVE */}
        <button
        className="px-3 py-1 bg-blue-600 text-white rounded"
        onClick={() => {

          // ✅ Apply modal values to main UI ALWAYS
          setSelectedDiscount(modalDiscount); // can be null (manual)

          setDiscountMode(modalDiscountMode);

          setDiscountValue(
            Number(modalDiscountValue) || 0
          );

          setShowInvoiceDiscountModal(false);
        }}
      >
        {t("save")}
      </button>
      </div>
    </div>
  </div>
)}

{showInvoiceTaxModal && (
  <div className="fixed inset-0 bg-black/30 flex items-center justify-center">
    <div className="bg-white p-4 rounded w-80">
      <h3 className="font-semibold mb-3">{t("invoice")} {t("tax")}</h3>

      {/* Tax Name */}
      <select
        className="w-full border p-2 rounded mb-2"
        value={modalTax?.id ?? ""}
        onChange={(e) => {
          const selectedId = e.target.value;

          // ✅ Manual Tax (no preset)
          if (selectedId === "") {
            setModalTax(null);
            return; // keep entered values
          }

          const t = taxes.find(
            t => t.id === Number(selectedId)
          );

          if (!t) return;

          // populate modal fields only
          setModalTax(t);
          setModalTaxMode(
            t.type === "percentage"
              ? "percentage"
              : "Fixed Amount"
          );
          setModalTaxValue(t.value);
        }}
      >
        <option value="">Manual Tax</option>

        {taxes.map(t => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      {/* Tax Type */}
      <select
        className="w-full border p-2 mb-2 rounded"
        value={modalTaxMode}
        onChange={(e) =>
          setModalTaxMode(
            e.target.value as "percentage" | "Fixed Amount"
          )
        }
      >
        <option value="percentage">{t("percentage")}</option>
        <option value="Fixed Amount">{t("fixedamount")}</option>
      </select>

      {/* Tax Value */}
      <input
        type="number"
        className="w-full border p-2 mb-3 rounded"
        value={modalTaxValue}
        onChange={(e) =>
          setModalTaxValue(Number(e.target.value))
        }
      />

      <div className="flex justify-end gap-2">
        {/* CANCEL */}
        <button
          className="px-3 py-1 border rounded"
          onClick={() => setShowInvoiceTaxModal(false)}
        >
          {t("cancel")}
        </button>

        {/* SAVE */}
        <button
          className="px-3 py-1 bg-blue-600 text-white rounded"
          onClick={() => {

            // ✅ Apply modal values ALWAYS (preset OR manual)
            setSelectedTax(modalTax); // may be null

            setTaxMode(modalTaxMode);

            setTaxValue(
              Number(modalTaxValue) || 0
            );

            setShowInvoiceTaxModal(false);
          }}
        >
          {t("save")}
        </button>
      </div>
    </div>
  </div>
)}

    </div>    
  );
}
