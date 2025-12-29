import React, { useEffect, useState } from "react";
import { indexedDbCustomerPaymentRepository as customerPaymentsRepo } from "./repositories/indexedDbCustomerPaymentRepository";
import { indexedDbCustomerRepository as customerRepo } from "./repositories/indexedDbCustomerRepository";
import {CustomerPayment,Customer} from "./db";

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
      data = data.filter(p => {
        const c = customers.find(x => x.id === p.customerId);
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
      await customerPaymentsRepo.update(
        editingPayment.id!,
        form.customerId,
        form.amount,
        form.paymentDate,
        form.remarks,
        form.payableSnapshot
      );
    } else {
      await customerPaymentsRepo.add(
        form.customerId,
        form.amount,
        form.paymentDate,
        form.remarks,
        form.payableSnapshot
      );
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

  return (
    <div className="p-2 sm:p-4 lg:p-8">

      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Customer Payments</h2>
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

        <div className="flex gap-2">
          <div className="flex items-center bg-white px-2 rounded shadow">
            <FaSearch className="text-gray-500" />
            <input
              className="p-2 outline-none w-48"
              placeholder="Search customer..."
              value={query}
              onChange={e => { setQuery(e.target.value); setPage(1); }}
            />
          </div>

          <button
            onClick={openCreate}
            className="bg-green-600 text-white px-4 py-2 rounded shadow flex items-center gap-2"
          >
            <FaPlus /> Add Payment
          </button>
        </div>
      </div>

      {/* TABLE */}
      {view === "table" && (
        <div className="overflow-x-auto bg-white rounded-lg shadow">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-200">
              <tr>
                <th className="p-3 text-left">Date</th>
                <th className="p-3 text-left">Customer</th>
                <th className="p-3 text-left">Payable</th>
                <th className="p-3 text-left">Paid</th>
                <th className="p-3 text-left">Balance</th>
                <th className="p-3 text-left">Remarks</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => {
                const c = customers.find(x => x.id === p.customerId);
                return (
                  <tr key={p.id} className="border-b">
                    <td className="p-3">{p.paymentDate}</td>
                    <td className="p-3">{c?.name}</td>
                    <td className="p-3">{p.payableSnapshot}</td>
                    <td className="p-3">{p.amount}</td>
                    <td className="p-3">{p.balanceSnapshot}</td>
                    <td className="p-3">{p.remarks}</td>
                    <td className="p-3 flex justify-center gap-2">
                      <button onClick={() => openEdit(p)} className="p-2 bg-blue-500 text-white rounded">
                        <FaEdit />
                      </button>
                      <button onClick={() => handleDelete(p.id!)} className="p-2 bg-red-500 text-white rounded">
                        <FaTrash />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* PAGINATION */}
      <div className="mt-4 flex justify-center gap-2">
        <button disabled={page === 1} onClick={() => setPage(page - 1)}>Prev</button>
        <span>Page {page} / {totalPages}</span>
        <button disabled={page === totalPages} onClick={() => setPage(page + 1)}>Next</button>
      </div>

      {/* MODAL */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4">
          <div className="bg-white p-6 rounded-xl w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingPayment ? "Edit Payment" : "Add Payment"}
            </h2>

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
              <option value={0}>Select Customer</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            <label className="text-sm text-gray-600">Total Payable</label>
            <input className="w-full p-2 border rounded mb-2" disabled value={form.payableSnapshot} />

            <label className="text-sm text-gray-600">Amount Paid</label>
            <input
              type="number"
              className="w-full p-2 border rounded mb-2"
              value={form.amount}
              onChange={e => setForm({ ...form, amount: Number(e.target.value) })}
            />

            <label className="text-sm text-gray-600">Payment Date</label>
            <input
              type="date"
              className="w-full p-2 border rounded mb-2"
              value={form.paymentDate}
              onChange={e => setForm({ ...form, paymentDate: e.target.value })}
            />

            <textarea
              className="w-full p-2 border rounded mb-2"
              placeholder="Remarks"
              value={form.remarks}
              onChange={e => setForm({ ...form, remarks: e.target.value })}
            />

            <div className="flex justify-end gap-2">
              <button onClick={closeForm}>Cancel</button>
              <button onClick={handleSave} className="bg-indigo-600 text-white px-4 py-2 rounded">
                Save
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
