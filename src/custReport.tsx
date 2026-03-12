import React, { useEffect, useState } from "react";
import { Customer } from "./db";
import {
  FaUser,
  FaArrowUp,
  FaArrowDown,
  FaFileInvoiceDollar,
  FaUsers
} from "react-icons/fa";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { FaFilePdf, FaFileExcel, FaSearch } from "react-icons/fa";

import { customersRepository } from "./repositories/customerRepository";

const PAGE_SIZE = 10;

export default function CustReport() {

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filtered, setFiltered] = useState<Customer[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [summary, setSummary] = useState({
    highestDues: "-",
    lowestDues: "-",
    highestInvoices: "-",
    lowestInvoices: "-",
    noInvoices: 0
  });

  const applySearch = (data: Customer[]) => {

  let result = [...data];

  if (search.trim()) {
    const term = search.toLowerCase();
    result = result.filter(c =>
      c.name.toLowerCase().includes(term)
    );
  }

  setFiltered(result);
};

  /* --------------------------------------------------
     LOAD CUSTOMERS
  -------------------------------------------------- */

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    const data = await customersRepository.getAll();
    processCustomers(data);
  };

  useEffect(() => {
  applySearch(customers);
  setPage(1);
}, [search]);

  /* --------------------------------------------------
     PROCESS + SORT
  -------------------------------------------------- */

  const processCustomers = (data: Customer[]) => {

    const safe = data.map(c => ({
      ...c,
      invoices: c.invoices || 0,
      balance: c.balance || 0
    }));

    // sort descending by dues
    safe.sort((a, b) => (b.balance! - a.balance!));

    setCustomers(safe);
    applySearch(safe);
    setPage(1);

    calculateSummary(safe);
  };

  /* --------------------------------------------------
     SUMMARY CARDS
  -------------------------------------------------- */

  const calculateSummary = (data: Customer[]) => {

    if (!data.length) return;

    const byDuesDesc = [...data].sort(
      (a, b) => (b.balance || 0) - (a.balance || 0)
    );

    const byInvoicesDesc = [...data].sort(
      (a, b) => (b.invoices || 0) - (a.invoices || 0)
    );

    const noInvoices = data.filter(c => (c.invoices || 0) === 0).length;

    setSummary({
      highestDues: byDuesDesc[0]?.name || "-",
      lowestDues: byDuesDesc[byDuesDesc.length - 1]?.name || "-",
      highestInvoices: byInvoicesDesc[0]?.name || "-",
      lowestInvoices:
        byInvoicesDesc[byInvoicesDesc.length - 1]?.name || "-",
      noInvoices
    });
  };

  /* --------------------------------------------------
     PAGINATION
  -------------------------------------------------- */

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const paginated = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

const exportPDF = () => {

  const doc = new jsPDF();

  /* ---------- TITLE ---------- */

  doc.setFontSize(16);
  doc.text("Customer Report", 14, 15);

  /* ---------- SUMMARY TEXT ---------- */

  doc.setFontSize(11);

  let y = 25;

  const lineGap = 7;

  doc.text(`Highest Dues: ${summary.highestDues}`, 14, y);
  y += lineGap;

  doc.text(`Lowest Dues: ${summary.lowestDues}`, 14, y);
  y += lineGap;

  doc.text(`Highest Invoices: ${summary.highestInvoices}`, 14, y);
  y += lineGap;

  doc.text(`Lowest Invoices: ${summary.lowestInvoices}`, 14, y);
  y += lineGap;

  doc.text(`No Invoices: ${summary.noInvoices}`, 14, y);

  y += 10;

  /* ---------- TABLE ---------- */

  autoTable(doc, {
    startY: y,
    head: [["Customer", "Invoices", "Dues"]],
    body: filtered.map(c => [
      c.name,
      c.invoices || 0,
      (c.balance || 0).toLocaleString()
    ])
  });

  doc.save("customer_report.pdf");
};

