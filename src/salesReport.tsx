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

const exportPDF = () => {

  const doc = new jsPDF();

  const tableColumn = [
    "Invoice",
    "Date",
    "Customer/Supplier",
    "Grand Total",
    "Paid",
    "Arrears",
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

  autoTable(doc,{
    head:[tableColumn],
    body:tableRows,
    startY:20
  });

  doc.text("Sales Report",14,15);

  doc.save("sales_report.pdf");

};

const exportExcel = () => {
  const wsData = [
    ["Invoice", "Date", "Customer/Supplier", "Grand Total", "Paid", "Arrears", "Profit"],
    ...filtered.map(s => [
      s.invoiceNo,
      s.date,
      s.customerName || s.supplierName,
      s.grandTotal,
      s.paid,
      s.arrears,
      s.profit || 0
    ])
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, "SalesReport");
  XLSX.writeFile(wb, "sales_report.xlsx");
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

      if (s.transactionType === "Sale") {
        totals.sales += s.grandTotal;
        totals.profit += s.profit || 0;
      }

      if (s.transactionType === "Purchase") {
        totals.purchases += s.grandTotal;
      }

      if (s.transactionType === "Return") {

        if (s.invoiceNo?.startsWith("RET-C")) {
          totals.customerReturns += s.grandTotal;
        }

        if (s.invoiceNo?.startsWith("RET-S")) {
          totals.supplierReturns += s.grandTotal;
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
          <FaShoppingCart size={26} color="#ef4444"/>
          <div>
            <div>Sales</div>
            <strong>Rs. {totals.sales.toLocaleString()}</strong>
          </div>
        </div>

        <div style={cardStyle}>
          <FaTruck size={26} color="#eab308"/>
          <div>
            <div>Purchases</div>
            <strong>Rs. {totals.purchases.toLocaleString()}</strong>
          </div>
        </div>

        <div style={cardStyle}>
          <FaUndo size={26} color="#10b981"/>
          <div>
            <div>Cust. Returns</div>
            <strong>Rs. {totals.customerReturns.toLocaleString()}</strong>
          </div>
        </div>

        <div style={cardStyle}>
          <FaUndo size={26} color="#3b82f6"/>
          <div>
            <div>Supp. Returns</div>
            <strong>Rs. {totals.supplierReturns.toLocaleString()}</strong>
          </div>
        </div>

        <div style={cardStyle}>
          <FaFileInvoice size={26} color="#f59e0b"/>
          <div>
            <div>Profit</div>
            <strong>Rs. {totals.profit.toLocaleString()}</strong>
          </div>
        </div>

      </div>

      {/* FILTERS */}

      {/* FILTERS + RETURN SUBFILTERS */}
    {/* FILTERS */}
<div style={{
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 15
}}>

  {/* Left: Filter radios + optional Return sub-filters + Date inputs */}
  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>

    {/* Main filter radios */}
    <div style={{ display: "flex", gap: 8 }}>
      {["All","Sale","Purchase","Return","Quotation"].map(type => (
        <button
          key={type}
          style={radioStyle(type as FilterType)}
          onClick={() => setFilterType(type as FilterType)}
        >
          {type}
        </button>
      ))}
    </div>

    {/* Return sub-filter radios: only visible if Return is selected */}
    {filterType === "Return" && (
      <div className="text-xs" style={{ display: "flex", gap: 6 }}>
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
            {sub}
          </button>
        ))}
      </div>
    )}

    {/* Date inputs */}
    <div style={{ display: "flex", gap: 8, marginLeft: 20 }}>
      <div>
        From
        <input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          style={{ marginLeft: 6 }}
        />
      </div>

      <div>
        To
        <input
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          style={{ marginLeft: 6 }}
        />
      </div>
    </div>

  </div>

  {/* Right: Export buttons */}
  <div style={{ display:"flex", gap:12 }}>

  <div
    data-tooltip-id="pdfTip"
    data-tooltip-content="Export PDF"
    style={{ cursor:"pointer" }}
    onClick={exportPDF}
  >
    <FaFilePdf size={22} color="#ef4444"/>
  </div>

  <div
    data-tooltip-id="excelTip"
    data-tooltip-content="Export Excel"
    style={{ cursor:"pointer" }}
    onClick={exportExcel}
  >
    <FaFileExcel size={22} color="#22c55e"/>
  </div>

  <Tooltip id="pdfTip" />
  <Tooltip id="excelTip" />

</div>

</div>

      {/* TABLE */}

      <table style={{
        width: "100%",
        borderCollapse: "collapse",
      }}>

        <thead>

          <tr style={{ background: "#f3f4f6", textAlign:"left" }}>
            <th style={{ padding: 8 }}>Invoice</th>
            <th>Date</th>
            <th>Customer/Supplier</th>
            <th>Grand Total</th>
            <th>Paid</th>
            <th>Arrears</th>
            <th>Profit</th>
          </tr>

        </thead>

        <tbody>

          {paginated.map(s => (

            <tr key={s.id} style={{ borderBottom: "1px solid #eee" }}>

              <td style={{ padding: 8 }}>{s.invoiceNo}</td>
              <td>{s.date}</td>

              <td>
                {s.customerName || s.supplierName}
              </td>

              <td>{s.grandTotal.toLocaleString()}</td>
              <td>{s.paid.toLocaleString()}</td>
              <td>{s.arrears.toLocaleString()}</td>
              <td>{(s.profit || 0).toLocaleString()}</td>

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

        <button
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          Prev
        </button>

        <span>
          Page {page} / {totalPages || 1}
        </span>

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