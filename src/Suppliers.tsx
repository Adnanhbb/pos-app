// src/Suppliers.tsx
import React, { useEffect, useState } from "react";
// ✅ Add
import { indexedDbSupplierRepository as suppliersRepo } from "./repositories/indexedDbSupplierRepository";
import {Supplier} from "./db";
import { useLang } from "./i18n/LanguageContext";

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
  FaUndo,
  FaEye
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
    isDeleted: false,
    deletedAt: null
  };

  const [form, setForm] = useState<Omit<Supplier, "id">>(emptyForm);

  const [showDueOnly, setShowDueOnly] = useState(false);

  // summary cards
  const [totalSuppliers, setTotalSuppliers] = useState(0);
  const [totalPayable, setTotalPayable] = useState(0);
  const [totalPaid, setTotalPaid] = useState(0);
  const [totalBalance, setTotalBalance] = useState(0);

  const [deletedSuppliers, setDeletedSuppliers] = useState<Supplier[]>([]);
  const [showDeletedModal, setShowDeletedModal] = useState(false);

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
      isDeleted: c.isDeleted,
      deletedAt: c.deletedAt
    });
    setFormOpen(true);
  }

  function closeForm() {
    setEditingSupplier(null);
    setForm(emptyForm);
    setFormOpen(false);
  }

  async function loadDeletedSuppliers() {
  if (!suppliersRepo.getDeleted) return;
  const deleted = await suppliersRepo.getDeleted();
  setDeletedSuppliers(deleted);
}

const openDeletedModal = async () => {
  await loadDeletedSuppliers();
  setShowDeletedModal(true);
};

const closeDeletedModal = () => setShowDeletedModal(false);

const handleRestore = async (id?: number) => {
  if (!id || !suppliersRepo.restore) return;
  await suppliersRepo.restore(id);
  await loadDeletedSuppliers(); // refresh modal list
  await loadPage(); // refresh main cards/totals
  await loadSummary();
};

const handlePermanentDelete = async (id?: number) => {
  if (!id || !suppliersRepo.permanentDelete) return;
  if (!window.confirm("Permanently delete this supplier?")) return;
  await suppliersRepo.permanentDelete(id);
  await loadDeletedSuppliers();
  await loadPage();
};

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
      isDeleted: false,
      deletedAt: null
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

  const { t, lang, setLang } = useLang();

  const textAlign = lang === "ur" ? "text-right" : "text-left";

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
        <span className="text-sm">{t("showonlyduesuppliers")}</span>
      </div>
    </div>

    {/* ===================== SUMMARY CARDS ===================== */}
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      <div className="bg-white shadow rounded-xl p-4 flex items-center gap-3">
        <FaUsers className="text-indigo-600 text-3xl" />
        <div>
          <div className="text-xs text-gray-500">{t("suppliers")}</div>
          <div className="text-xl font-bold">{totalSuppliers}</div>
        </div>
      </div>
      <div className="bg-white shadow rounded-xl p-4 flex items-center gap-3">
        <FaMoneyBillWave className="text-yellow-600 text-3xl" />
        <div>
          <div className="text-xs text-gray-500">{t("payable")}</div>
          <div className="text-xl font-bold">Rs.{totalPayable.toFixed()}</div>
        </div>
      </div>
      <div className="bg-white shadow rounded-xl p-4 flex items-center gap-3">
        <FaCreditCard className="text-green-600 text-3xl" />
        <div>
          <div className="text-xs text-gray-500">{t("paid")}</div>
          <div className="text-xl font-bold">Rs.{totalPaid.toFixed()}</div>
        </div>
      </div>
      <div className="bg-white shadow rounded-xl p-4 flex items-center gap-3">
        <FaBalanceScale className="text-red-600 text-3xl" />
        <div>
          <div className="text-xs text-gray-500">{t("balance")}</div>
          <div className="text-xl font-bold">Rs.{totalBalance.toFixed()}</div>
        </div>
      </div>
    </div>

    {/* ===================== SEARCH / VIEW / CREATE ===================== */}
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4 gap-3 flex-wrap">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="text-lg font-semibold">{t("suppliers")}</h2>
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

        <button
          onClick={openDeletedModal}
          className="flex items-center gap-2 px-3 py-1 rounded bg-blue-600 hover:bg-blue-400 text-white "
        >
          <FaEye />{t("showDeleted")}
        </button>

      </div>

      <div className="flex gap-2 flex-wrap sm:flex-nowrap w-full sm:w-auto">
        <div className="flex items-center bg-white px-2 rounded shadow flex-1 sm:flex-none min-w-[150px]">
          <FaSearch className="text-gray-500" />
          <input
            className="p-2 outline-none w-full sm:w-48"
            placeholder={t("search")}
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>

        <button
          onClick={openCreate}
          className="bg-green-600 text-white px-4 py-2 rounded shadow flex items-center gap-2 flex-none"
        >
          <FaPlus /> {t("createnew")}
        </button>

      </div>
    </div>

{showDeletedModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div className="absolute inset-0 bg-black opacity-40" onClick={() => setShowDeletedModal(false)} />
    <div className="relative bg-white rounded-lg shadow-lg w-full max-w-lg p-6 z-50">
      <h3 className="text-lg font-semibold mb-4">{t("deletedSuppliers")}</h3>

      {deletedSuppliers.length === 0 ? (
        <div className="text-gray-500 text-center py-6">{t("noDeletedSuppliers")}</div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {deletedSuppliers.map((c) => (
            <div key={c.id} className="flex items-center justify-between border-b p-2">
              <div>
                <div className="font-medium">{c.name}</div>
                <div className="text-xs text-gray-500">{t("deleted")}: {c.deletedAt ? new Date(c.deletedAt).toLocaleString() : "-"}</div>
              </div>
              <div className="flex gap-2">
                <button
                  className="p-2 rounded bg-green-100 hover:bg-green-200"
                  onClick={() => handleRestore(c.id)}
                  title={t("restore")}
                >
                  <FaUndo />
                </button>
                <button
                  className="p-2 rounded bg-red-100 hover:bg-red-200"
                  onClick={() => handlePermanentDelete(c.id)}
                  title={t("deletePermanently")}
                >
                  <FaTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button className="px-4 py-2 border rounded" onClick={() => setShowDeletedModal(false)}>
          {t("close")}
        </button>
      </div>
    </div>
  </div>
)}

    {/* ===================== TABLE VIEW ===================== */}
 
{view === "table" && (
  <div className="overflow-x-auto bg-white rounded-lg shadow">
    <table className="min-w-full text-sm">
      <thead className="bg-blue-100 text-gray-700">
       <tr>
        <th className={`p-3 ${textAlign}`}>{t("name")}</th>
        <th className={`p-3 hidden sm:table-cell ${textAlign}`}>{t("mobile")}</th>
        <th className={`p-3 hidden md:table-cell ${textAlign}`}>{t("cnic")}</th>
        <th className={`p-3 hidden md:table-cell ${textAlign}`}>{t("address")}</th>
        <th className={`p-3 hidden lg:table-cell ${textAlign}`}>{t("invoices")}</th>
        <th className={`p-3 hidden lg:table-cell ${textAlign}`}>{t("payable")}</th>
        <th className={`p-3 hidden lg:table-cell ${textAlign}`}>{t("paid")}</th>
        <th className={`p-3 hidden lg:table-cell ${textAlign}`}>{t("balance")}</th>
        <th className="p-3 text-center">{t("actions")}</th>
      </tr>
      </thead>
      <tbody>
        {suppliers.length === 0 ? (
          <tr>
            <td colSpan={9} className="text-center p-4 text-gray-500">
              {t("nosuppliersfound")}
            </td>
          </tr>
        ) : (
          suppliers.map((c) => (
            <tr key={c.id} className="border-b hover:bg-gray-50">
              <td className="p-3">{c.name}</td>
              <td className="p-3 hidden sm:table-cell">{c.mobile}</td>
              <td className="p-3 hidden md:table-cell">{c.cnic}</td>
              <td className="p-3 hidden md:table-cell">{c.address}</td>
              <td className="p-3 hidden lg:table-cell">{c.invoices}</td>
              <td className="p-3 hidden lg:table-cell">{c.payable}</td>
              <td className="p-3 hidden lg:table-cell">{c.paid}</td>
              <td className="p-3 hidden lg:table-cell">{c.balance}</td>
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
          ))
        )}
      </tbody>
    </table>
  </div>
)}

    {/* ===================== CARDS VIEW ===================== */}
    {view === "cards" && (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {suppliers.length === 0 && <div className="text-gray-500 col-span-full">{t("nosuppliersfound")}</div>}
        {suppliers.map((c) => (
          <div
            key={c.id}
            className="w-full bg-white rounded-xl shadow border p-4 flex flex-col justify-between break-words"
          >
            <div className="mb-3">
              <h3 className="font-bold text-lg truncate">{c.name}</h3>
              <p className="text-gray-600 text-sm mt-1 truncate">{t("mobile")}: {c.mobile}</p>
              <p className="text-gray-600 text-sm mt-1 truncate">{t("cnic")}: {c.cnic}</p>
              <p className="text-gray-600 text-sm mt-1 truncate">{t("address")}: {c.address}</p>
              <p className="text-gray-600 text-sm mt-1 truncate">{t("invoices")}: {c.invoices}</p>
              <p className="text-gray-600 text-sm mt-1 truncate">{t("payable")}: {c.payable}</p>
              <p className="text-gray-600 text-sm mt-1 truncate">{t("paid")}: {c.paid}</p>
              <p className="text-gray-600 text-sm mt-1 truncate">{t("balance")}: {c.balance}</p>
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
        {t("prev")}
      </button>
      <span className="px-3 py-1 bg-gray-200 rounded">
        {t("page")} {page} / {totalPages}
      </span>
      <button
        disabled={page === totalPages}
        onClick={() => setPage(page + 1)}
        className={`px-3 py-1 rounded ${page === totalPages ? "bg-gray-300" : "bg-indigo-500 text-white"}`}
      >
        {t("next")}
      </button>
    </div>

    {/* ===================== CREATE / EDIT MODAL ===================== */}
    {isFormOpen && (
      <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4">
        <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md">
          <h2 className="text-xl font-bold mb-4">
            {editingSupplier ? t("editsupplier") : t("createsupplier")}
          </h2>

          <div className="space-y-3">
            <input
              className="w-full p-2 border rounded"
              placeholder={t("suppliername")}
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
            <input
              className="w-full p-2 border rounded"
              placeholder={t("mobile")}
              value={form.mobile}
              onChange={(e) => setForm({ ...form, mobile: e.target.value })}
            />
            <input
              className="w-full p-2 border rounded"
              placeholder={t("cnic")}
              value={form.cnic}
              onChange={(e) => setForm({ ...form, cnic: e.target.value })}
            />
            <input
              className="w-full p-2 border rounded"
              placeholder={t("address")}
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
            />
            <label className="text-sm text-gray-600">{t("previousdues")}</label>
            <input
              className="w-full p-2 border rounded"
              type="text"
              inputMode="decimal"
              value={form.payable}
              onChange={(e) => setForm({ ...form, payable: Number(e.target.value) })}
            />
          </div>

          <div className="flex justify-end gap-2 mt-4 flex-wrap">
            <button onClick={closeForm} className="px-4 py-2 bg-gray-300 rounded">
              {t("cancel")}
            </button>
            <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white rounded">
              {t("save")}
            </button>
          </div>
        </div>
      </div>
    )}

  </div>
);
}
