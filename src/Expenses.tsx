import React, { useEffect, useState } from "react";
import { FaEdit, FaTrash, FaPlus } from "react-icons/fa";

import { 
  Expense, 
  getAllExpenses, 
  addExpense, 
  updateExpense, 
  deleteExpense, 
  searchExpenses 
} from "./db";

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const [formData, setFormData] = useState<{
    date: string;
    amount: number;
    description: string;
  }>({
    date: "",
    amount: 0,
    description: "",
  });

  const loadExpenses = async () => {
    const data = searchQuery
      ? await searchExpenses(searchQuery)
      : await getAllExpenses();

    setExpenses(data);
  };

  useEffect(() => {
    loadExpenses();
  }, [searchQuery]);

  const resetForm = () => {
    setFormData({
      date: "",
      amount: 0,
      description: "",
    });
    setEditingExpense(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (exp: Expense) => {
    setEditingExpense(exp);
    setFormData({
      date: exp.date,
      amount: exp.amount,
      description: exp.description || "", // <-- fix for string | undefined
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.date || isNaN(formData.amount)) return;

    if (editingExpense) {
      await updateExpense({ ...editingExpense, ...formData });
    } else {
      await addExpense(formData);
    }

    resetForm();
    setShowModal(false);
    loadExpenses();
  };

  const handleDelete = async (id?: number) => {
    if (!id) return;

    if (window.confirm("Are you sure you want to delete this expense?")) {
      await deleteExpense(id);
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
              <th className="px-4 py-2 border">Amount</th>
              <th className="px-4 py-2 border">Description</th>
              <th className="px-4 py-2 border">Actions</th>
            </tr>
          </thead>

          <tbody>
            {expenses.map((exp, idx) => (
              <tr key={exp.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 border">{idx + 1}</td>
                <td className="px-4 py-2 border">{exp.date}</td>
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
                <td colSpan={5} className="px-4 py-2 text-center text-gray-500">
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
                <label className="block mb-1 font-medium">Description</label>
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
