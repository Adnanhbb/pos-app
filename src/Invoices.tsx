//src/Invoices.tsx
import { useEffect, useState } from "react";
import { salesRepository } from "./repositories/salesRepository";
import type { DBSale, DBSaleItem } from "./types/entities";
import { FaAngleDoubleLeft, FaAngleLeft, FaAngleRight, FaAngleDoubleRight, FaTrash,FaPrint, FaEye } from "react-icons/fa";
import { customersRepository } from "./repositories/customerRepository";
import { customerPaymentRepository } from "./repositories/customerPaymentRepository";
import { indexedDbSupplierRepository as suppliersRepository } from "./repositories/indexedDbSupplierRepository";
import { supplierPaymentRepository } from "./repositories/supplierPaymentRepository";
import { printInvoice } from "./services/printing/printService";
import { useLang } from "./i18n/LanguageContext";
import { batchRepository } from "./repositories/batchRepository";

const PAGE_SIZE = 10;
const TRANSACTION_TYPES = ["All", "Sale", "Purchase", "Return", "Quotation"] as const;

export const resolvePartyName = (inv: DBSale) => {

  if (inv.transactionType === "Purchase") {
    return inv.supplierName || "Direct Purchase";
  }

  if (inv.transactionType === "Return") {
    if (inv.invoiceNo?.startsWith("RET-S")) {
      return inv.supplierName || "Direct Purchase";
    }
    return inv.customerName || "Walk-in Customer";
  }

  return inv.customerName || "Walk-in Customer";
};

