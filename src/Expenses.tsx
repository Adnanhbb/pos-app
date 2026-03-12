import React, { useEffect, useState } from "react";
import { FaEdit, FaTrash, FaPlus } from "react-icons/fa";

import { expenseRepository, Expense } from "./repositories/expenseRepository";

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState("");

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
  }>({
    date: "",
    category:"",
    amount: 0,
    description: "",
  });

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

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg">
      <h2 className="text-xl font-semibold mb-4">Expenses</h2>

      {/* Search + Add New */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Search expenses..."
          className="flex-1 border rounded px-3 py-2"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />

        <button
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500"
          onClick={openAddModal}
        >
          <FaPlus /> Add New
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 border">#</th>
              <th className="px-4 py-2 border">Date</th>
              <th className="px-4 py-2 border">Category</th>
              <th className="px-4 py-2 border">Amount</th>
              <th className="px-4 py-2 border">Remarks</th>
              <th className="px-4 py-2 border">Actions</th>
            </tr>
          </thead>

          <tbody>
            {expenses.map((exp, idx) => (
              <tr key={exp.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 border">{idx + 1}</td>
                <td className="px-4 py-2 border">{new Date(exp.date).toLocaleDateString()}</td>
                <td className="px-4 py-2 border">{exp.category}</td>
                <td className="px-4 py-2 border">{exp.amount}</td>
                <td className="px-4 py-2 border">{exp.description || ""}</td>
                <td className="px-4 py-2 border flex gap-2">
                  <button
                    className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-400"
                    onClick={() => openEditModal(exp)}
                  >
                    <FaEdit />
                  </button>

                  <button
                    className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-400"
                    onClick={() => handleDelete(exp.id)}
                  >
                    <FaTrash />
                  </button>
                </td>
              </tr>
            ))}

            {expenses.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-2 text-center text-gray-500">
                  No expenses found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md shadow-xl">
            <h3 className="text-lg font-semibold mb-4">
              {editingExpense ? "Edit Expense" : "Add Expense"}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              
              <div>
                <label className="block mb-1 font-medium">Date</label>
                <input
                  type="date"
                  className="border rounded px-3 py-2 w-full"
                  value={formData.date}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, date: e.target.value }))
                  }
                  required
                />
              </div>

                <div>
                  <label className="block mb-1 font-medium">Category</label>

                  <div className="flex gap-2">

                    <select
                      className="border rounded px-3 py-2 w-full"
                      value={formData.category}
                      onChange={(e) =>
                        setFormData(p => ({ ...p, category: e.target.value }))
                      }
                      required
                    >
                      <option value="">Select category</option>

                      {categories.map((c, i) => (
                        <option key={i} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>

                    {/* ADD CATEGORY BUTTON */}
                    <button
                type="button"
                title="Add Category"
                className="bg-blue-600 text-white px-3 rounded hover:bg-blue-500"
                onClick={async () => {
                  const name = prompt("Enter new category");
                  if (!name?.trim()) return;

                  // Add to DB
                  await expenseRepository.addCategory(name.trim());

                  // Reload categories from DB immediately
                  await loadCategories();

                  // Set the new category as selected in the form
                  setFormData(p => ({ ...p, category: name.trim() }));
                }}
              >
                <FaPlus />
            </button>

                  </div>
                </div>
              <div>
                <label className="block mb-1 font-medium">Amount</label>
                <input
                  type="number"
                  className="border rounded px-3 py-2 w-full"
                  value={formData.amount}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      amount: parseFloat(e.target.value),
                    }))
                  }
                  required
                />
              </div>

              <div>
                <label className="block mb-1 font-medium">Remarks</label>
                <textarea
                  className="border rounded px-3 py-2 w-full"
                  value={formData.description}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, description: e.target.value }))
                  }
                />
              </div>

              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
                  onClick={() => setShowModal(false)}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500"
                >
                  {editingExpense ? "Update" : "Save"}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}
    </div>
  );
}