const exportExcel = () => {

  const wsData = [

    /* ---------- TITLE ---------- */
    ["Customer Report"],
    [],

    /* ---------- SUMMARY ---------- */
    ["Highest Dues", summary.highestDues],
    ["Lowest Dues", summary.lowestDues],
    ["Highest Invoices", summary.highestInvoices],
    ["Lowest Invoices", summary.lowestInvoices],
    ["No Invoices", summary.noInvoices],
    [],

    /* ---------- TABLE HEADER ---------- */
    ["Customer", "Invoices", "Dues"],

    /* ---------- TABLE DATA ---------- */
    ...filtered.map(c => [
      c.name,
      c.invoices || 0,
      c.balance || 0
    ])
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  /* Optional column width (professional look) */
  ws["!cols"] = [
    { wch: 30 },
    { wch: 12 },
    { wch: 15 }
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Customer Report");

  XLSX.writeFile(wb, "customer_report.xlsx");
};

  /* --------------------------------------------------
     STYLES
  -------------------------------------------------- */

  const cardStyle = {
    padding: "15px",
    borderRadius: "12px",
    background: "#fff",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    display: "flex",
    alignItems: "center",
    gap: "12px"
  };

  /* --------------------------------------------------
     UI
  -------------------------------------------------- */

 return (
  <div className="p-4 sm:p-6">

    {/* ================= SUMMARY CARDS ================= */}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-5">

      <div style={cardStyle}>
        <FaArrowUp size={24} color="#ef4444" />
        <div>
          <div>Highest Dues</div>
          <strong>{summary.highestDues}</strong>
        </div>
      </div>

      <div style={cardStyle}>
        <FaArrowDown size={24} color="#10b981" />
        <div>
          <div>Lowest Dues</div>
          <strong>{summary.lowestDues}</strong>
        </div>
      </div>

      <div style={cardStyle}>
        <FaFileInvoiceDollar size={24} color="#2563eb" />
        <div>
          <div>Highest Invoices</div>
          <strong>{summary.highestInvoices}</strong>
        </div>
      </div>

      <div style={cardStyle}>
        <FaFileInvoiceDollar size={24} color="#f59e0b" />
        <div>
          <div>Lowest Invoices</div>
          <strong>{summary.lowestInvoices}</strong>
        </div>
      </div>

      <div style={cardStyle}>
        <FaUsers size={24} color="#6366f1" />
        <div>
          <div>No Invoices</div>
          <strong>{summary.noInvoices}</strong>
        </div>
      </div>

    </div>

    {/* ================= SEARCH + EXPORT ================= */}
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4">

      {/* SEARCH */}
      <div className="relative w-full sm:w-64">
        <FaSearch className="absolute left-3 top-2.5 text-gray-400" />

        <input
          type="text"
          placeholder="Search customer..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border rounded pl-9 pr-3 py-2"
        />
      </div>

      {/* EXPORT */}
      <div className="flex items-center gap-3 sm:ml-auto">
        <FaFilePdf
          size={22}
          color="#dc2626"
          title="Export PDF"
          className="cursor-pointer"
          onClick={exportPDF}
        />

        <FaFileExcel
          size={22}
          color="#16a34a"
          title="Export Excel"
          className="cursor-pointer"
          onClick={exportExcel}
        />
      </div>

    </div>

    {/* ================= TABLE ================= */}
    <div className="overflow-x-auto">
      <table className="w-full text-left border">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-2 border">Customer</th>
            <th className="px-4 py-2 border hidden sm:table-cell">
              # Invoices
            </th>
            <th className="px-4 py-2 border hidden md:table-cell">
              Dues (Rs.)
            </th>
          </tr>
        </thead>

        <tbody>
          {paginated.length === 0 ? (
            <tr>
              <td colSpan={3} className="px-4 py-2 text-center text-gray-500">
                No customers found.
              </td>
            </tr>
          ) : (
            paginated.map(c => (
              <tr
                key={c.id}
                className="border-b hover:bg-gray-50"
              >
                {/* CUSTOMER */}
                <td className="px-2 py-1 sm:px-4 sm:py-2 font-medium">
                  {c.name}
                </td>

                {/* INVOICES */}
                <td className="px-2 py-1 sm:px-4 sm:py-2 hidden sm:table-cell">
                  {(c.invoices || 0).toLocaleString()}
                </td>

                {/* DUES */}
                <td className="px-2 py-1 sm:px-4 sm:py-2 hidden md:table-cell">
                  {(c.balance || 0).toLocaleString()}
                </td>

                {/* MOBILE STACKED DETAILS */}
                <td className="px-2 py-1 sm:hidden flex flex-col text-xs text-gray-600 gap-1 mt-1">
                  <span>Invoices: {(c.invoices || 0).toLocaleString()}</span>
                  <span>Dues: {(c.balance || 0).toLocaleString()}</span>
                </td>

              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>

    {/* ================= PAGINATION ================= */}
    <div className="mt-5 flex justify-center items-center gap-3 flex-wrap">

      <button
        disabled={page === 1}
        onClick={() => setPage(page - 1)}
        className="px-3 py-1 border rounded"
      >
        Prev
      </button>

      <span>
        Page {page} / {totalPages || 1}
      </span>

      <button
        disabled={page === totalPages || totalPages === 0}
        onClick={() => setPage(page + 1)}
        className="px-3 py-1 border rounded"
      >
        Next
      </button>

    </div>

  </div>
);
}