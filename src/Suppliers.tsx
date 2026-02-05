// src/Suppliers.tsx
import React, { useEffect, useState } from "react";
// ✅ Add
import { indexedDbSupplierRepository as suppliersRepo } from "./repositories/indexedDbSupplierRepository";
import {Supplier} from "./db";

import {
  FaPlus,
  FaEdit,
  FaTrash,
  FaSearch,
  FaTh,
  FaList,
  FaUsers,
  FaMoneyBillWave,
  FaCreditCard,
  FaBalanceScale,
} from "react-icons/fa";

const PAGE_SIZE = 8;

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [view, setView] = useState<"table" | "cards">("table");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [isFormOpen, setFormOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);

  const emptyForm: Omit<Supplier, "id"> = {
    name: "",
    mobile: "",
    cnic: "",
    address: "",
    invoices: 0,
    payable: 0,
    paid: 0,
    balance: 0,
  };

  const [form, setForm] = useState<Omit<Supplier, "id">>(emptyForm);

  const [showDueOnly, setShowDueOnly] = useState(false);

  // summary cards
  const [totalSuppliers, setTotalSuppliers] = useState(0);
  const [totalPayable, setTotalPayable] = useState(0);
  const [totalPaid, setTotalPaid] = useState(0);
  const [totalBalance, setTotalBalance] = useState(0);

  useEffect(() => {
    loadPage();
    loadSummary();
  }, [page, query, showDueOnly]);

  /** Load paged & filtered suppliers */
  async function loadPage() {
  let allData: Supplier[] = await suppliersRepo.getAll();

    // Search filter
    if (query?.trim()) {
      const q = query.trim().toLowerCase();
      allData = allData.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.mobile.toLowerCase().includes(q) ||
          c.address?.toLowerCase().includes(q)
      );
    }

    // Due Only filter
    if (showDueOnly) {
      allData = allData.filter(
        (c) => (c.balance ?? ((c.payable ?? 0) - (c.paid ?? 0))) > 0
      );
    }

    const totalCount = allData.length;

    // Paging
    const start = (page - 1) * PAGE_SIZE;
    const pageData = allData.slice(start, start + PAGE_SIZE);

    setSuppliers(pageData);
    setTotal(totalCount);
  }

  /** Load summary totals (based on showDueOnly toggle) */
  async function loadSummary() {
  let all: Supplier[] = await suppliersRepo.getAll();

    if (showDueOnly) {
      all = all.filter((c) => (c.balance ?? ((c.payable ?? 0) - (c.paid ?? 0))) > 0);
    }

    setTotalSuppliers(all.length);
    setTotalPayable(all.reduce((s, c) => s + (c.payable ?? 0), 0));
    setTotalPaid(all.reduce((s, c) => s + (c.paid ?? 0), 0));
    setTotalBalance(all.reduce((s, c) => s + (c.balance ?? 0), 0));
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  function openCreate() {
    setEditingSupplier(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(c: Supplier) {
    setEditingSupplier(c);
    setForm({
      name: c.name,
      mobile: c.mobile,
      cnic: c.cnic ?? "",
      address: c.address ?? "",
      invoices: c.invoices ?? 0,
      payable: c.payable ?? 0,
      paid: c.paid ?? 0,
      balance: c.balance ?? 0,
    });
    setFormOpen(true);
  }

  function closeForm() {
    setEditingSupplier(null);
    setForm(emptyForm);
    setFormOpen(false);
  }

async function handleSave() {
  if (!form.name?.trim()) return alert("Enter supplier name");
  if (!form.mobile?.trim()) return alert("Enter mobile number");

  // Ensure payable is a number
  const payableNum = Number(form.payable) || 0;

  // Fetch all suppliers to check for duplicates
 const allSuppliers = await suppliersRepo.getAll();

  const nameExists = allSuppliers.some(
    (s: Supplier) =>
      s.name.trim().toLowerCase() === form.name.trim().toLowerCase() &&
      (!editingSupplier || s.id !== editingSupplier.id)
  );

  if (nameExists) {
    return alert(`A supplier with the name "${form.name}" already exists.`);
  }

  if (editingSupplier) {
    // Updating existing supplier
    const updatedSupplier = {
      ...editingSupplier,
      name: form.name,
      mobile: form.mobile,
      cnic: form.cnic,
      address: form.address,
      payable: payableNum,
      // Recalculate balance if needed
      balance: payableNum - ((editingSupplier.paid ?? 0)),
    };
    await suppliersRepo.update(updatedSupplier);
  } else {
    // Adding new supplier
    const newSupplier = {
      name: form.name,
      mobile: form.mobile,
      cnic: form.cnic,
      address: form.address,
      payable: payableNum,
      paid: 0,
      balance: payableNum, // initial balance = payable
    };
    await suppliersRepo.create(newSupplier);
  }

  await loadPage(); // reload supplier table
  closeForm();
}

  async function handleDelete(id?: number) {
    if (!id) return;
    if (!confirm("Delete this supplier?")) return;

    await suppliersRepo.remove(id);

    const newTotal = Math.max(0, total - 1);
    const newPages = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
    if (page > newPages) setPage(newPages);

    await loadPage();
    await loadSummary();
  }

  function handleSearch(q: string) {
    setQuery(q);
    setPage(1);
  }

  return (
    <div className="p-2 sm:p-4 lg:p-8">

      {/* ===================== SHOW DUE ONLY TOGGLE ===================== */}
      <div className="flex flex-col sm:flex-row gap-4 mb-4 items-stretch">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={showDueOnly}
            onChange={(e) => setShowDueOnly(e.target.checked)}
          />
          <span className="text-sm">Show Only Due Suppliers</span>
        </div>
      </div>

      {/* ===================== SUMMARY CARDS ===================== */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className="bg-white shadow rounded-xl p-4 flex items-center gap-3">
          <FaUsers className="text-indigo-600 text-3xl" />
          <div>
            <div className="text-xs text-gray-500">SUPPLIERS</div>
            <div className="text-xl font-bold">{totalSuppliers}</div>
          </div>
        </div>

        <div className="bg-white shadow rounded-xl p-4 flex items-center gap-3">
          <FaMoneyBillWave className="text-yellow-600 text-3xl" />
          <div>
            <div className="text-xs text-gray-500">PAYABLE</div>
            <div className="text-xl font-bold">{totalPayable}</div>
          </div>
        </div>

        <div className="bg-white shadow rounded-xl p-4 flex items-center gap-3">
          <FaCreditCard className="text-green-600 text-3xl" />
          <div>
            <div className="text-xs text-gray-500">PAID</div>
            <div className="text-xl font-bold">{totalPaid}</div>
          </div>
        </div>

        <div className="bg-white shadow rounded-xl p-4 flex items-center gap-3">
          <FaBalanceScale className="text-red-600 text-3xl" />
          <div>
            <div className="text-xs text-gray-500">BALANCE</div>
            <div className="text-xl font-bold">{totalBalance}</div>
          </div>
        </div>
      </div>

      {/* ===================== SEARCH / VIEW / CREATE ===================== */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">Suppliers</h2>
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

        <div className="flex gap-2 flex-wrap sm:flex-nowrap">
          <div className="flex items-center bg-white px-2 rounded shadow flex-1 sm:flex-none">
            <FaSearch className="text-gray-500" />
            <input
              className="p-2 outline-none w-full sm:w-48"
              placeholder="Search..."
              value={query}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>

          <button
            onClick={openCreate}
            className="bg-green-600 text-white px-4 py-2 rounded shadow flex items-center gap-2"
          >
            <FaPlus /> Create New
          </button>
        </div>
      </div>

      {/* ===================== TABLE VIEW ===================== */}
      {view === "table" && (
        <div className="overflow-x-auto bg-white rounded-lg shadow">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-200 text-gray-700">
              <tr>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Mobile</th>
                <th className="p-3 text-left">CNIC</th>
                <th className="p-3 text-left">Address</th>
                <th className="p-3 text-left">Invoices</th>
                <th className="p-3 text-left">Payable</th>
                <th className="p-3 text-left">Paid</th>
                <th className="p-3 text-left">Balance</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((c) => (
                <tr key={c.id} className="border-b hover:bg-gray-50">
                  <td className="p-3">{c.name}</td>
                  <td className="p-3">{c.mobile}</td>
                  <td className="p-3">{c.cnic}</td>
                  <td className="p-3">{c.address}</td>
                  <td className="p-3">{c.invoices}</td>
                  <td className="p-3">{c.payable}</td>
                  <td className="p-3">{c.paid}</td>
                  <td className="p-3">{c.balance}</td>
                  <td className="p-3 text-center flex justify-center gap-2">
                    <button
                      onClick={() => openEdit(c)}
                      className="p-2 bg-blue-500 text-white rounded"
                    >
                      <FaEdit />
                    </button>
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="p-2 bg-red-500 text-white rounded"
                    >
                      <FaTrash />
                    </button>
                  </td>
                </tr>
              ))}
              {suppliers.length === 0 && (
                <tr>
                  <td colSpan={9} className="text-center p-4 text-gray-500">
                    No suppliers found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ===================== CARDS VIEW (MOBILE-FRIENDLY) ===================== */}
      {view === "cards" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {suppliers.map((c) => (
            <div
              key={c.id}
              className="w-full bg-white rounded-xl shadow border p-4 flex flex-col justify-between break-words"
            >
              <div className="mb-3">
                <h3 className="font-bold text-lg truncate">{c.name}</h3>
                <p className="text-gray-600 text-sm mt-1 truncate">Mobile: {c.mobile}</p>
                <p className="text-gray-600 text-sm mt-1 truncate">CNIC: {c.cnic}</p>
                <p className="text-gray-600 text-sm mt-1 truncate">Address: {c.address}</p>
                <p className="text-gray-600 text-sm mt-1 truncate">Invoices: {c.invoices}</p>
                <p className="text-gray-600 text-sm mt-1 truncate">Payable: {c.payable}</p>
                <p className="text-gray-600 text-sm mt-1 truncate">Paid: {c.paid}</p>
                <p className="text-gray-600 text-sm mt-1 truncate">Balance: {c.balance}</p>
              </div>

              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => openEdit(c)}
                  className="flex-1 bg-blue-500 text-white p-2 rounded text-sm flex items-center justify-center"
                >
                  <FaEdit />
                </button>
                <button
                  onClick={() => handleDelete(c.id)}
                  className="flex-1 bg-red-500 text-white p-2 rounded text-sm flex items-center justify-center"
                >
                  <FaTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ===================== PAGINATION ===================== */}
      <div className="mt-4 flex justify-center gap-2 flex-wrap">
        <button
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
          className={`px-3 py-1 rounded ${page === 1 ? "bg-gray-300" : "bg-indigo-500 text-white"}`}
        >
          Prev
        </button>
        <span className="px-3 py-1 bg-gray-200 rounded">
          Page {page} / {totalPages}
        </span>
        <button
          disabled={page === totalPages}
          onClick={() => setPage(page + 1)}
          className={`px-3 py-1 rounded ${page === totalPages ? "bg-gray-300" : "bg-indigo-500 text-white"}`}
        >
          Next
        </button>
      </div>

      {/* ===================== CREATE / EDIT MODAL ===================== */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4">
          <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingSupplier ? "Edit Supplier" : "Create Supplier"}
            </h2>

            <div className="space-y-3">
              <input
                className="w-full p-2 border rounded"
                placeholder="Supplier Name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
              <input
                className="w-full p-2 border rounded"
                placeholder="Mobile"
                value={form.mobile}
                onChange={(e) => setForm({ ...form, mobile: e.target.value })}
              />
              <input
                className="w-full p-2 border rounded"
                placeholder="CNIC"
                value={form.cnic}
                onChange={(e) => setForm({ ...form, cnic: e.target.value })}
              />
              <input
                className="w-full p-2 border rounded"
                placeholder="Address"
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
              />
              
              <label className="text-sm text-gray-600">Previous Dues</label>
              <input
                className="w-full p-2 border rounded"
                type="text"
                inputMode="decimal"
                value={form.payable}
                onChange={(e) => setForm({ ...form, payable: Number(e.target.value) })}
              />
              {/* Hidden fields: Invoices, Paid, Balance remain stored */}
            </div>

            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={closeForm}
                className="px-4 py-2 bg-gray-300 rounded"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                className="px-4 py-2 bg-indigo-600 text-white rounded"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
