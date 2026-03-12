import React, { useEffect, useState } from "react";
import { salesRepository } from "./repositories/salesRepository";
import { expenseRepository } from "./repositories/expenseRepository"; // assuming you have this
import { FaMoneyBillWave, FaShoppingCart, FaDollarSign } from "react-icons/fa";

export default function ProfReport() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const [totals, setTotals] = useState({
    totalProfit: 0,
    totalExpenses: 0,
    netProfit: 0
  });

  // Recalculate totals whenever dates change
  useEffect(() => {
    if (!fromDate || !toDate) return;
    calculateTotals();
  }, [fromDate, toDate]);

  const calculateTotals = async () => {
    // Fetch sales within date range
    const sales = await salesRepository.getSalesPage(1, 1000); // all sales
    const filteredSales = sales.filter(s => {
      const date = new Date(s.date);
      return date >= new Date(fromDate) && date <= new Date(toDate);
    });

    let profit = 0;
    filteredSales.forEach(s => {
      if (s.transactionType === "Sale") profit += s.profit || 0;
      if (s.transactionType === "Return" && s.invoiceNo?.startsWith("RET-C")) profit -= s.profit || 0;
    });

    // Fetch expenses within date range
    const expenses = await expenseRepository.getByDateRange(fromDate, toDate);
    const totalExpenses = expenses.reduce((sum, exp) => sum + exp.amount, 0);

    setTotals({
      totalProfit: profit,
      totalExpenses,
      netProfit: profit - totalExpenses
    });
  };

  const cardStyle = {
    flex: 1,
    padding: "25px",
    borderRadius: "15px",
    background: "#fff",
    boxShadow: "0 6px 20px rgba(0,0,0,0.1)",
    display: "flex",
    alignItems: "center",
    gap: "20px",
    fontSize: "1.2rem"
  };

  return (
    <div style={{ padding: 30, maxWidth: 900, margin: "0 auto" }}>
      <h2 style={{ textAlign: "center", marginBottom: 30, fontSize: "2rem" }}>Profit Report</h2>

      {/* Date Range Inputs */}
      <div style={{ display: "flex", justifyContent: "center", gap: 20, marginBottom: 40 }}>
        <div>
          From
          <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ marginLeft: 8 }} />
        </div>
        <div>
          To
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ marginLeft: 8 }} />
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: "flex", gap: 25, justifyContent: "center" }}>
        <div style={cardStyle}>
          <FaShoppingCart size={40} color="#3b82f6" />
          <div>
            <div>Net Profit</div>
            <strong>Rs. {totals.totalProfit.toLocaleString()}</strong>
          </div>
        </div>

        <div style={cardStyle}>
          <FaMoneyBillWave size={40} color="#ef4444" />
          <div>
            <div>Total Expenses</div>
            <strong>Rs. {totals.totalExpenses.toLocaleString()}</strong>
          </div>
        </div>

        <div style={cardStyle}>
          <FaDollarSign size={40} color="#10b981" />
          <div>
            <div>Final Profit</div>
            <strong>Rs. {totals.netProfit.toLocaleString()}</strong>
          </div>
        </div>
      </div>
    </div>
  );
}