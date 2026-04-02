import React, { useEffect, useState } from "react";
import { FaMoneyBillWave,FaFilePdf } from "react-icons/fa";
import jsPDF from "jspdf";
import html2canvas from "html2canvas";

import { salesRepository } from "./repositories/salesRepository";
import { expenseRepository } from "./repositories/expenseRepository";
import { supplierPaymentRepository } from "./repositories/supplierPaymentRepository";
import { customerPaymentRepository } from "./repositories/customerPaymentRepository";
import { customersRepository } from "./repositories/customerRepository";
import { suppliersRepository, SuppliersRepository } from "./repositories/suppliersRepository";
import { useLang } from "./i18n/LanguageContext";

type Totals = {
  purchasePaid: number;
  supplierDuesPaid: number;
  customerReturnPaid: number;
  expenses: number;
  totalOut: number;

  salesPaid: number;
  customerDuesPaid: number;
  supplierReturnPaid: number;
  totalIn: number;
};

export default function CFReport() {

  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const { t, lang, setLang } = useLang();
  
  const [totals, setTotals] = useState<Totals>({
    purchasePaid: 0,
    supplierDuesPaid: 0,
    customerReturnPaid: 0,
    expenses: 0,
    totalOut: 0,

    salesPaid: 0,
    customerDuesPaid: 0,
    supplierReturnPaid: 0,
    totalIn: 0
  });

  useEffect(() => {
    loadReport();
  }, [fromDate, toDate]);

  async function loadReport() {

    const invoices = await salesRepository.getAllSales();
    const supplierPayments = await supplierPaymentRepository.getAll();
    const customerPayments = await customerPaymentRepository.getAll();
    const expenses = await expenseRepository.getAll();

    const customers = await customersRepository.getAll();
    const suppliers = await suppliersRepository.getAll();

    const savedCustomerNames = new Set(
      customers.map(c => (c.name || "").toLowerCase())
    );

    const savedSupplierNames = new Set(
      suppliers.map(s => (s.name || "").toLowerCase())
    );

    const inRange = (d: string) => {
      if (!fromDate && !toDate) return true;

      const date = new Date(d);

      if (fromDate && date < new Date(fromDate)) return false;
      if (toDate && date > new Date(toDate)) return false;

      return true;
    };

    let purchasePaid = 0;
    let salesPaid = 0;
    let customerReturnPaid = 0;
    let supplierReturnPaid = 0;

    invoices.forEach(inv => {

      if (!inRange(inv.date)) return;

      const paid = Number(inv.paid || 0);

      const customerName = (inv.customerName || "").toLowerCase();
      const supplierName = (inv.supplierName || "").toLowerCase();

      const isSavedCustomer = savedCustomerNames.has(customerName);
      const isSavedSupplier = savedSupplierNames.has(supplierName);

      if (inv.transactionType === "Purchase") {

        // only include invoice payment if supplier is NOT a saved supplier
        if (!isSavedSupplier) {
          purchasePaid += paid;
        }

      }

      else if (inv.transactionType === "Sale") {

        // only include invoice payment if customer is NOT a saved customer
        if (!isSavedCustomer) {
          salesPaid += paid;
        }

      }

      else if (inv.transactionType === "Return") {

        if (inv.invoiceNo?.startsWith("RET-C-")) {
          customerReturnPaid += Math.abs(paid);
        }

        else if (inv.invoiceNo?.startsWith("RET-S-")) {
          supplierReturnPaid += Math.abs(paid);
        }

      }

    });

    const supplierDuesPaid = supplierPayments
      .filter(p => inRange(p.paymentDate))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const customerDuesPaid = customerPayments
      .filter(p => inRange(p.paymentDate))
      .reduce((sum, p) => sum + Number(p.amount || 0), 0);

    const totalExpenses = expenses
      .filter(e => inRange(e.date))
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);

    const totalOut =
      purchasePaid +
      supplierDuesPaid +
      customerReturnPaid +
      totalExpenses;

    const totalIn =
      salesPaid +
      customerDuesPaid +
      supplierReturnPaid;

    setTotals({
      purchasePaid,
      supplierDuesPaid,
      customerReturnPaid,
      expenses: totalExpenses,
      totalOut,

      salesPaid,
      customerDuesPaid,
      supplierReturnPaid,
      totalIn
    });
  }

  const Card = ({
    title,
    value,
    color
  }: {
    title: string;
    value: number;
    color?: string;
  }) => (
    <div className={`rounded-xl shadow p-4 flex items-center gap-3 bg-white ${color}`}>
      <FaMoneyBillWave className="text-xl text-indigo-600" />
      <div>
        <div className="text-sm text-gray-600">{title}</div>
        <strong className="text-lg">Rs. {value.toLocaleString()}</strong>
      </div>
    </div>
  );

  const PDFCard = ({ title, value }: any) => (
  <div
    style={{
      border: "1px solid #ddd",
      borderRadius: 8,
      padding: 12,
      textAlign: "center",
      paddingBottom:27
    }}
  >
    <div style={{ fontSize: 12, color: "#555"}}>{title}</div>
    <strong>Rs. {value.toLocaleString()}</strong>
  </div>
);

