// src/Categories.tsx
import React, { useEffect, useState } from "react";
import { FaPlus, FaEdit, FaTrash } from "react-icons/fa";
// ✅ Add
import { categoriesRepository } from "./repositories/categoriesRepository";
import { Category } from "db";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [isFormOpen, setFormOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [newCategory, setNewCategory] = useState("");

  // Load categories
  async function loadCategories() {
    const data = await categoriesRepository.getAll();
    setCategories(data);
  }

  useEffect(() => {
    loadCategories();
  }, []);

  // Form handlers
  function openCreate() {
    setEditingCategory(null);
    setNewCategory("");
    setFormOpen(true);
  }

  function openEdit(category: Category) {
    setEditingCategory(category);
    setNewCategory(category.name);
    setFormOpen(true);
  }

  function closeForm() {
    setEditingCategory(null);
    setNewCategory("");
    setFormOpen(false);
  }

  async function handleSave() {
    if (!newCategory.trim()) return alert("Category Name is required");

    if (editingCategory) {
      await categoriesRepository.update({ ...editingCategory, name: newCategory.trim() });
    } else {
      await categoriesRepository.create({ name: newCategory.trim(), itemCount: 0 });
    }
    await loadCategories();
    closeForm();
  }

  async function handleDelete(id?: number) {
    if (!id) return;
    if (!confirm("Delete this category?")) return;
    await categoriesRepository.remove(id);
    await loadCategories();
  }

  return (
    <div className="p-2 sm:p-4 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div className="text-lg font-semibold">Categories</div>
        <button
          onClick={openCreate}
          className="ml-0 sm:ml-2 inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded shadow"
        >
          <FaPlus /> Create New
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-200 text-gray-700">
            <tr>
              <th className="p-3 text-left">Category Name</th>
              <th className="p-3 text-left">No. of Items</th>
              <th className="p-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {categories.map((cat) => (
              <tr key={cat.id} className="border-b hover:bg-gray-50">
                <td className="p-3">{cat.name}</td>
                <td className="p-3">{cat.itemCount ?? 0}</td>
                <td className="p-3 text-center flex justify-center gap-2">
                  <button
                    onClick={() => openEdit(cat)}
                    className="p-2 bg-blue-500 text-white rounded"
                  >
                    <FaEdit />
                  </button>
                  <button
                    onClick={() => handleDelete(cat.id)}
                    className="p-2 bg-red-500 text-white rounded"
                  >
                    <FaTrash />
                  </button>
                </td>
              </tr>
            ))}

            {categories.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center p-4 text-gray-500">
                  No categories found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal Form */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">
              {editingCategory ? "Edit Category" : "Create Category"}
            </h2>
            <div>
              <label className="block text-xs font-medium mb-1">Category Name</label>
              <input
                type="text"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="w-full p-2 border rounded"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={closeForm} className="px-4 py-2 bg-gray-300 rounded">
                Cancel
              </button>
              <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white rounded">
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
