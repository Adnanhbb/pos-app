import React, { useEffect, useState } from "react";
import { expenseRepository, Expense } from "./repositories/expenseRepository";

import { FaSearch, FaFilePdf, FaFileExcel, FaMoneyBillWave, FaCrown } from "react-icons/fa";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

const PAGE_SIZE = 10;

export default function ExpReport() {

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [filtered, setFiltered] = useState<Expense[]>([]);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [search, setSearch] = useState("");

  const [page, setPage] = useState(1);

  const [summary, setSummary] = useState({
    totalExpenses: 0,
    highestCategory: "-",
    highestAmount: 0
  });

  /* --------------------------------------------------
     LOAD DATA
  -------------------------------------------------- */

  useEffect(() => {
    loadExpenses();
  }, []);

  const loadExpenses = async () => {
    const data = await expenseRepository.getAll();

    // latest first
    data.sort(
      (a, b) =>
        new Date(b.date).getTime() -
        new Date(a.date).getTime()
    );

    setExpenses(data);
    applyFilters(data);
  };

  /* --------------------------------------------------
     FILTERING
  -------------------------------------------------- */

  useEffect(() => {
    applyFilters(expenses);
    setPage(1);
  }, [search, fromDate, toDate]);

  const applyFilters = (data: Expense[]) => {

    let result = [...data];

    /* DATE FILTER */
    result = result.filter(e => {

      if (fromDate && new Date(e.date) < new Date(fromDate))
        return false;

      if (toDate && new Date(e.date) > new Date(toDate))
        return false;

      return true;
    });

    /* SEARCH */
    if (search.trim()) {
      const term = search.toLowerCase();

      result = result.filter(e =>
        e.category.toLowerCase().includes(term) ||
        (e.description || "").toLowerCase().includes(term)
      );
    }

    setFiltered(result);
    calculateSummary(result);
  };

  /* --------------------------------------------------
     SUMMARY
  -------------------------------------------------- */

  const calculateSummary = (data: Expense[]) => {

    let total = 0;

    const categoryMap = new Map<string, number>();

    data.forEach(e => {
      total += e.amount;

      categoryMap.set(
        e.category,
        (categoryMap.get(e.category) || 0) + e.amount
      );
    });

    let highestCategory = "-";
    let highestAmount = 0;

    categoryMap.forEach((amt, cat) => {
      if (amt > highestAmount) {
        highestAmount = amt;
        highestCategory = cat;
      }
    });

    setSummary({
      totalExpenses: total,
      highestCategory,
      highestAmount
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

  /* --------------------------------------------------
     EXPORT PDF
  -------------------------------------------------- */

  const exportPDF = () => {

    const doc = new jsPDF();

    doc.setFontSize(16);
    doc.text("Expense Report", 14, 15);

    doc.setFontSize(11);

    let y = 25;
    const gap = 7;

    doc.text(
      `Total Expenses: ${summary.totalExpenses.toLocaleString()}`,
      14,
      y
    );
    y += gap;

    doc.text(
      `Highest Category: ${summary.highestCategory} (${summary.highestAmount.toLocaleString()})`,
      14,
      y
    );

    y += 10;

    autoTable(doc, {
      startY: y,
      head: [["Date", "Category", "Amount", "Remarks"]],
      body: filtered.map(e => [
        new Date(e.date).toLocaleDateString(),
        e.category,
        e.amount.toLocaleString(),
        e.description || ""
      ])
    });

    doc.save("expense_report.pdf");
  };

  /* --------------------------------------------------
     EXPORT EXCEL
  -------------------------------------------------- */

  const exportExcel = () => {

    const wsData = [
      ["Expense Report"],
      [],
      ["Total Expenses", summary.totalExpenses],
      [
        "Highest Category",
        `${summary.highestCategory} (${summary.highestAmount})`
      ],
      [],
      ["Date", "Category", "Amount", "Remarks"],
      ...filtered.map(e => [
        new Date(e.date).toLocaleDateString(),
        e.category,
        e.amount,
        e.description || ""
      ])
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws["!cols"] = [
      { wch: 15 },
      { wch: 25 },
      { wch: 15 },
      { wch: 35 }
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Expense Report");
    XLSX.writeFile(wb, "expense_report.xlsx");
  };

  /* --------------------------------------------------
     CARD STYLE
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
    <div style={{ padding: 20 }}>

      {/* ================= CARDS ================= */}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2,1fr)",
          gap: 15,
          marginBottom: 20
        }}
      >

        <div style={cardStyle}>
          <FaMoneyBillWave size={26} color="#ef4444" />
          <div>
            <div>Total Expenses</div>
            <strong>
              Rs. {summary.totalExpenses.toLocaleString()}
            </strong>
          </div>
        </div>

        <div style={cardStyle}>
          <FaCrown size={26} color="#f59e0b" />
          <div>
            <div>Highest Category</div>
            <strong>
              {summary.highestCategory} (
              {summary.highestAmount.toLocaleString()})
            </strong>
          </div>
        </div>

      </div>

      {/* ================= FILTER BAR ================= */}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 12
        }}
      >

        <div style={{ display: "flex", gap: 10 }}>
            From:
          <input type="date" value={fromDate}
            onChange={e => setFromDate(e.target.value)} />
            To:
          <input type="date" value={toDate}
            onChange={e => setToDate(e.target.value)} />
        </div>

        <div style={{ display: "flex", gap: 12 }}>

          <div style={{ position: "relative" }}>
            <FaSearch
              style={{
                position: "absolute",
                left: 8,
                top: 8,
                color: "#888"
              }}
            />

            <input
              placeholder="Search..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                padding: "6px 8px 6px 26px",
                border: "1px solid #ccc",
                borderRadius: 6
              }}
            />
          </div>

          <FaFilePdf
            size={22}
            color="#dc2626"
            style={{ cursor: "pointer" }}
            onClick={exportPDF}
          />

          <FaFileExcel
            size={22}
            color="#16a34a"
            style={{ cursor: "pointer" }}
            onClick={exportExcel}
          />

        </div>

      </div>

      {/* ================= TABLE ================= */}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f3f4f6" ,textAlign:"left"}}>
            <th>Date</th>
            <th>Category</th>
            <th>Amount</th>
            <th>Remarks</th>
          </tr>
        </thead>

        <tbody>
          {paginated.map(e => (
            <tr key={e.id} style={{ borderBottom: "1px solid #eee" }}>
              <td>{new Date(e.date).toLocaleDateString()}</td>
              <td>{e.category}</td>
              <td>{e.amount.toLocaleString()}</td>
              <td>{e.description}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* ================= PAGINATION ================= */}

      <div
        style={{
          marginTop: 15,
          display: "flex",
          justifyContent: "center",
          gap: 10
        }}
      >
        <button disabled={page === 1}
          onClick={() => setPage(page - 1)}>Prev</button>

        <span>Page {page} / {totalPages || 1}</span>

        <button
          disabled={page === totalPages || totalPages === 0}
          onClick={() => setPage(page + 1)}>
          Next
        </button>
      </div>

    </div>
  );
}