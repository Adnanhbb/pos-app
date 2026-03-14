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
  <div className="p-4 sm:p-6 max-w-5xl mx-auto">

    {/* TITLE */}
    <h2 className="text-2xl font-semibold text-center mb-6">
      Profit Report
    </h2>

    {/* DATE RANGE */}
    <div className="flex flex-col sm:flex-row justify-center items-center gap-4 mb-8 flex-wrap">

      <div className="flex items-center gap-2">
        <span>From</span>
        <input
          type="date"
          value={fromDate}
          onChange={e => setFromDate(e.target.value)}
          className="border rounded px-2 py-1"
        />
      </div>

      <div className="flex items-center gap-2">
        <span>To</span>
        <input
          type="date"
          value={toDate}
          onChange={e => setToDate(e.target.value)}
          className="border rounded px-2 py-1"
        />
      </div>

    </div>

    {/* SUMMARY CARDS */}
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">

      <div style={cardStyle}>
        <FaShoppingCart size={36} color="#3b82f6" />
        <div>
          <div>Net Profit</div>
          <strong>
            Rs. {totals.totalProfit.toFixed().toLocaleString()}
          </strong>
        </div>
      </div>

      <div style={cardStyle}>
        <FaMoneyBillWave size={36} color="#ef4444" />
        <div>
          <div>Total Expenses</div>
          <strong>
            Rs. {totals.totalExpenses.toFixed().toLocaleString()}
          </strong>
        </div>
      </div>

      <div style={cardStyle}>
        <FaDollarSign size={36} color="#10b981" />
        <div>
          <div>Final Profit</div>
          <strong>
            Rs. {totals.netProfit.toFixed().toLocaleString()}
          </strong>
        </div>
      </div>

    </div>

  </div>
);
}