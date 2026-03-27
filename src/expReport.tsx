import React, { useEffect, useState } from "react";
import { expenseRepository, Expense } from "./repositories/expenseRepository";
import { useLang } from "./i18n/LanguageContext";

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

  const { t, lang, setLang } = useLang();
  
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
      `Total Expenses: ${summary.totalExpenses.toFixed().toLocaleString()}`,
      14,
      y
    );
    y += gap;

    doc.text(
      `Highest Category: ${summary.highestCategory} (${summary.highestAmount.toFixed().toLocaleString()})`,
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

      const textAlign = lang === "ur" ? "text-right" : "text-left";

  return (
  <div className="p-4 sm:p-6">

    {/* ================= CARDS ================= */}
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-5">

      <div style={cardStyle}>
        <FaMoneyBillWave size={26} color="#ef4444" />
        <div>
          <div>{t("totalexpenses")}</div>
          <strong>
            Rs. {summary.totalExpenses.toLocaleString()}
          </strong>
        </div>
      </div>

      <div style={cardStyle}>
        <FaCrown size={26} color="#f59e0b" />
        <div>
          <div>{t("highestcategory")}</div>
          <strong>
            {summary.highestCategory} (
            {summary.highestAmount.toLocaleString()})
          </strong>
        </div>
      </div>

    </div>

    {/* ================= FILTER BAR ================= */}
    <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">

      {/* DATE FILTERS */}
      <div className="flex flex-wrap items-center gap-2">
        <span>{t("from")}:</span>
        <input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          className="border rounded px-2 py-1"
        />

        <span>{t("to")}:</span>
        <input
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          className="border rounded px-2 py-1"
        />
      </div>

      {/* RIGHT SIDE */}
      <div className="flex flex-wrap items-center gap-3 lg:ml-auto">

        {/* SEARCH */}
        <div className="relative">
          <FaSearch className="absolute left-2 top-2.5 text-gray-400" />

          <input
            placeholder={t("search")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="border rounded pl-8 pr-3 py-1.5"
          />
        </div>

        {/* EXPORT */}
        <FaFilePdf
          size={22}
          color="#dc2626"
          title={t("exportpdf")}
          className="cursor-pointer"
          onClick={exportPDF}
        />

        <FaFileExcel
          size={22}
          color="#16a34a"
          title={t("exportexcel")}
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
          <th className={`p-3 ${textAlign}`}>{t("date")}</th>
          <th className={`p-3 ${textAlign}`}>{t("category")}</th>
          <th className={`p-3 ${textAlign} hidden sm:table-cell`}>{t("amount")}</th>
          <th className={`p-3 ${textAlign} hidden md:table-cell`}>{t("remarks")}</th>
        </tr>
        </thead>

        <tbody>
          {paginated.length === 0 ? (
            <tr>
              <td colSpan={4} className="px-4 py-2 text-center text-gray-500">
                {t("noexpensesfound")}
              </td>
            </tr>
          ) : (
            paginated.map(e => (
              <tr key={e.id} className="border-b hover:bg-gray-50">
                {/* DATE */}
                <td className={`p-2 sm:p-4 ${textAlign}`}>
                  {new Date(e.date).toLocaleDateString()}
                </td>

                {/* CATEGORY */}
                <td className={`p-2 sm:p-4 font-medium ${textAlign}`}>
                  {e.category}
                </td>

                {/* AMOUNT */}
                <td className={`p-2 sm:p-4 hidden sm:table-cell ${textAlign}`}>
                  {e.amount.toLocaleString()}
                </td>

                {/* REMARKS */}
                <td className={`p-2 sm:p-4 hidden md:table-cell ${textAlign}`}>
                  {e.description}
                </td>

                {/* MOBILE STACKED INFO */}
                <td className={`p-2 sm:hidden flex flex-col text-xs text-gray-600 gap-1 mt-1 ${textAlign}`}>
                  <span>{t("amount")}: {e.amount.toLocaleString()}</span>
                  <span>{t("remarks")}: {e.description || "-"}</span>
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
        {t("prev")}
      </button>

      <span>
        {t("page")} {page} / {totalPages || 1}
      </span>

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