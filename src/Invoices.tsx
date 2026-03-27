//src/Invoices.tsx
import { useEffect, useState } from "react";
import { salesRepository } from "./repositories/salesRepository";
import type { DBSale, DBSaleItem } from "./db";
import { FaAngleDoubleLeft, FaAngleLeft, FaAngleRight, FaAngleDoubleRight, FaTrash,FaPrint } from "react-icons/fa";
import { customersRepository } from "./repositories/customerRepository";
import { customerPaymentRepository } from "./repositories/customerPaymentRepository";
import { indexedDbSupplierRepository as suppliersRepository } from "./repositories/indexedDbSupplierRepository";
import { supplierPaymentRepository } from "./repositories/supplierPaymentRepository";
import { printInvoice } from "./services/printing/printService";
import { useLang } from "./i18n/LanguageContext";

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
  
  // Load total count on mount or filter change
  useEffect(() => {
    // Reset return sub-filter when switching type
    if (transactionTypeFilter !== "Return") {
      setReturnSubFilter("All");
    }
    async function loadCount() {
      if (transactionTypeFilter === "All") {
        const count = await salesRepository.getSalesCount();
        setTotalRecords(count);
      } else {
        const { total } = await salesRepository.getSalesPaged(1, PAGE_SIZE, transactionTypeFilter as any);
        setTotalRecords(total);
      }
      setCurrentPage(1);
    }
    loadCount();
  }, [transactionTypeFilter]);

  // Load current page
  useEffect(() => {
    let cancelled = false;

    async function loadPage() {
      setLoading(true);
      let data: DBSale[] = [];
      if (transactionTypeFilter === "All") {
        data = await salesRepository.getSalesPage(currentPage, PAGE_SIZE);
      } else {
        const res = await salesRepository.getSalesPaged(currentPage, PAGE_SIZE, transactionTypeFilter as any);
        data = res.data;
      }
      if (!cancelled) {
        // Sort ascending by invoiceNo (assuming numeric)
        data.sort((a, b) => Number(a.invoiceNo ?? 0) - Number(b.invoiceNo ?? 0));
        setSales(data);
        setLoading(false);
      }
    }

    loadPage();
    return () => { cancelled = true; };
  }, [currentPage, transactionTypeFilter]);

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

  // 🔽 AFTER all useEffect / useMemo blocks
