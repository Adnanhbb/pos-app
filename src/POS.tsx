// src/POS.tsx
import React, { useEffect, useMemo, useState } from "react";
import { FaBarcode, FaEdit, FaTrash, FaTimes, FaCheck, FaPlus } from "react-icons/fa";

// 🔹 DB INTEGRATION
import { Item as DBItem, getAllItems, getAllCustomers,addCustomer,getAllCategories,getBrands } from "./db";
import type { Brand, Category } from "./db";

// =====================
// Types
// =====================

type CartItem = {
  id: number;
  name: string;
  qty: number;
  price: number;
  discountType: "%" | "flat";
  discountValue: number;
  taxType: "%" | "flat";
  taxValue: number;
  originalItemId: number;
};

type Customer = {
  id: number;
  name: string;
  phone?: string;
  arrears: number;
};

// =====================
// Helpers
// =====================

function calcLine(item: CartItem) {
  const base = item.qty * item.price;
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

// =====================
// Component
// =====================

export default function SalesPOS() {
  const [items, setItems] = useState<DBItem[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [editing, setEditing] = useState<CartItem | null>(null);
  const [search, setSearch] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [invoiceNo, setInvoiceNo] = useState("SAL-0001");
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
  const [selectedCustomerName, setSelectedCustomerName] = useState("Walk-in Customer");
  const [customerInput, setCustomerInput] = useState("Walk-in Customer");
  const [isCustomerOpen, setIsCustomerOpen] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState(customers);
  const [Categories, setCategories] = useState<Category[]>([]);
  const [Brands, setBrands] = useState<Brand[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedBrand, setSelectedBrand] = useState<string>("");


  // =====================
  // INIT LOADS
  // =====================

  useEffect(() => {
    const lastInvoice = localStorage.getItem("lastInvoiceNo");
    if (lastInvoice) setInvoiceNo(lastInvoice);
  }, []);

  useEffect(() => {
    (async () => {
      const dbItems = await getAllItems();
      setItems(dbItems);
    })();
  }, []);

  useEffect(() => {
    (async () => {
      const dbCustomers = await getAllCustomers();
      const mapped = dbCustomers.map(c => ({
        id: c.id!,
        name: c.name,
        phone: c.mobile,
        arrears: c.balance ?? 0,
      }));

      setCustomers(mapped);

      setSelectedCustomerId(null);
      setCustomerInput("Walk-in Customer");
    })();
  }, []);

  useEffect(() => {
    const customer = customers.find(c => c.id === selectedCustomerId);
    setCustomerArrears(customer?.arrears ?? 0);
  }, [selectedCustomerId, customers]);

  useEffect(() => {
  const q = customerInput.toLowerCase();
  setFilteredCustomers(
    customers.filter(c => c.name.toLowerCase().includes(q))
  );
}, [customerInput, customers]);

useEffect(() => {
  const loadCategories = async () => {
    const data = await getAllCategories(); // returns Category[]
    setCategories(data);
  };

  loadCategories();
}, []);

useEffect(() => {
  const loadBrands = async () => {
    const data = await getBrands(); // returns Brand[]
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


  // =====================
  // CART LOGIC
  // =====================

  function cancelSale() {
    setItems(prev =>
      prev.map(item => {
        const cartItem = cart.find(ci => ci.originalItemId === item.id);
        if (!cartItem) return item;
        return { ...item, availableStock: item.availableStock + cartItem.qty };
      })
    );
    setCart([]);
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

  function addToCart(item: DBItem) {
    if (item.availableStock <= 0) return;

    setCart(c => {
      const existing = c.find(ci => ci.originalItemId === item.id);
      if (existing) {
        if (existing.qty < item.availableStock) {
          return c.map(ci =>
            ci.originalItemId === item.id ? { ...ci, qty: ci.qty + 1 } : ci
          );
        }
        return c;
      }

      return [
        ...c,
        {
          id: Date.now(),
          name: item.name,
          qty: 1,
          price: item.retailPrice,
          discountType: "%",
          discountValue: 0,
          taxType: "%",
          taxValue: 0,
          originalItemId: item.id!,
        },
      ];
    });

    setItems(prev =>
      prev.map(i =>
        i.id === item.id ? { ...i, availableStock: i.availableStock - 1 } : i
      )
    );
  }

  function updateItem(updated: CartItem) {
    const originalItem = items.find(i => i.id === updated.originalItemId);
    if (!originalItem) return;

    const prevQty = cart.find(ci => ci.id === updated.id)?.qty || 0;
    const diff = updated.qty - prevQty;

    if (diff > originalItem.availableStock) {
      updated.qty = prevQty + originalItem.availableStock;
    }

    setItems(prev =>
      prev.map(i =>
        i.id === updated.originalItemId
          ? { ...i, availableStock: i.availableStock - diff }
          : i
      )
    );

    setCart(c => c.map(ci => (ci.id === updated.id ? updated : ci)));
    setEditing(null);
  }

  function removeItem(id: number) {
    const removed = cart.find(ci => ci.id === id);
    if (removed) {
      setItems(prev =>
        prev.map(i =>
          i.id === removed.originalItemId
            ? { ...i, availableStock: i.availableStock + removed.qty }
            : i
        )
      );
    }
    setCart(c => c.filter(ci => ci.id !== id));
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
    let subtotal = 0, discount = 0, tax = 0, total = 0;
    cart.forEach(i => {
      const r = calcLine(i);
      subtotal += r.base;
      discount += r.discount;
      tax += r.tax;
      total += r.total;
    });

    return {
      subtotal,
      discount,
      tax,
      arrears: customerArrears,
      grandTotal: total + customerArrears,
    };
  }, [cart, customerArrears]);

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



  return (
    <div className="h-full flex bg-gray-100">

      {/* LEFT – ITEMS */}
      <div className="w-2/3 p-4 border-r bg-white flex flex-col">
  {/* Top controls */}
  <div className="flex gap-2 mb-3">
    {/* Transaction Type Selector */}
<div className="flex items-center gap-4 mb-3">
        {["Sale", "Purchase", "Return", "Quotation"].map((type) => (
            <label
            key={type}
            className={`flex items-center gap-2 px-3 py-1 rounded cursor-pointer transition
                ${transactionType === type ? "bg-indigo-600 text-white" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}
            `}
            >
            <input
                type="radio"
                name="transactionType"
                value={type}
                className="hidden"
                checked={transactionType === type}
                onChange={() => setTransactionType(type as any)}
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
  <div className="grid grid-cols-4 gap-2 auto-rows-min overflow-y-auto max-h-[calc(100vh-170px)]" style={{ maxHeight: `calc(6 * 85px)` }}>
  {filteredItems.length === 0 ? (
    <div className="col-span-4 text-center text-gray-500 text-sm py-10">
      No items found. Adjust your search, category, or brand filters.
    </div>
  ) : (
    filteredItems.map(item => (
      <div
        key={item.id}
        onClick={() => addToCart(item)}
        className={`p-2 border-2 shadow rounded cursor-pointer text-sm select-none ${
          item.availableStock <= 0
            ? "bg-gray-200 cursor-not-allowed"
            : "hover:bg-gray-100"
        }`}
      >
        <div className="font-medium">{item.name}</div>
        <div className="text-xs text-gray-500">
          Rs {item.retailPrice} | Stock: {item.availableStock > 0 ? item.availableStock : "0"}
        </div>
        {item.availableStock <= 0 && (
          <div className="text-red-500 text-xs font-semibold mt-1">Out of Stock</div>
        )}
      </div>
    ))
  )}
</div>

</div>


      {/* RIGHT – CART */}
        <div className="w-3/5 p-4 flex flex-col">
  {/* HEADER */}
  <div className="bg-white p-3 rounded shadow mb-4">
  {/* Row 1: Invoice + Total Items */}
  <div className="flex justify-between items-center mb-2">
    <div className="text-lg font-semibold">
      Invoice: {invoiceNo}
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
      <div className="relative w-56">
  <input
    type="text"
    value={customerInput}
    className="w-full border rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
    onFocus={() => {
      setIsCustomerOpen(true);
      if (customerInput === "Walk-in Customer") {
        setCustomerInput("");
      }
    }}
    onChange={(e) => {
      setCustomerInput(e.target.value);
      setSelectedCustomerId(null);
      setIsCustomerOpen(true);
    }}
    onBlur={() => {
      setTimeout(() => {
        setIsCustomerOpen(false);
        if (!customerInput.trim()) {
          setCustomerInput("Walk-in Customer");
          setSelectedCustomerId(null);
        }
      }, 150); // allows click selection
    }}
  />

  {isCustomerOpen && filteredCustomers.length > 0 && (
    <div className="absolute z-20 mt-1 w-full bg-white border rounded shadow max-h-48 overflow-y-auto">
      {filteredCustomers.map(c => (
        <div
          key={c.id}
          className="px-2 py-1 text-sm cursor-pointer hover:bg-indigo-100"
          onMouseDown={() => {
            setSelectedCustomerId(c.id!);
            setCustomerInput(c.name);
            setIsCustomerOpen(false);
          }}
        >
          {c.name}
        </div>
      ))}
    </div>
  )}
</div>

      <button
        onClick={() => setShowCustomerModal(true)}
        className="p-2 bg-indigo-600 text-white rounded hover:bg-indigo-700"
        title="Add New Customer"
      >
        <FaPlus size={12} />
      </button>
    </div>
  </div>
</div>


  {/* CART ITEMS */}
  <div className="flex-1 overflow-y-auto space-y-1 max-h-[320px]">
    {cart.map((item) => {
      const r = calcLine(item);
      return (
        <div key={item.id} className="bg-white pl-2 pr-2 pt-1 pb-1 rounded shadow">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-medium">{item.name}</div>
              <div className="text-sm text-gray-500 leading-tight">
                {item.qty} × {item.price} | Disc: {item.discountValue}{item.discountType} | Tax: {item.taxValue}{item.taxType}
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => setEditing(item)} className="p-2 bg-blue-500 text-white rounded">
                <FaEdit />
              </button>
              <button onClick={() => removeItem(item.id)} className="p-2 bg-red-500 text-white rounded">
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
    <div className="flex justify-between text-sm">
      <span>Subtotal</span>
      <span>{totals.subtotal.toFixed(2)}</span>
    </div>

    <div className="flex justify-between text-sm">
      <span>Discount</span>
      <span>-{totals.discount.toFixed(2)}</span>
    </div>

    <div className="flex justify-between text-sm">
      <span>Tax</span>
      <span>{totals.tax.toFixed(2)}</span>
    </div>

    {totals.arrears > 0 && (
      <div className="flex justify-between text-sm text-red-600 font-medium">
        <span>Previous Dues</span>
        <span>
          {selectedCustomer && selectedCustomer.arrears > 0 && (
            <div className="text-xs text-red-600 font-medium">
              {selectedCustomer.arrears.toFixed(2)}
            </div>
          )}
        </span>
      </div>
    )}

    <div className="flex justify-between font-semibold mt-2 border-t pt-2">
      <span>Payable Amount</span>
      <span>{totals.grandTotal.toFixed(2)}</span>
    </div>

    {/* Buttons */}
    <div className="flex gap-2 mt-4">
      <button
        className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition"
        onClick={() => {
          if (cart.length === 0) return;
          const nextInvoice = getNextInvoiceNo(invoiceNo);
          setInvoiceNo(nextInvoice);
          localStorage.setItem("lastInvoiceNo", nextInvoice);
          setCart([]);
          setSelectedDate(new Date().toISOString().split("T")[0]);
        }}
      >
        <FaCheck /> Complete Sale
      </button>

      <button
        className="flex-1 flex items-center justify-center gap-2 bg-red-500 text-white px-4 py-2 rounded hover:bg-red-600 transition"
        onClick={cancelSale}
      >
        <FaTimes /> Cancel Sale
      </button>
    </div>
  </div>
</div>


      {/* EDIT MODAL */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center">
          <div className="bg-white p-5 rounded w-96">
            <h3 className="font-semibold mb-3">{editing.name}</h3>

            <label className="text-sm">Quantity</label>
            <input
              type="number"
              className="w-full p-2 border rounded mb-2"
              value={editing.qty}
              onChange={e => setEditing({ ...editing, qty: Number(e.target.value) })}
            />

            <label className="text-sm">Price</label>
            <input
              type="number"
              className="w-full p-2 border rounded mb-2"
              value={editing.price}
              onChange={e => setEditing({ ...editing, price: Number(e.target.value) })}
            />

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
    const allCustomers = await getAllCustomers();
    const nameExists = allCustomers.some(
      (c) => c.name.trim().toLowerCase() === newCustomer.name.trim().toLowerCase()
    );
    if (nameExists) {
      return alert(`A customer with the name "${newCustomer.name}" already exists.`);
    }

    // 2️⃣ Save to IndexedDB
    const id = await addCustomer({
      name: newCustomer.name,
      mobile: newCustomer.mobile,
      cnic: newCustomer.cnic,
      address: newCustomer.address,
      balance: newCustomer.dues,
    });

    // 3️⃣ Reload customers from DB (single source of truth)
    const dbCustomers = await getAllCustomers();
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

    </div>
  );
}
