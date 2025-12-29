// src/Discounts.tsx
import React, { useEffect, useState } from "react";
import { FaEdit, FaTrash, FaPlus } from "react-icons/fa";
import {
  Discount,
  getAllDiscounts,
  addDiscount,
  updateDiscount,
  deleteDiscount,
  searchDiscounts,
} from "./db";

export default function Discounts() {
  const [discounts, setDiscounts] = useState<Discount[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<Discount | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    type: "percentage" as "percentage" | "amount",
    value: 0,
  });

  const loadDiscounts = async () => {
    const data = searchQuery
      ? await searchDiscounts(searchQuery)
      : await getAllDiscounts();
    setDiscounts(data);
  };

  useEffect(() => {
    loadDiscounts();
  }, [searchQuery]);

  const resetForm = () => {
    setFormData({ name: "", type: "percentage", value: 0 });
    setEditingDiscount(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (discount: Discount) => {
    setEditingDiscount(discount);
    setFormData({
      name: discount.name,
      type: discount.type,
      value: discount.value,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || isNaN(formData.value)) return;

    if (editingDiscount) {
      await updateDiscount({ ...editingDiscount, ...formData });
    } else {
      await addDiscount(formData);
    }

    resetForm();
    setShowModal(false);
    loadDiscounts();
  };

  const handleDelete = async (id?: number) => {
    if (!id) return;
    if (window.confirm("Are you sure you want to delete this discount?")) {
      await deleteDiscount(id);
      loadDiscounts();
    }
  };

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg">
      <h2 className="text-xl font-semibold mb-4">Discounts</h2>

      {/* Search & Add */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder="Search discounts..."
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

      {/* Discounts Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border">
          <thead className="bg-gray-100">
            <tr>
              <th className="px-4 py-2 border">#</th>
              <th className="px-4 py-2 border">Name</th>
              <th className="px-4 py-2 border">Type</th>
              <th className="px-4 py-2 border">Value</th>
              <th className="px-4 py-2 border">Actions</th>
            </tr>
          </thead>
          <tbody>
            {discounts.map((d, idx) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 border">{idx + 1}</td>
                <td className="px-4 py-2 border">{d.name}</td>

                {/* Show "Amount" instead of "amount" */}
                <td className="px-4 py-2 border">
                  {d.type === "amount" ? "Amount" : "Percentage"}
                </td>

                <td className="px-4 py-2 border">{d.value}</td>

                <td className="px-4 py-2 border flex gap-2">
                  <button
                    onClick={() => openEditModal(d)}
                    className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-400"
                  >
                    <FaEdit />
                  </button>
                  <button
                    onClick={() => handleDelete(d.id)}
                    className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-400"
                  >
                    <FaTrash />
                  </button>
                </td>
              </tr>
            ))}
            {discounts.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-2 text-center text-gray-500">
                  No discounts found.
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
              {editingDiscount ? "Edit Discount" : "Add Discount"}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block mb-1 font-medium">Name</label>
                <input
                  type="text"
                  className="border rounded px-3 py-2 w-full"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData((p) => ({ ...p, name: e.target.value }))
                  }
                  required
                />
              </div>

              <div>
                <label className="block mb-1 font-medium">Type</label>
                <select
                  className="border rounded px-3 py-2 w-full"
                  value={formData.type}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      type: e.target.value as "percentage" | "amount",
                    }))
                  }
                >
                  <option value="percentage">Percentage</option>
                  <option value="amount">Amount</option>
                </select>
              </div>

              <div>
                <label className="block mb-1 font-medium">Value</label>
                <input
                  type="number"
                  className="border rounded px-3 py-2 w-full"
                  value={formData.value}
                  onChange={(e) =>
                    setFormData((p) => ({
                      ...p,
                      value: parseFloat(e.target.value),
                    }))
                  }
                  required
                />
              </div>

              {/* Modal Buttons */}
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
                  {editingDiscount ? "Update" : "Save"}
                </button>
              </div>

            </form>
          </div>
        </div>
      )}
    </div>
  );
}