const filteredInvoices = sales.filter(inv => {

  // Transaction type filter
  if (transactionTypeFilter !== "All") {
    if (inv.transactionType !== transactionTypeFilter) return false;
  }

  // Return sub-filter (RET-C / RET-S)
  if (transactionTypeFilter === "Return") {

    if (returnSubFilter === "Cus" && !inv.invoiceNo?.startsWith("RET-C")) {
      return false;
    }

    if (returnSubFilter === "Sup" && !inv.invoiceNo?.startsWith("RET-S")) {
      return false;
    }

    // "All" = show both
  }

  // Search filter
  if (search.trim()) {
    const q = search.toLowerCase();

    return (
      inv.invoiceNo?.toLowerCase().includes(q) ||
      inv.customerName?.toLowerCase().includes(q) ||
      inv.supplierName?.toLowerCase().includes(q)
    );
  }

  return true;
});

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

  // 🔹 Determine return type by prefix
  const isSupplierReturn = invoice.invoiceNo?.startsWith("RET-S");

  if (isSupplierReturn) {
    // Supplier Return originally reduced stock → restore it
    await salesRepository.deleteSaleAndRestoreStock(invoice.id);
  } else {
    // Customer Return originally increased stock → reduce it
    await salesRepository.deletePurchaseAndReduceStock(invoice.id);
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

    const textAlign = lang === "ur" ? "text-right" : "text-left";

  return (
    <div className="p-4 flex flex-col lg:flex-row gap-4">
      
      {/* LEFT PANEL */}
      <div className="w-full lg:w-4/5 bg-white shadow rounded-lg p-4 flex flex-col gap-4">
        <h1 className="text-xl font-semibold">{t("viewinvoices")}</h1>

        <div className="flex items-center justify-between gap-4">

  {/* LEFT: Transaction Type */}
  <div className="flex gap-3 mt-2">
    {TRANSACTION_TYPES.map(type => (
      <label
        key={type}
        className={`flex items-center gap-2 px-3 py-1 rounded cursor-pointer transition
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
      className={`border rounded px-2 py-1 text-sm transition-all duration-200
        ${transactionTypeFilter === "Return" ? "w-40" : "w-64"}
      `}
      value={search}
      onChange={(e) => setSearch(e.target.value)}
    />

  {/* RIGHT: Return radios + Search */}
  <div className="flex items-center gap-2">

    {transactionTypeFilter === "Return" && (
      <div className="flex gap-2 text-xs">

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
          <table className="w-full border-collapse border mt-2 text-sm">
            <thead>
             <tr className="bg-gray-100">
              <th className={`border p-2 ${textAlign}`}>{t("invoice")} #</th>
              <th className={`border p-2 ${textAlign}`}>{t("custsuppname")}</th>
              <th className={`border p-2 ${textAlign}`}>{t("date")}</th>
              <th className={`border p-2 ${textAlign}`}>{t("payable")}</th>
              <th className="border p-2 text-center">{t("actions")}</th>
            </tr>
            </thead>
            <tbody>
              {filteredInvoices.map(filteredInvoices => (
                <tr
                  key={filteredInvoices.id}
                  className={`cursor-pointer hover:bg-gray-100 ${selectedInvoice?.id === filteredInvoices.id ? "bg-blue-50" : ""}`}
                  onClick={() => setSelectedInvoice(filteredInvoices)}
                >
                  <td className="border p-2">{filteredInvoices.invoiceNo}</td>
                  <td className="border p-2">{getPartyName(filteredInvoices)}</td>
                  <td className="border p-2">
                    {new Date(filteredInvoices.date).toLocaleDateString()}
                  </td>
                  <td className="border p-2 text-right">{filteredInvoices.grandTotal.toFixed()}</td>
                  <td className="border p-2 text-center space-x-1">

                      {/* PRINT */}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handlePrintInvoice(filteredInvoices);
                        }}
                        className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600"
                      >
                        🖨
                      </button>

                      {/* DELETE */}
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          handleDeleteInvoice(filteredInvoices);
                        }}
                        className="px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                      >
                        <FaTrash />
                      </button>

                    </td>
                  
                </tr>
              ))}
              {sales.length === 0 && (
                <tr>
                  <td colSpan={4} className="p-4 text-center">{t("noinvoicesfound")}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
           
        {/* Pagination */}
        <div className="flex justify-center items-center gap-2 mt-2">
          <button onClick={() => goToPage(1)} disabled={currentPage === 1} className="p-1 border rounded hover:bg-gray-100"><FaAngleDoubleLeft /></button>
          <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="p-1 border rounded hover:bg-gray-100"><FaAngleLeft /></button>
          <span className="px-2">{t("page")} {currentPage} {t("of")} {totalPages}</span>
          <button onClick={() => goToPage(currentPage + 1)} disabled={currentPage === totalPages} className="p-1 border rounded hover:bg-gray-100"><FaAngleRight /></button>
          <button onClick={() => goToPage(totalPages)} disabled={currentPage === totalPages} className="p-1 border rounded hover:bg-gray-100"><FaAngleDoubleRight /></button>
        </div>
      </div>

      {/* RIGHT PANEL */}
      <div className="w-full lg:w-2/2 bg-white shadow rounded-lg p-4 flex flex-col gap-4">
        {selectedInvoice ? (
          <>
            {/* Header: invoice info */}
            <div className="flex justify-between items-start mb-4 text-sm">
              <div >
                <h2 className="text-lg font-semibold">{t("invoice")} #: {selectedInvoice.invoiceNo}</h2>
                <p><strong>{t("date")}:</strong> {new Date(selectedInvoice.date).toLocaleDateString()}</p>
                <p><strong>{t("custsuppname")}:</strong> {getPartyName(selectedInvoice)}</p>
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
    </div>
  );
}
