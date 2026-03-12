import React, { useEffect, useState } from "react";
import { DBSale, Item } from "./db";
import { salesRepository } from "./repositories/salesRepository";
import { saleItemsRepository } from "./repositories/saleItemsRepository";
import { itemsRepository } from "./repositories/itemsRepository";

import {
  FaFilePdf,
  FaFileExcel,
  FaArrowUp,
  FaArrowDown,
  FaBan
} from "react-icons/fa";

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

interface ProductRow {
  product: string;
  category: string;
  brand: string;
  qty: number;
  sales: number;
  profit: number;
  dead?: boolean;
}

export default function ProdReport() {

  const [rows, setRows] = useState<ProductRow[]>([]);
  const [products, setProducts] = useState<Item[]>([]);

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [categoryFilter, setCategoryFilter] = useState("All");
  const [brandFilter, setBrandFilter] = useState("All");

  const [search, setSearch] = useState("");
  const visibleRows = rows.filter(r =>
  r.product.toLowerCase().includes(search.toLowerCase())
    );

  const [summary, setSummary] = useState({
    top: "",
    least: "",
    dead: 0
  });

  const PAGE_SIZE = 10;
  const [page, setPage] = useState(1);

  const totalPages = Math.ceil(visibleRows.length / PAGE_SIZE);

    const paginatedRows = visibleRows.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE
    );

  /* ---------------- LOAD PRODUCTS ---------------- */

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    const prods = await itemsRepository.getAll();
    setProducts(prods);
  };

  /* ---------------- BUILD REPORT ---------------- */

 useEffect(() => {
  if (products.length === 0) return; // wait until products loaded
  generateReport();
}, [products, fromDate, toDate, categoryFilter, brandFilter]);

const generateReport = async () => {

  const sales: DBSale[] =
    await salesRepository.getSalesPage(1, 100000);

  const items = await saleItemsRepository.getAll();

  const map = new Map<string, ProductRow>();

  /* ---------- FILTER SALES BY DATE ---------- */

  const filteredSales = sales.filter(s => {

    if (fromDate && new Date(s.date) < new Date(fromDate))
      return false;

    if (toDate && new Date(s.date) > new Date(toDate))
      return false;

    // include SALE + CUSTOMER RETURNS
    if (s.transactionType === "Sale") return true;

    if (
      s.transactionType === "Return" &&
      s.invoiceNo?.startsWith("RET-C")
    ) return true;

    return false;
  });

  const saleTypeMap = new Map<number, "Sale" | "Return">();

  filteredSales.forEach(s => {
    if (!s.id) return;

    if (s.transactionType === "Sale")
      saleTypeMap.set(s.id, "Sale");

    if (
      s.transactionType === "Return" &&
      s.invoiceNo?.startsWith("RET-C")
    )
      saleTypeMap.set(s.id, "Return");
  });

  /* ---------- AGGREGATE SALES ITEMS ---------- */

  items.forEach(it => {

    const type = saleTypeMap.get(it.saleId);
    if (!type) return;

    if (!map.has(it.name)) {
      map.set(it.name, {
        product: it.name,
        category: "",
        brand: "",
        qty: 0,
        sales: 0,
        profit: 0
      });
    }

    const row = map.get(it.name)!;

    /* ----- calculate line total ----- */

    const base = it.qty * it.price;

    const discount =
      it.discountType === "%"
        ? (base * it.discountValue) / 100
        : it.discountValue;

    const tax =
      it.taxType === "%"
        ? ((base - discount) * it.taxValue) / 100
        : it.taxValue;

    const total = base - discount + tax;

    /* ----- APPLY SIGN BASED ON TYPE ----- */

    const sign = type === "Sale" ? 1 : -1;

    row.qty += it.qty * sign;
    row.sales += total * sign;
  });

  /* ---------- MERGE ALL PRODUCTS (DEAD STOCK FIX) ---------- */

  products.forEach(p => {

    if (!map.has(p.name)) {
      map.set(p.name, {
        product: p.name,
        category: p.category,
        brand: p.brand,
        qty: 0,
        sales: 0,
        profit: 0,
        dead: true
      });
    } else {
      const row = map.get(p.name)!;
      row.category = p.category;
      row.brand = p.brand;
    }
  });

  let result = Array.from(map.values());

  /* ---------- APPLY CATEGORY / BRAND FILTERS ---------- */

  if (categoryFilter !== "All")
    result = result.filter(r => r.category === categoryFilter);

  if (brandFilter !== "All")
    result = result.filter(r => r.brand === brandFilter);

  /* ---------- SORT DESC BY QTY SOLD ---------- */

  result.sort((a, b) => b.qty - a.qty);

  setRows(result);

  /* ---------- SUMMARY ---------- */

  const soldOnly = result.filter(r => r.qty > 0);

  const top =
    soldOnly[0]?.product || "-";

  const least =
    soldOnly[soldOnly.length - 1]?.product || "-";

  const dead = result.filter(r => r.qty === 0).length;

  setSummary({ top, least, dead });
};

  useEffect(() => {
  setPage(1);
}, [search]);

  /* ---------------- EXPORT PDF ---------------- */