const exportPDF = async () => {

  const element = document.getElementById("cfreport-pdf");
  if (!element) return;

  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true
  });

  const imgData = canvas.toDataURL("image/png");

  const pdf = new jsPDF("p", "mm", "a4");

  const imgWidth = 210;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;

  pdf.addImage(imgData, "PNG", 0, 10, imgWidth, imgHeight);

  pdf.save("CashFlowReport.pdf");
};

  return (
    <div className="p-4 sm:p-6">

      {/* TITLE */}
      <h2 className="text-2xl font-bold text-center mb-6">
        {t("cashflow_report")}
      </h2>

      {/* DATE FILTERS */}
      <div className="flex flex-wrap justify-center gap-4">
        <div>
          {t("from")}
          <input
            type="date"
            className="border rounded ml-2 px-2 py-1"
            value={fromDate}
            onChange={e => setFromDate(e.target.value)}
          />
        </div>

        <div>
          {t("to")}
          <input
            type="date"
            className="border rounded ml-2 px-2 py-1"
            value={toDate}
            onChange={e => setToDate(e.target.value)}
          />
        </div>
      </div>

    {/*PDF Button*/}
    <div className="flex justify-end mb-4">
  <FaFilePdf
    size={26}
    className="text-red-600 cursor-pointer hover:scale-110 transition"
    title={t("exportpdf")}
    onClick={exportPDF}
  />
  </div>

      {/* CASH OUT FLOW */}
      <h3 className="font-semibold mb-3">{t("cash_outflow")}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-10">

        <Card title={t("purchase_paid")} value={Number(totals.purchasePaid.toFixed())} />
        <Card title={t("supplier_dues_paid")} value={Number(totals.supplierDuesPaid.toFixed())} />
        <Card title={t("customer_ret_paid")} value={Number(totals.customerReturnPaid.toFixed())} />
        <Card title={t("expenses")} value={Number(totals.expenses.toFixed())} />
        <Card title={t("total_outflow")} value={Number(totals.totalOut.toFixed())} color="bg-yellow-50" />

      </div>

      {/* CASH IN FLOW */}
      <h3 className="font-semibold mb-3">{t("cash_inflow")}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-10">

        <Card title={t("sales_paid")} value={Number(totals.salesPaid.toFixed())} />
        <Card title={t("customer_dues_paid")} value={Number(totals.customerDuesPaid.toFixed())} />
        <Card title={t("supplier_ret_paid")} value={Number(totals.supplierReturnPaid.toFixed())} />
        <Card title={t("total_inflow")} value={Number(totals.totalIn.toFixed())} color="bg-yellow-50" />

      </div>

      {/* NET FLOW */}
      <h3 className="font-semibold mb-3">
        {t("net_inflow")}
      </h3>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

        <Card
          title={t("net_cash_position")}
          value={totals.totalIn - totals.totalOut}
          color="bg-yellow-50"
        />

      </div>

<div
  id="cfreport-pdf"
  className="p-8 bg-white"
  style={{ width: "900px", position: "absolute", left: "-9999px" }}
>
  <h1 style={{ textAlign: "center", marginBottom: 20,fontSize:24,fontWeight:"bold" }}>
    {t("cashflow_report")}
  </h1>

  <p style={{ textAlign: "center", marginBottom: 30 }}>
    {t("from")}: {fromDate || t("all")} — {t("to")}: {toDate || t("all")}
  </p>

  {/* OUT FLOW */}
  <h3>{t("cash_outflow")}</h3>
  <div style={{ display: "grid", gridTemplateColumns: "repeat(5,1fr)", gap: 10 }}>
    <PDFCard title={t("purchase_paid")} value={totals.purchasePaid}/>
    <PDFCard title={t("supplier_dues_paid")} value={totals.supplierDuesPaid}/>
    <PDFCard title={t("customer_ret_paid")} value={totals.customerReturnPaid}/>
    <PDFCard title={t("expenses")} value={totals.expenses}/>
    <PDFCard title={t("total_outflow")} value={totals.totalOut}/>
  </div>

  <h3 style={{ marginTop: 30 }}>{t("cash_inflow")}</h3>
  <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
    <PDFCard title={t("sales_paid")} value={totals.salesPaid}/>
    <PDFCard title={t("customer_dues_paid")} value={totals.customerDuesPaid}/>
    <PDFCard title={t("supplier_ret_paid")} value={totals.supplierReturnPaid}/>
    <PDFCard title={t("total_inflow")} value={totals.totalIn}/>
  </div>

  <h3 style={{ marginTop: 30 }}>{t("net_inflow")}</h3>
  <PDFCard title={t("net_cash_position")} value={totals.totalIn - totals.totalOut}/>
</div>
    </div>
  );

  
}