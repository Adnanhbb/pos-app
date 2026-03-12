// src/Discounts.tsx
import React, { useEffect, useState } from "react";
import { FaEdit, FaTrash, FaPlus,FaBars,FaTh } from "react-icons/fa";
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
  const [view, setView] = useState<"table" | "card">("table");

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
  <div className="bg-white p-4 rounded-lg shadow-md">
    {/* Header & Actions */}
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
      <h2 className="text-xl font-semibold">Discounts</h2>

      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <input
          type="text"
          placeholder="Search discounts..."
          className="border rounded px-3 py-2 flex-1"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500"
          onClick={openAddModal}
        >
          <FaPlus /> Add New
        </button>
        <button
          className="flex items-center gap-1 border px-3 py-2 rounded hover:bg-gray-100"
          onClick={() => setView(view === "table" ? "card" : "table")}
        >
          {view === "table" ? <FaBars /> : <FaTh />}
          {view === "table" ? "Card View" : "Table View"}
        </button>
      </div>
    </div>

    {/* Table View */}
    {view === "table" && (
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
            {discounts.filter(d =>
              d.name.toLowerCase().includes(searchQuery.toLowerCase())
            ).map((d, idx) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className="px-4 py-2 border">{idx + 1}</td>
                <td className="px-4 py-2 border">{d.name}</td>
                <td className="px-4 py-2 border">
                  {d.type === "amount" ? "Fixed Amount" : "Percentage"}
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
            {discounts.filter(d =>
              d.name.toLowerCase().includes(searchQuery.toLowerCase())
            ).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-2 text-center text-gray-500">
                  No discounts found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    )}

    {/* Card View */}
    {view === "card" && (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {discounts.filter(d =>
          d.name.toLowerCase().includes(searchQuery.toLowerCase())
        ).map((d, idx) => (
          <div key={d.id} className="border rounded p-4 shadow-sm flex flex-col gap-2">
            <div className="font-semibold">{d.name}</div>
            <div>Type: {d.type === "amount" ? "Fixed Amount" : "Percentage"}</div>
            <div>Value: {d.value}</div>
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => openEditModal(d)}
                className="bg-yellow-500 text-white px-2 py-1 rounded hover:bg-yellow-400 flex-1"
              >
                <FaEdit />
              </button>
              <button
                onClick={() => handleDelete(d.id)}
                className="bg-red-500 text-white px-2 py-1 rounded hover:bg-red-400 flex-1"
              >
                <FaTrash />
              </button>
            </div>
          </div>
        ))}
        {discounts.filter(d =>
          d.name.toLowerCase().includes(searchQuery.toLowerCase())
        ).length === 0 && (
          <div className="col-span-full text-center text-gray-500">
            No discounts found.
          </div>
        )}
      </div>
    )}

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
                <option value="amount">Fixed Amount</option>
              </select>
            </div>

            <div>
              <label className="block mb-1 font-medium">Value</label>
              <input
                type="number"
                className="border rounded px-3 py-2 w-full"
                value={formData.value}
                onChange={(e) =>
                  setFormData((p) => ({ ...p, value: parseFloat(e.target.value) }))
                }
                required
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
