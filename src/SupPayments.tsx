// src/SuppPayment.tsx
import React, { useEffect, useState } from "react";
import { indexedDbSupplierPaymentRepository as supplierPayRepo } from "./repositories/indexedDbSupplierPaymentRepository";
import { indexedDbSupplierRepository as supplierRepo } from "./repositories/indexedDbSupplierRepository";
import { SupplierPayment, Supplier } from "./db";

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
  supplierId: number;
  amount: number;
  paymentDate: string;
  remarks: string;
  payableSnapshot: number;
};

export default function SupPayments() {
  const [payments, setPayments] = useState<SupplierPayment[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [view, setView] = useState<"table" | "cards">("table");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [isFormOpen, setFormOpen] = useState(false);
  const [editingPayment, setEditingPayment] = useState<SupplierPayment | null>(null);

  const emptyForm: PaymentForm = {
    supplierId: 0,
    amount: 0,
    paymentDate: new Date().toISOString().slice(0, 10),
    remarks: "",
    payableSnapshot: 0,
  };

  const [form, setForm] = useState<PaymentForm>(emptyForm);

  useEffect(() => {
    loadSuppliers();
    loadPage();
  }, [page, query]);

  async function loadSuppliers() {
    const all = await supplierRepo.getAll();
    setSuppliers(all);
  }

  async function loadPage() {
    let data = await supplierPayRepo.getAll();

    if (query.trim()) {
      const q = query.toLowerCase();
      data = data.filter((p: SupplierPayment) => {
        const s = suppliers.find((x: Supplier) => x.id === p.supplierId);
        return s?.name.toLowerCase().includes(q);
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

  function openEdit(p: SupplierPayment) {
    setEditingPayment(p);
    setForm({
      supplierId: p.supplierId,
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
  if (!form.supplierId) return alert("Select supplier");
  if (form.amount <= 0) return alert("Enter valid amount");

  const supplier = suppliers.find(s => s.id === form.supplierId);
  if (!supplier) return;

  // Compute current payable
  const alreadyPaid = supplier.paid ?? 0;
  const totalPayable = supplier.payable ?? 0;
  const currentPayable = totalPayable - alreadyPaid;

  if (editingPayment) {
    // Update existing payment
    const updatedPayment: SupplierPayment = {
      id: editingPayment.id!,
      supplierId: form.supplierId,
      amount: form.amount,
      paymentDate: form.paymentDate,
      remarks: form.remarks,
      payableSnapshot: currentPayable,
      balanceSnapshot: currentPayable - form.amount,
      supplierName: supplier.name,
      invoiceNo: editingPayment.invoiceNo || "",
    };
    await supplierPayRepo.update(updatedPayment);
  } else {
    // Add new payment
    const newPayment: Omit<SupplierPayment, "id"> = {
      supplierId: form.supplierId,
      amount: form.amount,
      paymentDate: form.paymentDate,
      remarks: form.remarks,
      payableSnapshot: currentPayable,
      balanceSnapshot: currentPayable - form.amount,
      supplierName: supplier.name,
      invoiceNo: "", // default or generate if needed
    };
    await supplierPayRepo.add(newPayment);
  }

  // Update supplier totals
  await supplierRepo.update({
    ...supplier,
    paid: (supplier.paid ?? 0) + form.amount,
    balance: (supplier.payable ?? 0) - ((supplier.paid ?? 0) + form.amount),
  });

  await loadPage();
  await loadSuppliers();
  closeForm();
}

  async function handleDelete(id: number) {
    if (!confirm("Delete this payment?")) return;
    await supplierPayRepo.delete(id);
    await loadPage();
    await loadSuppliers();
  }

  return (
    <div className="p-2 sm:p-4 lg:p-8">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Supplier Payments</h2>
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
              placeholder="Search supplier..."
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
                <th className="p-3 text-left">Supplier</th>
                <th className="p-3 text-left">Payable</th>
                <th className="p-3 text-left">Paid</th>
                <th className="p-3 text-left">Balance</th>
                <th className="p-3 text-left">Remarks</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {payments.map(p => {
                const s = suppliers.find(x => x.id === p.supplierId);
                return (
                  <tr key={p.id} className="border-b">
                    <td className="p-3">{p.paymentDate}</td>
                    <td className="p-3">{s?.name}</td>
                    <td className="p-3">{p.payableSnapshot}</td>
                    <td className="p-3">{p.amount}</td>
                    <td className="p-3">{p.balanceSnapshot}</td>
                    <td className="p-3">{p.remarks}</td>
                    <td className="p-3 flex justify-center gap-2">
                      {/* <button onClick={() => openEdit(p)} className="p-2 bg-blue-500 text-white rounded">
                        <FaEdit />
                      </button> */}
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
              value={form.supplierId}
              onChange={e => {
                const id = Number(e.target.value);
                const s = suppliers.find(x => x.id === id);
                if (!s) return;
                const alreadyPaid = s.paid ?? 0;
                const totalPayable = s.payable ?? 0;
                const currentPayable = totalPayable - alreadyPaid; // ✅ current payable
                setForm({
                  ...form,
                  supplierId: id,
                  payableSnapshot: currentPayable,
                });
              }}
>

              <option value={0}>Select Supplier</option>
              {suppliers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
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
