import React, { useEffect, useState } from "react";
import { DBSale } from "./db";
import { FaShoppingCart, FaTruck, FaUndo, FaFileInvoice } from "react-icons/fa";
import { FaFilePdf, FaFileExcel } from "react-icons/fa";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { Tooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";
import { salesRepository } from "./repositories/salesRepository";
import { useLang } from "./i18n/LanguageContext";

type FilterType = "All" | "Sale" | "Purchase" | "Return" | "Quotation";

const PAGE_SIZE = 10;

export default function SalesReport() {

  const [sales, setSales] = useState<DBSale[]>([]);
  const [filtered, setFiltered] = useState<DBSale[]>([]);
  const [filterType, setFilterType] = useState<FilterType>("All");

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [page, setPage] = useState(1);

  const [totals, setTotals] = useState({
    sales: 0,
    purchases: 0,
    customerReturns: 0,
    supplierReturns: 0,
    profit: 0
  });

  const { t, lang, setLang } = useLang();
  
const exportPDF = () => {

  const doc = new jsPDF();

  /* ---------- HEADER ---------- */

  doc.setFontSize(16);
  doc.text("Sales Report", 14, 15);

  doc.setFontSize(10);
  doc.text(
    `Date Range: ${fromDate || "Start"} - ${toDate || "Today"}`,
    14,
    22
  );

  /* ---------- SUMMARY (CARDS DATA) ---------- */

  doc.setFontSize(11);

  doc.text(`Total Sales: Rs. ${totals.sales.toLocaleString()}`, 14, 32);
  doc.text(`Total Purchases: Rs. ${totals.purchases.toLocaleString()}`, 14, 38);
  doc.text(`Customer Returns: Rs. ${totals.customerReturns.toLocaleString()}`, 14, 44);
  
  doc.text(`Supplier Returns: Rs. ${totals.supplierReturns.toLocaleString()}`, 120, 32);
  doc.text(`Total Profit: Rs. ${totals.profit.toLocaleString()}`, 120, 38);
  doc.text(`Invoices Count: ${filtered.length}`, 120, 44);

  /* ---------- TABLE DATA ---------- */

  const tableColumn = [
    "Invoice",
    "Date",
    "Customer/Supplier",
    "Grand Total",
    "Paid",
    "Balance",
    "Profit"
  ];

  const tableRows: any[] = [];

  filtered.forEach(s => {
    tableRows.push([
      s.invoiceNo,
      s.date,
      s.customerName || s.supplierName,
      s.grandTotal.toLocaleString(),
      s.paid.toLocaleString(),
      s.arrears.toLocaleString(),
      (s.profit || 0).toLocaleString()
    ]);
  });

  autoTable(doc, {
    startY: 58,
    head: [tableColumn],
    body: tableRows,
    styles: {
      fontSize: 9
    },
    headStyles: {
      fillColor: [37, 99, 235]
    }
  });

  doc.save("sales_report.pdf");
};

const exportExcel = () => {

  /* ---------- HEADER SECTION ---------- */

  const headerRows = [
    ["Sales Report"],
    [`Date Range: ${fromDate || "Start"} - ${toDate || "Today"}`],
    [],
    ["Total Sales", totals.sales],
    ["Total Purchases", totals.purchases],
    ["Customer Returns", totals.customerReturns],
    ["Supplier Returns", totals.supplierReturns],
    ["Total Profit", totals.profit],
    [],
  ];

  /* ---------- TABLE DATA ---------- */

  const tableData = filtered.map(s => ({
    Invoice: s.invoiceNo,
    Date: s.date,
    "Customer/Supplier": s.customerName || s.supplierName,
    "Grand Total": s.grandTotal,
    Paid: s.paid,
    Arrears: s.arrears,
    Profit: s.profit || 0
  }));

  const worksheet = XLSX.utils.json_to_sheet([]);

  // Header
  XLSX.utils.sheet_add_aoa(worksheet, headerRows, {
    origin: "A1"
  });

  // Table
  XLSX.utils.sheet_add_json(
    worksheet,
    tableData,
    { origin: "A11" }
  );

  /* ---------- COLUMN WIDTH ---------- */

  worksheet["!cols"] = [
    { wch: 18 },
    { wch: 12 },
    { wch: 30 },
    { wch: 15 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Sales Report");

  XLSX.writeFile(workbook, "sales_report.xlsx");
};

  const [returnSubFilter, setReturnSubFilter] =
    useState<"All" | "Cus" | "Sup">("All");

  useEffect(() => {
    loadSales();
  }, []);

  useEffect(() => {
    applyFilters();
  }, [sales, filterType, fromDate, toDate, returnSubFilter]);

  const loadSales = async () => {
    const data = await salesRepository.getSalesPage(1, 1000);
    setSales(data);
  };

  const applyFilters = () => {

    let result = [...sales];

    if (filterType !== "All") {
      result = result.filter(s => s.transactionType === filterType);
    }

    if (filterType === "Return") {

      if (returnSubFilter === "Cus") {
        result = result.filter(s => s.invoiceNo?.startsWith("RET-C"));
      }

      if (returnSubFilter === "Sup") {
        result = result.filter(s => s.invoiceNo?.startsWith("RET-S"));
      }
    }

    if (fromDate) {
      result = result.filter(s => new Date(s.date) >= new Date(fromDate));
    }

    if (toDate) {
      result = result.filter(s => new Date(s.date) <= new Date(toDate));
    }

    setFiltered(result);
    setPage(1);

    calculateTotals(result);
  };

const calculateTotals = (data: DBSale[]) => {

  const totals = {
    sales: 0,
    purchases: 0,
    customerReturns: 0,
    supplierReturns: 0,
    profit: 0
  };

  data.forEach(s => {

    // true transaction value (exclude dues adjustments)
    const netAmount =
      (s.subtotal || 0) -
      (s.discount || 0) +
      (s.tax || 0);

    /* ---------- SALES ---------- */
    if (s.transactionType === "Sale") {

      totals.sales += netAmount;

      // add profit from sale
      totals.profit += (s.profit || 0);
    }

    /* ---------- PURCHASE ---------- */
    if (s.transactionType === "Purchase") {
      totals.purchases += netAmount;
    }

    /* ---------- RETURNS ---------- */
    if (s.transactionType === "Return") {

      // CUSTOMER RETURN → reverse revenue & profit
      if (s.invoiceNo?.startsWith("RET-C")) {
        totals.customerReturns += netAmount;
        totals.profit += (s.profit || 0); // subtract profit
      }

      // SUPPLIER RETURN
      if (s.invoiceNo?.startsWith("RET-S")) {
        totals.supplierReturns += netAmount;
      }
    }

  });

  setTotals(totals);
};

  const paginated = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const radioStyle = (type: FilterType) => ({
    padding: "7px 16px",
    borderRadius: "25px",
    border: filterType === type ? "1px solid #2563eb" : "1px solid #ddd",
    background: filterType === type ? "#2563eb" : "#fff",
    color: filterType === type ? "#fff" : "#444",
    cursor: "pointer",
    fontWeight: 500,
    boxShadow: filterType === type
      ? "0 2px 6px rgba(0,0,0,0.15)"
      : "none",
    transition: "all 0.2s"
  });

  const cardStyle = {
    flex: 1,
    padding: "15px",
    borderRadius: "12px",
    background: "#fff",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    display: "flex",
    alignItems: "center",
    gap: "12px"
  };

  const formatDate = (dateString: string) => {
  if (!dateString) return "";

  const d = new Date(dateString);

  return d.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
};

    const textAlign = lang === "ur" ? "text-right" : "text-left";

return (
  <div className="p-4 sm:p-6">

    {/* SUMMARY CARDS */}
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-5">
      <div style={cardStyle}>
        <FaShoppingCart size={26} color="#ef4444" />
        <div>
          <div>{t("sales")}</div>
          <strong>Rs. {totals.sales.toFixed().toLocaleString()}</strong>
        </div>
      </div>

      <div style={cardStyle}>
        <FaTruck size={26} color="#eab308" />
        <div>
          <div>{t("purchases")}</div>
          <strong>Rs. {totals.purchases.toFixed().toLocaleString()}</strong>
        </div>
      </div>

      <div style={cardStyle}>
        <FaUndo size={26} color="#10b981" />
        <div>
          <div>{t("cus")}. {t("return")}</div>
          <strong>Rs. {totals.customerReturns.toFixed().toLocaleString()}</strong>
        </div>
      </div>

      <div style={cardStyle}>
        <FaUndo size={26} color="#3b82f6" />
        <div>
          <div>{t("sup")}. {t("return")}</div>
          <strong>Rs. {totals.supplierReturns.toFixed().toLocaleString()}</strong>
        </div>
      </div>

      <div style={cardStyle}>
        <FaFileInvoice size={26} color="#f59e0b" />
        <div>
          <div>{t("profit")}</div>
          <strong>Rs. {totals.profit.toFixed().toLocaleString()}</strong>
        </div>
      </div>
    </div>

    {/* FILTERS */}
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3 flex-wrap">

      <div className="flex flex-wrap items-center gap-3">

        <div className="flex flex-wrap gap-2">
          {["All","Sale","Purchase","Return","Quotation"].map(type => (
            <button
              key={type}
              style={radioStyle(type as FilterType)}
              onClick={() => setFilterType(type as FilterType)}
            >
              {t(type.toLowerCase())}
            </button>
          ))}
        </div>

        {filterType === "Return" && (
          <div className="flex gap-2 text-xs">
            {["All","Cus","Sup"].map(sub => (
              <button
                key={sub}
                style={{
                  padding: "5px 12px",
                  borderRadius: "20px",
                  border: returnSubFilter === sub ? "1px solid #2563eb" : "1px solid #ddd",
                  background: returnSubFilter === sub ? "#2563eb" : "#fff",
                  color: returnSubFilter === sub ? "#fff" : "#444",
                  cursor: "pointer",
                  fontWeight: 500
                }}
                onClick={() => setReturnSubFilter(sub as "All" | "Cus" | "Sup")}
              >
                {t(sub.toLowerCase())}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-2 items-center sm:ml-4">
          <input
            type="date"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
            className="border rounded px-2 py-1"
          />
          <input
            type="date"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
            className="border rounded px-2 py-1"
          />
        </div>
      </div>

      <div className="flex gap-3">
        <div className="cursor-pointer" onClick={exportPDF}>
          <FaFilePdf size={22} color="#ef4444" />
        </div>
        <div className="cursor-pointer" onClick={exportExcel}>
          <FaFileExcel size={22} color="#22c55e" />
        </div>
      </div>

    </div>

    {/* TABLE */}
    <div className="overflow-x-auto">
      <table className="w-full text-left border">
        <thead className="bg-gray-100">
          <tr>
            <th className={`px-4 py-2 border ${textAlign}`}>{t("invoice")}</th>
            <th className={`px-4 py-2 border ${textAlign}`}>{t("date")}</th>
            <th className={`px-4 py-2 border ${textAlign}`}>{t("customersupplier")}</th>

            {/* hide progressively */}
            <th className={`px-4 py-2 border hidden sm:table-cell ${textAlign}`}>
              {t("grandtotal")}
            </th>
            <th className={`px-4 py-2 border hidden md:table-cell ${textAlign}`}>
              {t("paid")}
            </th>
            <th className={`px-4 py-2 border hidden lg:table-cell ${textAlign}`}>
              {t("balance")}
            </th>
            <th className={`px-4 py-2 border hidden lg:table-cell ${textAlign}`}>
              {t("profit")}
            </th>
          </tr>
        </thead>

        <tbody>
          {paginated.length === 0 ? (
            <tr>
              <td colSpan={7} className="px-4 py-2 text-center text-gray-500">
                {t("norecordsfound")}
              </td>
            </tr>
          ) : (
            paginated.map(s => (
              <tr key={s.id} className="hover:bg-gray-50 border-b">

                <td className={`px-2 py-1 sm:px-4 sm:py-2 font-medium ${textAlign}`}>
                  {s.invoiceNo}
                </td>

                <td className={`px-2 py-1 sm:px-4 sm:py-2 ${textAlign}`}>
                  {formatDate(s.date)}
                </td>

                <td className={`px-2 py-1 sm:px-4 sm:py-2 ${textAlign}`}>
                  {s.customerName || s.supplierName}
                </td>

                <td className={`px-2 py-1 sm:px-4 sm:py-2 hidden sm:table-cell ${textAlign}`}>
                  {s.grandTotal.toLocaleString()}
                </td>

                <td className={`px-2 py-1 sm:px-4 sm:py-2 hidden md:table-cell ${textAlign}`}>
                  {s.paid.toLocaleString()}
                </td>

                <td className={`px-2 py-1 sm:px-4 sm:py-2 hidden lg:table-cell ${textAlign}`}>
                  {s.arrears.toLocaleString()}
                </td>

                <td className={`px-2 py-1 sm:px-4 sm:py-2 hidden lg:table-cell ${textAlign}`}>
                  {(s.profit || 0).toLocaleString()}
                </td>

                {/* MOBILE STACKED DETAILS */}
                <td className="px-2 py-1 sm:hidden flex flex-col text-xs text-gray-600 gap-1 mt-1">
                  <span>{t("total")}: {s.grandTotal.toLocaleString()}</span>
                  <span>{t("paid")}: {s.paid.toLocaleString()}</span>
                  <span>{t("balance")}: {s.arrears.toLocaleString()}</span>
                  <span>{t("profit")}: {(s.profit || 0).toLocaleString()}</span>
                </td>

              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>

    {/* PAGINATION */}
    <div className="flex justify-center gap-3 mt-4 flex-wrap">
      <button
        disabled={page === 1}
        onClick={() => setPage(page - 1)}
        className="px-3 py-1 border rounded"
      >
        {t("prev")}
      </button>

      <span>{t("page")} {page} / {totalPages || 1}</span>

      <button
        disabled={page === totalPages || totalPages === 0}
        onClick={() => setPage(page + 1)}
        className="px-3 py-1 border rounded"
      >
        {t("next")}
      </button>
    </div>

  </div>
);
}