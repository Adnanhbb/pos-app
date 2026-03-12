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
    <div style={{ padding: 20 }}>

      {/* SUMMARY CARDS */}

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(5,1fr)",
        gap: 15,
        marginBottom: 20
      }}>

        <div style={cardStyle}>
          <FaArrowUp size={24} color="#ef4444" />
          <div><div>Highest Dues</div><strong>{summary.highestDues}</strong></div>
        </div>

        <div style={cardStyle}>
          <FaArrowDown size={24} color="#10b981" />
          <div><div>Lowest Dues</div><strong>{summary.lowestDues}</strong></div>
        </div>

        <div style={cardStyle}>
          <FaFileInvoiceDollar size={24} color="#2563eb" />
          <div><div>Highest Invoices</div><strong>{summary.highestInvoices}</strong></div>
        </div>

        <div style={cardStyle}>
          <FaFileInvoiceDollar size={24} color="#f59e0b" />
          <div><div>Lowest Invoices</div><strong>{summary.lowestInvoices}</strong></div>
        </div>

        <div style={cardStyle}>
          <FaUsers size={24} color="#6366f1" />
          <div><div>No Invoices</div><strong>{summary.noInvoices}</strong></div>
        </div>

      </div>

      {/* SEARCH + EXPORT */}

      <div style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 12
      }}>

        <div style={{ position: "relative" }}>
          <FaSearch style={{ position: "absolute", left: 10, top: 9, color: "#888" }} />

          <input
            type="text"
            placeholder="Search supplier..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              padding: "7px 10px 7px 30px",
              borderRadius: 6,
              border: "1px solid #ccc",
              width: 260
            }}
          />
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          <FaFilePdf size={22} color="#dc2626" title="Export PDF"
            style={{ cursor: "pointer" }} onClick={exportPDF} />

          <FaFileExcel size={22} color="#16a34a" title="Export Excel"
            style={{ cursor: "pointer" }} onClick={exportExcel} />
        </div>

      </div>

      {/* TABLE */}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f3f4f6", textAlign: "left" }}>
            <th>Supplier</th>
            <th># Invoices</th>
            <th>Dues (Rs.)</th>
          </tr>
        </thead>

        <tbody>
          {paginated.map(s => (
            <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: 8 }}>{s.name}</td>
              <td>{(s.invoices || 0).toLocaleString()}</td>
              <td>{(s.balance || 0).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* PAGINATION */}

      <div style={{
        marginTop: 15,
        display: "flex",
        justifyContent: "center",
        gap: 10
      }}>
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</button>

        <span>Page {page} / {totalPages || 1}</span>

        <button
          disabled={page === totalPages || totalPages === 0}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>

    </div>
  );
}