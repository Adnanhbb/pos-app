import React, { useEffect, useState } from "react";
import { Supplier } from "./db";
import {
  FaArrowUp,
  FaArrowDown,
  FaFileInvoiceDollar,
  FaUsers
} from "react-icons/fa";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { FaFilePdf, FaFileExcel, FaSearch } from "react-icons/fa";

import { suppliersRepository } from "./repositories/suppliersRepository";

const PAGE_SIZE = 10;

export default function SupReport() {

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [filtered, setFiltered] = useState<Supplier[]>([]);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const [summary, setSummary] = useState({
    highestDues: "-",
    lowestDues: "-",
    highestInvoices: "-",
    lowestInvoices: "-",
    noInvoices: 0
  });

  /* -------------------------------------------------- */
  /* SEARCH */
  /* -------------------------------------------------- */

  const applySearch = (data: Supplier[]) => {

    let result = [...data];

    if (search.trim()) {
      const term = search.toLowerCase();
      result = result.filter(s =>
        s.name.toLowerCase().includes(term)
      );
    }

    setFiltered(result);
  };

  /* -------------------------------------------------- */
  /* LOAD SUPPLIERS */
  /* -------------------------------------------------- */

  useEffect(() => {
    loadSuppliers();
  }, []);

  const loadSuppliers = async () => {
    const data = await suppliersRepository.getAll();
    processSuppliers(data);
  };

  useEffect(() => {
    applySearch(suppliers);
    setPage(1);
  }, [search]);

  /* -------------------------------------------------- */
  /* PROCESS + SORT */
  /* -------------------------------------------------- */

  const processSuppliers = (data: Supplier[]) => {

    const safe = data.map(s => ({
      ...s,
      invoices: s.invoices || 0,
      balance: s.balance || 0
    }));

    safe.sort((a, b) => (b.balance! - a.balance!));

    setSuppliers(safe);
    applySearch(safe);
    setPage(1);

    calculateSummary(safe);
  };

  /* -------------------------------------------------- */
  /* SUMMARY */
  /* -------------------------------------------------- */

  const calculateSummary = (data: Supplier[]) => {

    if (!data.length) return;

    const byDuesDesc = [...data].sort(
      (a, b) => (b.balance || 0) - (a.balance || 0)
    );

    const byInvoicesDesc = [...data].sort(
      (a, b) => (b.invoices || 0) - (a.invoices || 0)
    );

    const noInvoices = data.filter(
      s => (s.invoices || 0) === 0
    ).length;

    setSummary({
      highestDues: byDuesDesc[0]?.name || "-",
      lowestDues: byDuesDesc[byDuesDesc.length - 1]?.name || "-",
      highestInvoices: byInvoicesDesc[0]?.name || "-",
      lowestInvoices:
        byInvoicesDesc[byInvoicesDesc.length - 1]?.name || "-",
      noInvoices
    });
  };

  /* -------------------------------------------------- */
  /* PAGINATION */
  /* -------------------------------------------------- */

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);

  const paginated = filtered.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
  );

  /* -------------------------------------------------- */
  /* EXPORT PDF */
  /* -------------------------------------------------- */

  const exportPDF = () => {

    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("Supplier Report", 14, 15);

    doc.setFontSize(11);

    let y = 25;
    const gap = 7;

    doc.text(`Highest Dues: ${summary.highestDues}`, 14, y); y += gap;
    doc.text(`Lowest Dues: ${summary.lowestDues}`, 14, y); y += gap;
    doc.text(`Highest Invoices: ${summary.highestInvoices}`, 14, y); y += gap;
    doc.text(`Lowest Invoices: ${summary.lowestInvoices}`, 14, y); y += gap;
    doc.text(`No Invoices: ${summary.noInvoices}`, 14, y);

    y += 10;

    autoTable(doc, {
      startY: y,
      head: [["Supplier", "Invoices", "Dues"]],
      body: filtered.map(s => [
        s.name,
        s.invoices || 0,
        (s.balance || 0).toLocaleString()
      ])
    });

    doc.save("supplier_report.pdf");
  };

  /* -------------------------------------------------- */
  /* EXPORT EXCEL */
  /* -------------------------------------------------- */

  const exportExcel = () => {

    const wsData = [

      ["Supplier Report"],
      [],

      ["Highest Dues", summary.highestDues],
      ["Lowest Dues", summary.lowestDues],
      ["Highest Invoices", summary.highestInvoices],
      ["Lowest Invoices", summary.lowestInvoices],
      ["No Invoices", summary.noInvoices],
      [],

      ["Supplier", "Invoices", "Dues"],

      ...filtered.map(s => [
        s.name,
        s.invoices || 0,
        s.balance || 0
      ])
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws["!cols"] = [
      { wch: 30 },
      { wch: 12 },
      { wch: 15 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Supplier Report");

    XLSX.writeFile(wb, "supplier_report.xlsx");
  };

  /* -------------------------------------------------- */
  /* STYLES */
  /* -------------------------------------------------- */

  const cardStyle = {
    padding: "15px",
    borderRadius: "12px",
    background: "#fff",
    boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
    display: "flex",
    alignItems: "center",
    gap: "12px"
  };

  /* -------------------------------------------------- */
  /* UI */
  /* -------------------------------------------------- */

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
          placeholder="Search supplier..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full border rounded pl-9 pr-3 py-2"
        />
      </div>

      {/* EXPORT BUTTONS */}
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
            <th className="px-4 py-2 border">Supplier</th>

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
                No suppliers found.
              </td>
            </tr>
          ) : (
            paginated.map(s => (
              <tr
                key={s.id}
                className="border-b hover:bg-gray-50"
              >
                {/* SUPPLIER */}
                <td className="px-2 py-1 sm:px-4 sm:py-2 font-medium">
                  {s.name}
                </td>

                {/* INVOICES */}
                <td className="px-2 py-1 sm:px-4 sm:py-2 hidden sm:table-cell">
                  {(s.invoices || 0).toLocaleString()}
                </td>

                {/* DUES */}
                <td className="px-2 py-1 sm:px-4 sm:py-2 hidden md:table-cell">
                  {(s.balance || 0).toLocaleString()}
                </td>

                {/* MOBILE STACKED INFO */}
                <td className="px-2 py-1 sm:hidden flex flex-col text-xs text-gray-600 gap-1 mt-1">
                  <span>Invoices: {(s.invoices || 0).toLocaleString()}</span>
                  <span>Dues: {(s.balance || 0).toLocaleString()}</span>
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