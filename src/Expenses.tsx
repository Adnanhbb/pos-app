import React, { useEffect, useState } from "react";
import { FaEdit, FaTrash, FaPlus, FaUndo, FaEye } from "react-icons/fa";

import { expenseRepository, Expense } from "./repositories/expenseRepository";
import { useLang } from "./i18n/LanguageContext";

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");

  const [showDeletedModal, setShowDeletedModal] = useState(false);
  const [deletedExpenses, setDeletedExpenses] = useState<Expense[]>([]);

  const { t, lang, setLang } = useLang();
  
  const loadCategories = async () => {
  try {
    const data = await expenseRepository.getCategories();
    setCategories(data);
  } catch (err) {
    console.error("Failed to load expense categories:", err);
  }
};

  const [formData, setFormData] = useState<{
    date: string;
    category: string;
    amount: number;
    description: string;
    isDeleted: boolean;
    deletedAt: number | null
  }>({
    date: "",
    category:"",
    amount: 0,
    description: "",
    isDeleted: false,
    deletedAt: null
  });

  const loadDeletedExpenses = async () => {
  const data = await expenseRepository.getDeleted();
  setDeletedExpenses(data);
};

const openDeletedModal = async () => {
  await loadDeletedExpenses();
  setShowDeletedModal(true);
};

const handleRestore = async (id?: number) => {
  if (!id) return;

  await expenseRepository.restore(id);
  await loadDeletedExpenses();
  await loadExpenses(); // your main loader
};

