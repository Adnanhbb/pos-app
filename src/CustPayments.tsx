import React, { useEffect, useState } from "react";
import { indexedDbCustomerPaymentRepository as customerPaymentsRepo } from "./repositories/indexedDbCustomerPaymentRepository";
import { indexedDbCustomerRepository as customerRepo } from "./repositories/indexedDbCustomerRepository";
import {CustomerPayment,Customer} from "./db";
import { useLang } from "./i18n/LanguageContext";

import {
  FaPlus,
  FaSearch,
  FaList,
  FaTh,
  FaEdit,
  FaTrash,
} from "react-icons/fa";

const PAGE_SIZE = 8;

type PaymentForm = {
  customerId: number;
  amount: number;
  paymentDate: string;
  remarks: string;
  payableSnapshot: number;
};

export default function CustPayments() {
  const [payments, setPayments] = useState<CustomerPayment[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [view, setView] = useState<"table" | "cards">("table");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [isFormOpen, setFormOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<CustomerPayment | null>(null);

  const emptyForm: PaymentForm = {
    customerId: 0,
    amount: 0,
    paymentDate: new Date().toISOString().slice(0, 10),
    remarks: "",
    payableSnapshot: 0,
  };

  const [form, setForm] = useState<PaymentForm>(emptyForm);

  const { t, lang, setLang } = useLang();
  
  useEffect(() => {
    loadCustomers();
    loadPage();
  }, [page, query]);

  async function loadCustomers() {
    const all = await customerRepo.getAll();
    setCustomers(all);
  }

  async function loadPage() {
    let data = await customerPaymentsRepo.getAll();

    if (query.trim()) {
      const q = query.toLowerCase();
      data = data.filter((p: CustomerPayment) => {
      const c = customers.find((x: Customer) => x.id === p.customerId);
      return c?.name.toLowerCase().includes(q);
    });
    }

    const totalCount = data.length;
    const start = (page - 1) * PAGE_SIZE;
    setPayments(data.slice(start, start + PAGE_SIZE));
    setTotal(totalCount);
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function openCreate() {
    setEditingPayment(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(p: CustomerPayment) {
    setEditingPayment(p);
    setForm({
      customerId: p.customerId,
      amount: p.amount,
      paymentDate: p.paymentDate,
      remarks: p.remarks ?? "",
      payableSnapshot: p.payableSnapshot,
    });
    setFormOpen(true);
  }

  function closeForm() {
    setEditingPayment(null);
    setForm(emptyForm);
    setFormOpen(false);
  }

 async function handleSave() {
  if (!form.customerId) return alert("Select customer");
  if (form.amount <= 0) return alert("Enter valid amount");

  if (editingPayment) {
    // Update existing payment: include all properties
    const updatedPayment: CustomerPayment = {
      id: editingPayment.id!,
      customerId: form.customerId,
      amount: form.amount,
      paymentDate: form.paymentDate,
      remarks: form.remarks,
      payableSnapshot: form.payableSnapshot,
      // Fill the other properties from existing record if needed
      customerName: editingPayment.customerName,
      invoiceNo: editingPayment.invoiceNo,
      balanceSnapshot: editingPayment.balanceSnapshot,
    };
    await customerPaymentsRepo.update(updatedPayment);
  } else {
    // Add new payment: only required fields
    const newPayment: Omit<CustomerPayment, "id"> = {
      customerId: form.customerId,
      amount: form.amount,
      paymentDate: form.paymentDate,
      remarks: form.remarks,
      payableSnapshot: form.payableSnapshot,
      // Provide default or empty values for other required fields
      customerName: customers.find(c => c.id === form.customerId)?.name || "",
      invoiceNo: "",            // default or generate
      balanceSnapshot: form.payableSnapshot,
    };
    await customerPaymentsRepo.add(newPayment);
  }

  await loadPage();
  await loadCustomers();
  closeForm();
}

  async function handleDelete(id: number) {
    if (!confirm("Delete this payment?")) return;
    await customerPaymentsRepo.delete(id);
    await loadPage();
    await loadCustomers();
  }

      const textAlign = lang === "ur" ? "text-right" : "text-left";

 return (
  <div className="p-2 sm:p-4 lg:p-8">

    {/* HEADER */}
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">{t("customerpayments")}</h2>
        <button
          className={`p-2 rounded ${view === "table" ? "bg-indigo-600 text-white" : "bg-gray-200"}`}
          onClick={() => setView("table")}
        >
          <FaList />
        </button>
        <button
          className={`p-2 rounded ${view === "cards" ? "bg-indigo-600 text-white" : "bg-gray-200"}`}
          onClick={() => setView("cards")}
        >
          <FaTh />
        </button>
      </div>

      <div className="flex gap-2 flex-wrap w-full sm:w-auto">
        <div className="flex items-center bg-white px-2 rounded shadow flex-1 min-w-[150px]">
          <FaSearch className="text-gray-500" />
          <input
            className="p-2 outline-none w-full sm:w-48"
            placeholder={t("searchcustomer")}
            value={query}
            onChange={e => { setQuery(e.target.value); setPage(1); }}
          />
        </div>

        <button
          onClick={openCreate}
          className="bg-green-600 text-white px-4 py-2 rounded shadow flex items-center gap-2 flex-none"
        >
          <FaPlus /> {t("addpayment")}
        </button>
      </div>
    </div>

    {/* TABLE VIEW */}
    {view === "table" && (
      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-200">
           <tr>
            <th className={`p-3 ${textAlign}`}>{t("date")}</th>
            <th className={`p-3 ${textAlign}`}>{t("customer")}</th>

            <th className={`p-3 ${textAlign} hidden sm:table-cell`}>
              {t("payable")}
            </th>

            <th className={`p-3 ${textAlign} hidden sm:table-cell`}>
              {t("paid")}
            </th>

            <th className={`p-3 ${textAlign} hidden sm:table-cell`}>
              {t("balance")}
            </th>

            <th className={`p-3 ${textAlign} hidden md:table-cell`}>
              {t("remarks")}
            </th>

            {/* actions usually stays centered */}
            <th className="p-3 text-center">
              {t("actions")}
            </th>
          </tr>
          </thead>
          <tbody>
            {payments.length === 0 ? (
              <tr>
                <td colSpan={7} className="p-4 text-center text-gray-500">{t("nopaymentsfound")}</td>
              </tr>
            ) : (
              payments.map(p => {
                const c = customers.find(x => x.id === p.customerId);
                return (
                  <tr key={p.id} className="border-b">
                    {/* Date */}
                    <td className="p-2 md:p-3">{new Date(p.paymentDate).toLocaleDateString()}</td>

                    {/* Customer */}
                    <td className="p-2 md:p-3">{c?.name}</td>

                    {/* Payable, Paid, Balance (hidden on mobile) */}
                    <td className="p-2 md:p-3 hidden sm:table-cell">{p.payableSnapshot}</td>
                    <td className="p-2 md:p-3 hidden sm:table-cell">{p.amount}</td>
                    <td className="p-2 md:p-3 hidden sm:table-cell">{p.balanceSnapshot}</td>

                    {/* Remarks (hidden on small screens) */}
                    <td className="p-2 md:p-3 hidden md:table-cell">{p.remarks}</td>

                    {/* Actions */}
                    <td className="p-2 md:p-3 flex justify-center gap-2">
                      <button onClick={() => handleDelete(p.id!)} className="p-2 bg-red-500 text-white rounded">
                        <FaTrash />
                      </button>
                    </td>

                    {/* Mobile stacked info */}
                    <td className="p-2 md:p-3 sm:hidden flex flex-col gap-1 text-xs text-gray-600">
                      <span>{t("payable")}: {p.payableSnapshot}</span>
                      <span>{t("paid")}: {p.amount}</span>
                      <span>{t("balance")}: {p.balanceSnapshot}</span>
                      <span>{t("remarks")}: {p.remarks}</span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    )}

    {/* CARDS VIEW */}
    {view === "cards" && (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {payments.map(p => {
          const c = customers.find(x => x.id === p.customerId);
          return (
            <div key={p.id} className="bg-white rounded-xl shadow border p-4 flex flex-col justify-between">
              <div className="flex flex-col gap-1">
                <div className="font-semibold">{c?.name}</div>
                <div className="text-xs text-gray-600">{t("date")}: {new Date(p.paymentDate).toLocaleDateString()}</div>
                <div className="text-xs text-gray-600">{t("payable")}: {p.payableSnapshot}</div>
                <div className="text-xs text-gray-600">{t("paid")}: {p.amount}</div>
                <div className="text-xs text-gray-600">{t("balance")}: {p.balanceSnapshot}</div>
                <div className="text-xs text-gray-600">{t("remarks")}: {p.remarks}</div>
              </div>
              <div className="flex gap-2 mt-3">
                <button onClick={() => handleDelete(p.id!)} className="flex-1 bg-red-500 text-white p-2 rounded text-sm">
                  {t("delete")}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    )}

    {/* PAGINATION */}
    <div className="mt-4 flex justify-center gap-2 flex-wrap">
      <button disabled={page === 1} onClick={() => setPage(page - 1)} className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50">{t("prev")}</button>
      <span className="px-3 py-1 bg-gray-200 rounded">{t("page")} {page} / {totalPages}</span>
      <button disabled={page === totalPages} onClick={() => setPage(page + 1)} className="px-3 py-1 bg-gray-200 rounded disabled:opacity-50">{t("next")}</button>
    </div>

    {/* MODAL */}
    {isFormOpen && (
      <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
        <div className="bg-white p-6 rounded-xl w-full max-w-md">
          <h2 className="text-xl font-bold mb-4">{editingPayment ? t("editpayment") : t("addpayment")}</h2>

          <select
            className="w-full p-2 border rounded mb-2"
            value={form.customerId}
            onChange={e => {
              const id = Number(e.target.value);
              const c = customers.find(x => x.id === id);
              setForm({
                ...form,
                customerId: id,
                payableSnapshot: c?.balance ?? 0,
              });
            }}
          >
            <option value={0}>{t("selectcustomer")}</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <label className="text-sm text-gray-600">{t("totalpayable")}</label>
          <input className="w-full p-2 border rounded mb-2" disabled value={form.payableSnapshot} />

          <label className="text-sm text-gray-600">{t("amountpaid")}</label>
          <input
            type="number"
            className="w-full p-2 border rounded mb-2"
            value={form.amount}
            onChange={e => setForm({ ...form, amount: Number(e.target.value) })}
          />

          <label className="text-sm text-gray-600">{t("paymentdate")}</label>
          <input
            type="date"
            className="w-full p-2 border rounded mb-2"
            value={form.paymentDate}
            onChange={e => setForm({ ...form, paymentDate: e.target.value })}
          />

          <textarea
            className="w-full p-2 border rounded mb-2"
            placeholder={t("remarks")}
            value={form.remarks}
            onChange={e => setForm({ ...form, remarks: e.target.value })}
          />

          <div className="flex justify-end gap-2 flex-wrap">
            <button onClick={closeForm} className="px-4 py-2 bg-gray-300 rounded flex-1 sm:flex-none">{t("cancel")}</button>
            <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white rounded flex-1 sm:flex-none">{t("save")}</button>
          </div>
        </div>
      </div>
    )}

  </div>
);
}