export default function Invoices() {
  const [sales, setSales] = useState<DBSale[]>([]);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [totalRecords, setTotalRecords] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(false);

  const [selectedInvoice, setSelectedInvoice] = useState<DBSale | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<DBSaleItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState<boolean>(false);

  const [transactionTypeFilter, setTransactionTypeFilter] = useState<typeof TRANSACTION_TYPES[number]>("All");

  const totalPages = Math.ceil(totalRecords / PAGE_SIZE);

  const [search, setSearch] = useState("");

  const [returnSubFilter, setReturnSubFilter] = useState<"All" | "Cus" | "Sup">("All");

  // Helper to get the correct party name (customer or supplier)
  const getPartyName = resolvePartyName;

  const { t, lang, setLang } = useLang();
  
  const [showPostponedOnly, setShowPostponedOnly] = useState(false);

  // Load total count on mount or filter change
 useEffect(() => {
  async function loadCount() {
    const total = await salesRepository.getSalesCountFiltered({
      transactionType: transactionTypeFilter,
      search,
      showPostponedOnly,
    });

    setTotalRecords(total);
    setCurrentPage(1);
  }

  loadCount();
}, [
  transactionTypeFilter,
  search,
  showPostponedOnly,
  returnSubFilter
]);

  // Load current page
 useEffect(() => {
  let cancelled = false;

  async function loadPage() {
    setLoading(true);

    const res = await salesRepository.getSalesPagedFiltered(
      currentPage,
      PAGE_SIZE,
      {
        transactionType: transactionTypeFilter,
        search,
        showPostponedOnly,
        returnSubFilter,
      }
    );

    if (!cancelled) {
      setSales(res.data);
      setTotalRecords(res.total);
      setLoading(false);
    }
  }

  loadPage();
  return () => {
    cancelled = true;
  };
}, [
  currentPage,
  transactionTypeFilter,
  search,
  showPostponedOnly,
  returnSubFilter
]);

  // Load selected invoice items
  useEffect(() => {
    if (!selectedInvoice || selectedInvoice.id === undefined) {
      setInvoiceItems([]);
      return;
    }

    const id: number = selectedInvoice.id;
    let cancelled = false;

    async function loadItems() {
      setItemsLoading(true);
      try {
        const items = await salesRepository.getSaleItems(id);
        if (!cancelled) setInvoiceItems(items || []);
      } catch {
        if (!cancelled) setInvoiceItems([]);
      } finally {
        if (!cancelled) setItemsLoading(false);
      }
    }

    loadItems();
    return () => { cancelled = true; };
  }, [selectedInvoice]);

  const goToPage = (page: number) => {
    if (page < 1 || page > totalPages) return;
    setCurrentPage(page);
  };

const handleDeleteInvoice = async (invoice: DBSale) => {
  if (!invoice.id) return;

  const confirmDelete = window.confirm(
  `${t("areyousuredeleteinvoice")} ${invoice.invoiceNo}`
);
  if (!confirmDelete) return;

  try {
   /* --------------------------------------------------
   1️⃣ STOCK REVERSAL + DELETE
-------------------------------------------------- */
if (invoice.transactionType === "Sale") {
  // Sale originally reduced stock → restore it
  await salesRepository.deleteSaleAndRestoreStock(invoice.id);
}
else if (invoice.transactionType === "Purchase") {
  // Purchase originally increased stock → reduce it
  await salesRepository.deletePurchaseAndReduceStock(invoice.id);
}
else if (invoice.transactionType === "Return") {

  const isSupplierReturn = invoice.invoiceNo?.startsWith("RET-S");

  if (isSupplierReturn) {
    await salesRepository.deleteSupplierReturnAndRestoreStock(invoice.id);
  } else {
    await salesRepository.deleteCustomerReturnAndReduceStock(invoice.id);
  }
}
else if (invoice.transactionType === "Quotation") {
  await salesRepository.deleteQuotation(invoice.id);
}

    /* --------------------------------------------------
       2️⃣ CUSTOMER ACCOUNT REVERSAL
    -------------------------------------------------- */
    if (
      (invoice.transactionType === "Sale" ||
       invoice.transactionType === "Return") &&
      invoice.customerId
    ) {
      const customer = await customersRepository.getById(invoice.customerId);
      if (customer) {

        const invoiceBase =
          (invoice.subtotal ?? 0) -
          (invoice.discount ?? 0) +
          (invoice.tax ?? 0);

        let newPayable = customer.payable ?? 0;
        let newPaid = customer.paid ?? 0;

        if (invoice.transactionType === "Sale") {
          newPayable -= invoiceBase;
          newPaid -= invoice.paid ?? 0;
        }

        if (invoice.transactionType === "Return") {
          newPayable += invoiceBase;
          newPaid -= invoice.paid ?? 0; // invoice.paid is NEGATIVE
        }

        const newBalance = newPayable - newPaid;
        const newInvoices = Math.max(0, (customer.invoices ?? 1) - 1);

        await customersRepository.update({
          ...customer,
          payable: newPayable,
          paid: newPaid,
          balance: newBalance,
          invoices: newInvoices,
        });

        // Remove payment entry (both Sale & Return)
        if (invoice.paid && invoice.paid !== 0) {
          await customerPaymentRepository.deleteByInvoiceNo(invoice.invoiceNo);
        }
      }
    }

   /* --------------------------------------------------
   3️⃣ SUPPLIER ACCOUNT REVERSAL (PURCHASE & RETURN)
-------------------------------------------------- */
if (
  (invoice.transactionType === "Purchase" ||
   invoice.transactionType === "Return") &&
  invoice.supplierId
) {
  const supplier = await suppliersRepository.getById(invoice.supplierId);
  if (supplier) {

    const invoiceBase =
      (invoice.subtotal ?? 0) -
      (invoice.discount ?? 0) +
      (invoice.tax ?? 0);

    let newPayable = supplier.payable ?? 0;
    let newPaid = supplier.paid ?? 0;

    // 🔹 Reverse Purchase
    if (invoice.transactionType === "Purchase") {
      newPayable -= invoiceBase;
      newPaid -= invoice.paid ?? 0;
    }

    // 🔹 Reverse Supplier Return
    if (invoice.transactionType === "Return") {
      newPayable += invoiceBase;
      newPaid -= invoice.paid ?? 0; 
      // invoice.paid is NEGATIVE in return
    }

    const newBalance = newPayable - newPaid;
    const newInvoices = Math.max(0, (supplier.invoices ?? 1) - 1);

    await suppliersRepository.update({
      ...supplier,
      payable: newPayable,
      paid: newPaid,
      balance: newBalance,
      invoices: newInvoices,
    });

    // 🔁 Remove supplier payment entry (Purchase & Return)
    if (invoice.paid && invoice.paid !== 0) {
      await supplierPaymentRepository.deleteByInvoiceNo(
        String(invoice.invoiceNo)
      );
    }
  }
}

/* --------------------------------------------------
   🧠 BATCH REVERSAL (CRITICAL)
-------------------------------------------------- */
const items = await salesRepository.getSaleItems(invoice.id);

for (const ci of items) {

  /* ---------- SALE DELETE ---------- */
  if (invoice.transactionType === "Sale") {

    if (ci.id) {
      const batch = await batchRepository.getBatchById(ci.id);
      if (!batch) continue;

      batch.qtySold -= ci.qty;
      batch.balance += ci.qty;

      // safety
      batch.qtySold = Math.max(0, batch.qtySold);

      await batchRepository.updateBatch(batch);
    }
  }

  /* ---------- PURCHASE DELETE ---------- */
  if (invoice.transactionType === "Purchase") {

    // delete batch created by purchase
    await batchRepository.deleteByInvoiceNo(invoice.invoiceNo);
  }

  /* ---------- RETURN ---------- */
  if (invoice.transactionType === "Return") {

    const isSupplierReturn = invoice.invoiceNo?.startsWith("RET-S");

    /* 🔹 SUPPLIER RETURN DELETE */
    if (isSupplierReturn) {

      if (ci.id) {
        const batch = await batchRepository.getBatchById(ci.id);
        if (!batch) continue;

        // reverse supplier return
        batch.qtyPurchased += ci.qty;
        batch.balance += ci.qty;

        await batchRepository.updateBatch(batch);
      }
    }

    /* 🔹 CUSTOMER RETURN DELETE */
    else {

      // delete return batch
      await batchRepository.deleteByInvoiceNo(invoice.invoiceNo);
    }
  }
}

    /* --------------------------------------------------
       4️⃣ UI CLEANUP
    -------------------------------------------------- */
    setSales(prev => prev.filter(s => s.id !== invoice.id));
    setSelectedInvoice(prev =>
      prev?.id === invoice.id ? null : prev
    );

    alert(`Invoice #${invoice.invoiceNo} deleted successfully.`);
  } catch (err) {
    console.error("Delete invoice failed:", err);
    alert("Failed to delete invoice. Check console for details.");
  }
};

const handlePrintInvoice = async (invoice: DBSale) => {

  const confirmed = window.confirm(t("doyouwanttoprintinvoice"));
  if (!confirmed) return;

  try {

    // ✅ LOAD ITEMS FROM DATABASE
    const dbItems = await salesRepository.getSaleItems(invoice.id!);

    // ✅ Normalize name
    const name = resolvePartyName(invoice);

    // ✅ Normalize items for printer
    const items = (dbItems ?? []).map(i => ({
      name: i.name,
      qty: i.qty,
      price: i.price,
      discountType: i.discountType ?? "flat",
      discountValue: i.discountValue ?? 0,
      taxType: i.taxType ?? "flat",
      taxValue: i.taxValue ?? 0
    }));

    await printInvoice({
      ...invoice,
      items,
      name,
      previousDues: invoice.dues ?? 0
    });

  } catch (err) {
    console.error("Print failed:", err);
    alert("Failed to load invoice items for printing.");
  }
};

async function handleRemovePostponed(inv: DBSale) {
  if (!inv.id) return;

  const confirmRemove = window.confirm(
    `Are you sure you want to remove Invoice #${inv.invoiceNo} from postponed list?`
  );

  if (!confirmRemove) return;

  try {
    // 1️⃣ Update DB
    await salesRepository.update({
      ...inv,
      isPostponed: false,
    });

    // 2️⃣ Reload CURRENT PAGE with SAME filters (IMPORTANT FIX)
    const res = await salesRepository.getSalesPagedFiltered(
      currentPage,
      PAGE_SIZE,
      {
        transactionType: transactionTypeFilter,
        search,
        showPostponedOnly,
        returnSubFilter,
      }
    );

    // 3️⃣ Update UI state
    setSales(res.data);
    setTotalRecords(res.total);

    // 4️⃣ Clear selection if needed
    if (selectedInvoice?.id === inv.id) {
      setSelectedInvoice(null);
    }

  } catch (err) {
    console.error("Failed to update postponed status:", err);
    alert("Failed to remove from postponed list");
  }
}

    const textAlign = lang === "ur" ? "text-right" : "text-left";

  return (
    <div className="p-2 sm:p-4 w-full max-w-full flex flex-col lg:flex-row gap-4 overflow-x-hidden">
      
      {/* LEFT PANEL */}
      <div className="w-full lg:basis-[90.57%] bg-white shadow rounded-lg p-3 sm:p-4 flex flex-col gap-4 min-w-0 overflow-x-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-xl font-semibold">
            {t("viewinvoices")}
          </h1>

           <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={showPostponedOnly}
            onChange={(e) => setShowPostponedOnly(e.target.checked)}
          />
          Show Postponed Invoices
        </label>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 min-w-0">

  {/* LEFT: Transaction Type */}
  <div className="flex flex-nowrap gap-2 sm:gap-3 mt-2 lg:mt-0 pb-1 lg:pb-0 lg:flex-1 min-w-0 overflow-x-auto">
    {TRANSACTION_TYPES.map(type => (
      <label
        key={type}
        className={`flex items-center gap-1 sm:gap-2 px-2 sm:px-3 py-1 rounded cursor-pointer transition whitespace-nowrap text-xs sm:text-sm
          ${transactionTypeFilter === type
            ? "bg-indigo-600 text-white"
            : "bg-gray-200 text-gray-700 hover:bg-gray-300"}
        `}
      >
        <input
          type="radio"
          name="transactionType"
          value={type}
          checked={transactionTypeFilter === type}
          onChange={() => {
            setTransactionTypeFilter(type);
            if (type !== "Return") {
              setReturnSubFilter("All");
            }
          }}
          className="hidden"
        />
        {t(type.toLowerCase())}
      </label>
    ))}
  </div>

<input
      type="text"
      placeholder={t("searchinvoice")}
      className={`border rounded px-2 py-1 text-sm transition-all duration-200 w-full sm:w-64 lg:w-56
        ${transactionTypeFilter === "Return" ? "sm:w-40 lg:w-44" : "sm:w-64 lg:w-56"}
      `}
      value={search}
      onChange={(e) => setSearch(e.target.value)}
    />

  {/* RIGHT: Return radios + Search */}
  <div className="flex items-center gap-2 lg:shrink-0 min-w-0">

    {transactionTypeFilter === "Return" && (
      <div className="flex flex-wrap gap-2 text-xs pb-1">

        {["All", "Cus", "Sup"].map(type => (
          <label
            key={type}
            className={`px-1 py-1 rounded cursor-pointer
              ${returnSubFilter === type
                ? "bg-green-600 text-white"
                : "bg-gray-200 text-gray-700 hover:bg-gray-300"}
            `}
          >
            <input
              type="radio"
              name="returnSub"
              value={type}
              checked={returnSubFilter === type}
              onChange={() => setReturnSubFilter(type as any)}
              className="hidden"
            />
            {t(type.toLowerCase())}
          </label>
        ))}

      </div>
    )}

  </div>

</div>


        {loading ? <div>{t("loadinginvoices")}</div> : (
          <>
          <div className="lg:hidden space-y-2 mt-2">
            {sales.map(inv => (
              <div
                key={inv.id}
                role="button"
                tabIndex={0}
                className={`w-full text-left border rounded p-3 shadow-sm cursor-pointer ${
                  selectedInvoice?.id === inv.id ? "bg-blue-50" : "bg-white"
                }`}
                onClick={() => setSelectedInvoice(inv)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSelectedInvoice(inv);
                  }
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-semibold break-words">{inv.invoiceNo}</div>
                    <div className="text-sm text-gray-700 break-words">{getPartyName(inv)}</div>
                    <div className="text-xs text-gray-500">
                      {new Date(inv.date).toLocaleDateString()}
                    </div>
                  </div>
                  <div className="text-sm font-semibold whitespace-nowrap">
                    {inv.grandTotal.toFixed()}
                  </div>
                </div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      handlePrintInvoice(inv);
                    }}
                    title={t("print")}
                    className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    🖨
                  </button>
                  <button
                    onClick={e => {
                      e.stopPropagation();
                      handleDeleteInvoice(inv);
                    }}
                    title={t("delete")}
                    className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                  >
                    <FaTrash />
                  </button>
                </div>
              </div>
            ))}
            {sales.length === 0 && (
              <div className="p-4 text-center text-sm">{t("noinvoicesfound")}</div>
            )}
          </div>

          <div className="hidden lg:block overflow-x-auto">
          <table className="w-full border-collapse border mt-2 text-sm min-w-[700px]">
            <thead>
             <tr className="bg-blue-100">
              <th className={`border p-2 ${textAlign}`}>{t("invoice")} </th>
              <th className={`border p-2 ${textAlign}`}>{t("custsuppname")}</th>
              <th className={`border p-2 ${textAlign}`}>{t("date")}</th>
              <th className={`border p-2 ${textAlign}`}>{t("payable")}</th>
              <th className="border p-2 text-center">{t("actions")}</th>
            </tr>
            </thead>
            <tbody>
              {sales.map(inv => (
                <tr
                  key={inv.id}
                  className={`cursor-pointer hover:bg-gray-100 ${selectedInvoice?.id === inv.id ? "bg-blue-50" : ""}`}
                  onClick={() => setSelectedInvoice(inv)}
                >
                  <td className="border p-2">{inv.invoiceNo}</td>
                  <td className="border p-2">{getPartyName(inv)}</td>
                  <td className="border p-2">
                    {new Date(inv.date).toLocaleDateString()}
                  </td>
                  <td className="border p-2 text-right">{inv.grandTotal.toFixed()}</td>
                  <td className="border p-2 text-center space-x-1">

                      {/* PRINT */}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handlePrintInvoice(inv);
                        }}
                        title={t("print")}
                        className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        🖨
                      </button>

                      {/* DELETE */}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleDeleteInvoice(inv);
                        }}
                        title={t("delete")}
                        className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        <FaTrash />
                      </button>

                    </td>
                  
                </tr>
              ))}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={5} className="p-4 text-center">{t("noinvoicesfound")}</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
          </>
        )}
           
        {/* Pagination */}
        <div className="flex flex-wrap justify-center items-center gap-2 mt-2">
          <button onClick={() => goToPage(1)} disabled={currentPage === 1} className="p-1 border rounded hover:bg-gray-100"><FaAngleDoubleLeft /></button>
          <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="p-1 border rounded hover:bg-gray-100"><FaAngleLeft /></button>
          <span className="px-2">{t("page")} {currentPage} {t("of")} {totalPages}</span>
          <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="p-1 border rounded hover:bg-gray-100"><FaAngleRight /></button>
          <button onClick={() => goToPage(totalPages)} disabled={currentPage === totalPages} className="p-1 border rounded hover:bg-gray-100"><FaAngleDoubleRight /></button>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="hidden lg:flex w-full lg:basis-[56.57%] bg-white shadow rounded-lg p-4 flex-col gap-4 min-w-0 overflow-x-hidden">
        {selectedInvoice ? (
          <>
            {/* Header: invoice info */}
            <div className="flex justify-between items-start mb-4 text-sm">
              <div>
                <h2 className="text-lg font-semibold">
                  {t("invoice")}: {selectedInvoice.invoiceNo}
                </h2>

                <p>
                  <strong>{t("date")}:</strong>{" "}
                  {new Date(selectedInvoice.date).toLocaleDateString()}
                </p>

                <p>
                  <strong>{t("custsuppname")}:</strong>{" "}
                  {getPartyName(selectedInvoice)}
                </p>

                {selectedInvoice.isPostponed && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRemovePostponed(selectedInvoice); // ✅ correct object
                    }}
                    className="flex items-center gap-2 bg-blue-100 text-gray-600 border-2 px-2 py-1 rounded hover:bg-gray-200 transition"
                  >
                    <FaEye /> Remove from Postponed List
                  </button>
                )}
              </div>
              <div>
                {/* <p><strong>Transaction:</strong> {selectedInvoice.transactionType}</p> */}
                {/* <p><strong>Customer Name:</strong> {selectedInvoice.customerId ?? "N/A"}</p> */}
              </div>
            </div>

            {/* Items */}
            <div className="flex-2 overflow-auto text-xs">
              {itemsLoading ? <div>{t("loadingitems")}</div> : invoiceItems.length > 0 ? (
                <table className="w-full border-collapse border">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border p-2">{t("name")}</th>
                      <th className="border p-2">{t("qty")}</th>
                      <th className="border p-2">{t("price")}</th>
                      <th className="border p-2">{t("discount")}</th>
                      <th className="border p-2">{t("tax")}</th>
                      <th className="border p-2">{t("total")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceItems.map(item => (
                      <tr key={item.id}>
                        <td className="border p-2">{item.name}</td>
                        <td className="border p-2 text-right">{item.qty}</td>
                        <td className="border p-2 text-right">{item.price}</td>
                        <td className="border p-2 text-right">{item.discountValue}{item.discountType}</td>
                        <td className="border p-2 text-right">{item.taxValue}{item.taxType}</td>
                        <td className="border p-2 text-right">
                        {(() => {
                            const base = item.qty * item.price;
                            const discount = item.discountType === "%" ? (base * item.discountValue) / 100 : item.discountValue;
                            const taxed = item.taxType === "%" ? ((base - discount) * item.taxValue) / 100 : item.taxValue;
                            return (base - discount + taxed).toFixed();
                        })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div>{t("noitemsfound")}</div>}
            </div>

            {/* Totals */}
           <div className="border-t pt-2 mt-2 grid grid-cols-2 gap-4 text-sm">
                {/* Left column */}
                <div className="flex flex-col gap-1">
                  <p><strong>{t("subtotal")}:</strong> {selectedInvoice.subtotal.toFixed()}</p>
                  <p><strong>{t("discount")}:</strong> {selectedInvoice.discount}</p>
                  <p><strong>{t("tax")}:</strong> {selectedInvoice.tax}</p>
                  <p><strong>{t("prevtdues")}:</strong> {selectedInvoice.dues}</p>
                </div>

                {/* Right column */}
                <div className="flex flex-col gap-1 text-right">
                  <p><strong>{t("grandtotal")}:</strong> {selectedInvoice.grandTotal.toFixed()}</p>
                  <p><strong>{t("paid")}:</strong> {selectedInvoice.paid}</p>
                  <p><strong>{t("balance")}:</strong> {selectedInvoice.arrears.toFixed()}</p>
                  <p><strong>{t("profit")}:</strong> {selectedInvoice.profit.toFixed()}</p>

                </div>
              </div>

          </>
        ) : <div className="text-center text-gray-500">{t("selectinvoice")}</div>}
      </div>

      {/* MOBILE DETAILS POPUP */}
      {selectedInvoice && (
        <div className="lg:hidden fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-2">
          <div className="bg-white w-full max-w-2xl max-h-[90vh] rounded-lg shadow-lg overflow-y-auto">
            <div className="sticky top-0 bg-white border-b px-3 py-2 flex items-center justify-between gap-2 min-w-0">
                <h2 className="text-sm font-semibold break-words min-w-0">
                {t("invoice")}: {selectedInvoice.invoiceNo}
              </h2>
              <button
                onClick={() => setSelectedInvoice(null)}
                className="px-2 py-1 text-xs border rounded"
              >
                {t("close")}
              </button>
            </div>

            <div className="p-3 text-sm space-y-2">
              <p>
                <strong>{t("date")}:</strong>{" "}
                {new Date(selectedInvoice.date).toLocaleDateString()}
              </p>
              <p>
                <strong>{t("custsuppname")}:</strong> {getPartyName(selectedInvoice)}
              </p>

              {selectedInvoice.isPostponed && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemovePostponed(selectedInvoice);
                  }}
                  className="flex items-center gap-2 bg-blue-100 text-gray-600 border px-2 py-1 rounded"
                >
                  <FaEye /> Remove from Postponed List
                </button>
              )}
            </div>

            <div className="px-3 pb-3">
              <div className="text-xs font-semibold mb-2">{t("items")}</div>
              {itemsLoading ? (
                <div className="text-sm">{t("loadingitems")}</div>
              ) : invoiceItems.length > 0 ? (
                <div className="space-y-2">
                  {invoiceItems.map(item => {
                    const base = item.qty * item.price;
                    const discount = item.discountType === "%" ? (base * item.discountValue) / 100 : item.discountValue;
                    const taxed = item.taxType === "%" ? ((base - discount) * item.taxValue) / 100 : item.taxValue;
                    const lineTotal = (base - discount + taxed).toFixed();

                    return (
                      <div key={item.id} className="border rounded p-2 text-xs">
                        <div className="font-medium break-words">{item.name}</div>
                        <div className="text-gray-600">
                          {t("qty")}: {item.qty} | {t("price")}: {item.price}
                        </div>
                        <div className="text-gray-600">
                          {t("discount")}: {item.discountValue}{item.discountType} | {t("tax")}: {item.taxValue}{item.taxType}
                        </div>
                        <div className="text-right font-semibold">{lineTotal}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="text-sm">{t("noitemsfound")}</div>
              )}
            </div>

            <div className="border-t px-3 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
              <div className="space-y-1">
                <p><strong>{t("subtotal")}:</strong> {selectedInvoice.subtotal.toFixed()}</p>
                <p><strong>{t("discount")}:</strong> {selectedInvoice.discount}</p>
                <p><strong>{t("tax")}:</strong> {selectedInvoice.tax}</p>
                <p><strong>{t("prevtdues")}:</strong> {selectedInvoice.dues}</p>
              </div>
              <div className="space-y-1 sm:text-right">
                <p><strong>{t("grandtotal")}:</strong> {selectedInvoice.grandTotal.toFixed()}</p>
                <p><strong>{t("paid")}:</strong> {selectedInvoice.paid}</p>
                <p><strong>{t("balance")}:</strong> {selectedInvoice.arrears.toFixed()}</p>
                <p><strong>{t("profit")}:</strong> {selectedInvoice.profit.toFixed()}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