const handlePermanentDelete = async (id?: number) => {
  if (!id) return;

  if (!confirm(t("deletePermanentlyConfirm"))) return;

  await expenseRepository.permanentDelete(id);
  await loadDeletedExpenses();
};

  const loadExpenses = async () => {
    const data = searchQuery
      ? await expenseRepository.search(searchQuery)
      : await expenseRepository.getAll();

    setExpenses(data);
  };

  useEffect(() => {
  loadExpenses();
  loadCategories();
}, [searchQuery]);

  const resetForm = () => {
    setFormData({
      date: "",
      category:"",
      amount: 0,
      description: "",
      isDeleted: false,
      deletedAt: null
    });
    setEditingExpense(null);
  };

   const openAddModal = () => {
    loadCategories(); // reload categories fresh
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (exp: Expense) => {
    setEditingExpense(exp);
    setFormData({
      date: exp.date,
      category:exp.category,
      amount: exp.amount,
      description: exp.description || "", // <-- fix for string | undefined
      isDeleted: exp.isDeleted,
      deletedAt: exp.deletedAt
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.date || !formData.category || isNaN(formData.amount))
    return;

    if (editingExpense) {
      await expenseRepository.update({ ...editingExpense, ...formData });
    } else {
      await expenseRepository.create(formData);
    }

    resetForm();
    setShowModal(false);
    loadExpenses();
  };

  const handleDelete = async (id?: number) => {
    if (!id) return;

    if (window.confirm("Are you sure you want to delete this expense?")) {
      await expenseRepository.remove(id);
      loadExpenses();
    }
  };

      const textAlign = lang === "ur" ? "text-right" : "text-left";

  return (
  <div className="bg-white p-4 sm:p-6 rounded-lg shadow-lg">

    <h2 className="text-xl font-semibold mb-4">{t("expenses")}</h2>

    {/* Search + Add */}
    <div className="flex flex-col sm:flex-row gap-3 mb-4 flex-wrap">
      <input
        type="text"
        placeholder={t("searchexpenses")}
        className="flex-1 border rounded px-3 py-2 min-w-[150px]"
        value={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
      />

        <button
          onClick={openDeletedModal}
          className="flex items-center gap-2 px-3 py-1 rounded bg-blue-600 hover:bg-blue-400 text-white "
        >
         <FaEye /> {t("showDeleted")}
        </button>

      <button
        className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500 flex-none"
        onClick={openAddModal}
      >
        <FaPlus /> {t("addnew")}
      </button>
    </div>

{showDeletedModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div
      className="absolute inset-0 bg-black opacity-40"
      onClick={() => setShowDeletedModal(false)}
    />

    <div className="relative bg-white rounded-lg shadow-lg w-full max-w-lg p-6 z-50">
      <h3 className="text-lg font-semibold mb-4">
        {t("deletedExpenses")}
      </h3>

      {deletedExpenses.length === 0 ? (
        <div className="text-gray-500 text-center py-6">
          {t("noDeletedExpenses")}
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {deletedExpenses.map(e => (
            <div key={e.id} className="flex justify-between border-b p-2">
              <div>
                <div className="font-medium">{e.category}</div>
                <div className="text-xs text-gray-500">
                  {t("deleted")}:
                  {" "}
                  {e.deletedAt
                    ? new Date(e.deletedAt).toLocaleString()
                    : "-"}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  className="p-2 bg-green-100 rounded"
                  onClick={() => handleRestore(e.id)}
                  title={t("restore")}
                >
                  <FaUndo />
                </button>

                <button
                  className="p-2 bg-red-100 rounded"
                  onClick={() => handlePermanentDelete(e.id)}
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
        <button
          className="px-4 py-2 border rounded"
          onClick={() => setShowDeletedModal(false)}
        >
          {t("close")}
        </button>
      </div>
    </div>
  </div>
)}

    {/* Table */}
    <div className="overflow-x-auto">
      <table className="w-full text-left border">
        <thead className="bg-gray-100">
          <tr>
          <th className={`px-4 py-2 border ${textAlign}`}>#</th>
          <th className={`px-4 py-2 border ${textAlign}`}>{t("date")}</th>
          <th className={`px-4 py-2 border ${textAlign}`}>{t("category")}</th>
          <th className={`px-4 py-2 border hidden sm:table-cell ${textAlign}`}>{t("amount")}</th>
          <th className={`px-4 py-2 border hidden md:table-cell ${textAlign}`}>{t("remarks")}</th>
          <th className="px-4 py-2 border text-center">{t("actions")}</th>
        </tr>
        </thead>

        <tbody>
          {expenses.length === 0 ? (
            <tr>
              <td colSpan={6} className="px-4 py-2 text-center text-gray-500">
                {t("noexpensesfound")}
              </td>
            </tr>
          ) : (
            expenses.map((exp, idx) => (
              <tr key={exp.id} className="hover:bg-gray-50 border-b">
              <td className={`px-2 py-1 sm:px-4 sm:py-2 ${textAlign}`}>{idx + 1}</td>
              <td className={`px-2 py-1 sm:px-4 sm:py-2 ${textAlign}`}>
                {new Date(exp.date).toLocaleDateString()}
              </td>
              <td className={`px-2 py-1 sm:px-4 sm:py-2 ${textAlign}`}>{exp.category}</td>
              <td className={`px-2 py-1 sm:px-4 sm:py-2 hidden sm:table-cell ${textAlign}`}>
                {exp.amount}
              </td>
              <td className={`px-2 py-1 sm:px-4 sm:py-2 hidden md:table-cell ${textAlign}`}>
                {exp.description || ""}
              </td>

              <td className="px-2 py-1 sm:px-4 sm:py-2 flex gap-2 justify-center">
                <button
                  className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-400 flex-1 sm:flex-none"
                  onClick={() => openEditModal(exp)}
                >
                  <FaEdit />
                </button>
                <button
                  className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-400 flex-1 sm:flex-none"
                  onClick={() => handleDelete(exp.id)}
                >
                  <FaTrash />
                </button>
              </td>

              {/* Mobile stacked info */}
              <td className="px-2 py-1 sm:hidden flex flex-col text-xs text-gray-600 mt-1 gap-1">
                <span>{t("amount")}: {exp.amount}</span>
                <span>{t("remarks")}: {exp.description || "-"}</span>
              </td>
            </tr>
            ))
          )}
        </tbody>
      </table>
    </div>

    {/* Modal */}
    {showModal && (
      <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
        <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
          <h3 className="text-lg font-semibold mb-4">
            {editingExpense ? t("editexpense") : t("addexpense")}
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">

            {/* Date */}
            <div>
              <label className="block mb-1 font-medium">{t("date")}</label>
              <input
                type="date"
                className="border rounded px-3 py-2 w-full"
                value={formData.date}
                onChange={(e) => setFormData((p) => ({ ...p, date: e.target.value }))}
                required
              />
            </div>

            {/* Category */}
            <div>
              <label className="block mb-1 font-medium">{t("category")}</label>
              <div className="flex gap-2 flex-wrap">
                <select
                  className="border rounded px-3 py-2 flex-1 min-w-[120px]"
                  value={formData.category}
                  onChange={(e) => setFormData(p => ({ ...p, category: e.target.value }))}
                  required
                >
                  <option value="">{t("selectcategory")}</option>
                  {categories.map((c, i) => (
                    <option key={i} value={c}>{c}</option>
                  ))}
                </select>

                <button
                  type="button"
                  title="Add Category"
                  className="bg-blue-600 text-white px-3 rounded hover:bg-blue-500 flex-none"
                  onClick={async () => {
                    const name = prompt("Enter new category");
                    if (!name?.trim()) return;
                    await expenseRepository.addCategory(name.trim());
                    await loadCategories();
                    setFormData(p => ({ ...p, category: name.trim() }));
                  }}
                >
                  <FaPlus />
                </button>
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="block mb-1 font-medium">{t("amount")}</label>
              <input
                type="number"
                className="border rounded px-3 py-2 w-full"
                value={formData.amount}
                onChange={(e) => setFormData((p) => ({ ...p, amount: parseFloat(e.target.value) }))}
                required
              />
            </div>

            {/* Remarks */}
            <div>
              <label className="block mb-1 font-medium">{t("remarks")}</label>
              <textarea
                className="border rounded px-3 py-2 w-full"
                value={formData.description}
                onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
              />
            </div>

            {/* Buttons */}
            <div className="flex flex-col sm:flex-row justify-end gap-3 mt-4">
              <button
                type="button"
                className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500 flex-1 sm:flex-none"
                onClick={() => setShowModal(false)}
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500 flex-1 sm:flex-none"
              >
                {editingExpense ? t("update") : t("save")}
              </button>
            </div>

          </form>
        </div>
      </div>
    )}

  </div>
);
}
