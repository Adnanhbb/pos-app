//src/Invoices.tsx
import { useEffect, useState } from "react";
import { salesRepository } from "./repositories/salesRepository";
import type { DBSale, DBSaleItem } from "./db";
import { FaAngleDoubleLeft, FaAngleLeft, FaAngleRight, FaAngleDoubleRight, FaTrash } from "react-icons/fa";
import { customersRepository } from "./repositories/customerRepository";
import { customerPaymentRepository } from "./repositories/customerPaymentRepository";
import { indexedDbSupplierRepository as suppliersRepository } 
  from "./repositories/indexedDbSupplierRepository";

import { supplierPaymentRepository } from "./repositories/supplierPaymentRepository";


const PAGE_SIZE = 10;
const TRANSACTION_TYPES = ["All", "Sale", "Purchase", "Return", "Quotation"] as const;

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

  // Helper to get the correct party name (customer or supplier)
  const getPartyName = (inv: DBSale) =>
  inv.transactionType === "Purchase" ? inv.supplierName ?? "N/A" : inv.customerName ?? "N/A";

  // Load total count on mount or filter change
  useEffect(() => {
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
  // Radio filter
  if (transactionTypeFilter !== "All" && inv.transactionType !== transactionTypeFilter) {
    return false;
  }

  // Search filter
  if (search.trim()) {
    const q = search.toLowerCase();
    return (
      inv.invoiceNo.toLowerCase().includes(q) ||
      inv.customerName.toLowerCase().includes(q)
    );
  }

  return true;
});

const handleDeleteInvoice = async (invoice: DBSale) => {
  if (!invoice.id) return;

  const confirmDelete = window.confirm(
    `Are you sure you want to delete Invoice #${invoice.invoiceNo}?`
  );
  if (!confirmDelete) return;

  try {
    /* --------------------------------------------------
   1️⃣ STOCK REVERSAL + DELETE
-------------------------------------------------- */
      if (invoice.transactionType === "Sale") {
        await salesRepository.deleteSaleAndRestoreStock(invoice.id);
      }
      else if (
        invoice.transactionType === "Purchase" ||
        invoice.transactionType === "Return"
      ) {
        // Purchase & Return both ADD stock originally → reduce on delete
        await salesRepository.deletePurchaseAndReduceStock(invoice.id);
      }
      else if (invoice.transactionType === "Quotation") {
        // 🧾 Quotation has no stock, no accounts → just delete
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
       3️⃣ SUPPLIER ACCOUNT REVERSAL
    -------------------------------------------------- */
    if (invoice.transactionType === "Purchase" && invoice.supplierId) {
      const supplier = await suppliersRepository.getById(invoice.supplierId);
      if (supplier) {

        const invoiceBase =
          (invoice.subtotal ?? 0) -
          (invoice.discount ?? 0) +
          (invoice.tax ?? 0);

        const newPayable = (supplier.payable ?? 0) - invoiceBase;
        const newPaid = (supplier.paid ?? 0) - (invoice.paid ?? 0);
        const newBalance = newPayable - newPaid;
        const newInvoices = Math.max(0, (supplier.invoices ?? 1) - 1);

        await suppliersRepository.update({
          ...supplier,
          payable: newPayable,
          paid: newPaid,
          balance: newBalance,
          invoices: newInvoices,
        });

        if (invoice.paid && invoice.paid > 0) {
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

  return (
    <div className="p-4 flex flex-col lg:flex-row gap-4">
      
      {/* LEFT PANEL */}
      <div className="w-full lg:w-4/5 bg-white shadow rounded-lg p-4 flex flex-col gap-4">
        <h1 className="text-xl font-semibold">View Invoices</h1>

        <div className="flex items-center justify-between gap-4">
          {/* Transaction type filter */}
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
                onChange={() => setTransactionTypeFilter(type)}
                className="mr-1 hidden"
              />
              {type}
            </label>
          ))}
        </div>

        {/* Right: Search input */}
          <input
            type="text"
            placeholder="Search invoice or customer..."
            className="border rounded px-2 py-1 text-sm w-64"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {loading ? <div>Loading invoices...</div> : (
          <table className="w-full border-collapse border mt-2 text-sm">
            <thead>
              <tr className="bg-gray-100">
                <th className="border p-2">Invoice # </th>
                <th className="border p-2">Cust/Supp Name</th>
                <th className="border p-2">Date</th>
                <th className="border p-2">Payable</th>
                <th className="border p-2">Action</th>
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
                  <td className="border p-2 text-right">{filteredInvoices.grandTotal}</td>
                   <td className="border p-2 text-center">
                    <button
                      onClick={e => {
                        e.stopPropagation(); // prevent selecting the invoice
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
                  <td colSpan={4} className="p-4 text-center">No invoices found</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
           
        {/* Pagination */}
        <div className="flex justify-center items-center gap-2 mt-2">
          <button onClick={() => goToPage(1)} disabled={currentPage === 1} className="p-1 border rounded hover:bg-gray-100"><FaAngleDoubleLeft /></button>
          <button onClick={() => goToPage(currentPage - 1)} disabled={currentPage === 1} className="p-1 border rounded hover:bg-gray-100"><FaAngleLeft /></button>
          <span className="px-2">Page {currentPage} of {totalPages}</span>
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
                <h2 className="text-lg font-semibold">Invoice #: {selectedInvoice.invoiceNo}</h2>
                <p><strong>Date:</strong> {selectedInvoice.date}</p>
                <p><strong>Cust/Supp Name:</strong> {getPartyName(selectedInvoice)}</p>
              </div>
              <div>
                {/* <p><strong>Transaction:</strong> {selectedInvoice.transactionType}</p> */}
                {/* <p><strong>Customer Name:</strong> {selectedInvoice.customerId ?? "N/A"}</p> */}
              </div>
            </div>

            {/* Items */}
            <div className="flex-2 overflow-auto text-xs">
              {itemsLoading ? <div>Loading items...</div> : invoiceItems.length > 0 ? (
                <table className="w-full border-collapse border">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border p-2">Name</th>
                      <th className="border p-2">Qty</th>
                      <th className="border p-2">Price</th>
                      <th className="border p-2">Disc</th>
                      <th className="border p-2">Tax</th>
                      <th className="border p-2">Total</th>
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
                            return base - discount + taxed;
                        })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div>No items found</div>}
            </div>

            {/* Totals */}
           <div className="border-t pt-2 mt-2 grid grid-cols-2 gap-4 text-sm">
                {/* Left column */}
                <div className="flex flex-col gap-1">
                  <p><strong>Subtotal:</strong> {selectedInvoice.subtotal}</p>
                  <p><strong>Discount:</strong> {selectedInvoice.discount}</p>
                  <p><strong>Tax:</strong> {selectedInvoice.tax}</p>
                  <p><strong>Prev. Dues:</strong> {selectedInvoice.dues}</p>
                </div>

                {/* Right column */}
                <div className="flex flex-col gap-1 text-right">
                  <p className="text-blue-500"><strong>Grand Total:</strong> {selectedInvoice.grandTotal}</p>
                  <p className="text-green-500"><strong>Paid:</strong> {selectedInvoice.paid}</p>
                  <p className="text-red-500"><strong>Balance:</strong> {selectedInvoice.arrears}</p>
                </div>
              </div>

          </>
        ) : <div className="text-center text-gray-500">Select an invoice to view details</div>}
      </div>
    </div>
  );
}