const exportPDF = () => {

  const doc = new jsPDF();

  /* ---------- HEADER ---------- */

  doc.setFontSize(16);
  doc.text("Product Sales Report", 14, 15);

  doc.setFontSize(10);
  doc.text(
    `Date Range: ${fromDate || "Start"}  -  ${toDate || "Today"}`,
    14,
    22
  );

  /* ---------- SUMMARY (CARDS DATA) ---------- */

  doc.setFontSize(11);

  doc.text(`Top Selling: ${summary.top}`, 14, 32);
  doc.text(`Least Selling: ${summary.least}`, 14, 38);
  doc.text(`Dead Stock Items: ${summary.dead}`, 14, 44);

  const totalSales = rows.reduce((s, r) => s + r.sales, 0);
  const totalQty = rows.reduce((s, r) => s + r.qty, 0);

  doc.text(`Total Qty Sold: ${totalQty}`, 120, 32);
  doc.text(`Total Sales: Rs. ${totalSales.toLocaleString()}`, 120, 38);

  /* ---------- TABLE ---------- */

  autoTable(doc, {
    startY: 50,
    head: [[
      "Product",
      "Category",
      "Brand",
      "Net Qty Sold",
      "Net Sales",
    ]],
    body: rows.map(r => [
      r.product,
      r.category,
      r.brand,
      r.qty,
      r.sales.toLocaleString(),
    ]),
    styles: {
      fontSize: 9
    },
    headStyles: {
      fillColor: [37, 99, 235]
    }
  });

  doc.save("Product_Report.pdf");
};

  /* ---------------- EXPORT EXCEL ---------------- */

const exportExcel = () => {

  /* ---------- HEADER DATA ---------- */

  const headerRows = [
    ["Product Sales Report"],
    [`Date Range: ${fromDate || "Start"} - ${toDate || "Today"}`],
    [],
    ["Top Selling", summary.top],
    ["Least Selling", summary.least],
    ["Dead Stock Count", summary.dead],
    []
  ];

  /* ---------- TABLE DATA ---------- */
  // REQUIRED: hide Profit, Dead, Brand, Category

  const tableData = rows.map(r => ({
    Product: r.product,
    "Net Qty Sold": r.qty,
    Sales: r.sales
  }));

  const worksheet = XLSX.utils.json_to_sheet([]);

  // add header section
  XLSX.utils.sheet_add_aoa(worksheet, headerRows, { origin: "A1" });

  // add table after header
  XLSX.utils.sheet_add_json(
    worksheet,
    tableData,
    { origin: "A8" }
  );

  /* ---------- COLUMN WIDTH ---------- */

  worksheet["!cols"] = [
    { wch: 30 },
    { wch: 12 },
    { wch: 18 }
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Product Report");

  XLSX.writeFile(workbook, "Product_Report.xlsx");
};

  /* ---------------- UI ---------------- */

  const cardStyle = {
    padding: 15,
    borderRadius: 12,
    background: "#fff",
    boxShadow: "0 4px 10px rgba(0,0,0,0.08)",
    display: "flex",
    alignItems: "center",
    gap: 12
  };

  return (
    <div style={{ padding: 20 }}>

      {/* SUMMARY CARDS */}

      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(3,1fr)",
        gap: 15,
        marginBottom: 20
      }}>

        <div style={cardStyle}>
          <FaArrowUp color="#10b981" size={24}/>
          <div>
            <div>Top Selling</div>
            <strong>{summary.top}</strong>
          </div>
        </div>

        <div style={cardStyle}>
          <FaArrowDown color="#f59e0b" size={24}/>
          <div>
            <div>Least Selling</div>
            <strong>{summary.least}</strong>
          </div>
        </div>

        <div style={cardStyle}>
          <FaBan color="#ef4444" size={24}/>
          <div>
            <div>Dead Stock Items</div>
            <strong>{summary.dead}</strong>
          </div>
        </div>

      </div>

      {/* FILTER BAR */}

      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        marginBottom: 15
      }}>

        From
        <input type="date" value={fromDate}
          onChange={e => setFromDate(e.target.value)} />

        To
        <input type="date" value={toDate}
          onChange={e => setToDate(e.target.value)} />

        {/* EXPORT ICONS — EXTREME RIGHT */}

        <div style={{
  marginLeft: "auto",
  display: "flex",
  alignItems: "center",
  gap: 12
}}>

  {/* SEARCH */}
  <input
    type="text"
    placeholder="Search product..."
    value={search}
    onChange={e => setSearch(e.target.value)}
    style={{
      padding: "6px 10px",
      borderRadius: 6,
      border: "1px solid #ccc",
      width: 220
    }}
  />

  <FaFilePdf
    size={22}
    color="#dc2626"
    title="Export PDF"
    style={{ cursor: "pointer" }}
    onClick={exportPDF}
  />

  <FaFileExcel
    size={22}
    color="#16a34a"
    title="Export Excel"
    style={{ cursor: "pointer" }}
    onClick={exportExcel}
  />

</div>
      </div>

      {/* TABLE */}

      <table style={{
        width: "100%",
        borderCollapse: "collapse",
      }}>
        <thead>
          <tr style={{ background:"#f3f4f6",textAlign:"left" }}>
            <th>Product</th>
            <th>Net Qty Sold</th>
            <th>Net Sales</th>
          </tr>
        </thead>

        <tbody>
          {paginatedRows.map(r => (
            <tr key={r.product}
                style={{
                  borderBottom:"1px solid #eee",
                  opacity: r.dead ? 0.6 : 1
                }}>
              <td>{r.product}</td>
              <td>{r.qty}</td>
              <td>{r.sales.toFixed(0)}</td>
            </tr>
          ))}
        </tbody>
      </table>

<div style={{
  marginTop: 20,
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  gap: 12
}}>

  <button
    disabled={page === 1}
    onClick={() => setPage(1)}
  >
    First
  </button>

  <button
    disabled={page === 1}
    onClick={() => setPage(p => p - 1)}
  >
    Prev
  </button>

  <span>
    Page {page} / {totalPages || 1}
  </span>

  <button
    disabled={page === totalPages || totalPages === 0}
    onClick={() => setPage(p => p + 1)}
  >
    Next
  </button>

  <button
    disabled={page === totalPages || totalPages === 0}
    onClick={() => setPage(totalPages)}
  >
    Last
  </button>

</div>

    </div>
  );
}