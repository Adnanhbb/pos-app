// src/brands.tsx
import React, { useEffect, useState } from "react";
import { FaPlus, FaEdit, FaTrash } from "react-icons/fa";
// ✅ Add
import { indexedDbBrandRepository as brandsRepo } from "./repositories/brandsRepository";
import {Brand} from "./db";

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[]>([]);
  const [isFormOpen, setFormOpen] = useState(false);
  const [editingBrand, setEditingBrand] = useState<Brand | null>(null);
  const [newBrand, setNewBrand] = useState("");

  /* ===========================
        LOAD BRANDS
     =========================== */
  async function loadBrands() {
    const data = await brandsRepo.getAll();
    setBrands(data);
  }

  useEffect(() => {
    loadBrands();
  }, []);

  /* ===========================
        OPEN CREATE FORM
     =========================== */
  function openCreate() {
    setEditingBrand(null);
    setNewBrand("");
    setFormOpen(true);
  }

  /* ===========================
        OPEN EDIT FORM
     =========================== */
  function openEdit(brand: Brand) {
    setEditingBrand(brand);
    setNewBrand(brand.name);
    setFormOpen(true);
  }

  /* ===========================
        CLOSE FORM
     =========================== */
  function closeForm() {
    setEditingBrand(null);
    setNewBrand("");
    setFormOpen(false);
  }

  /* ===========================
        SAVE BRAND
     =========================== */
  async function handleSave() {
    if (!newBrand.trim()) {
      alert("Brand Name is required");
      return;
    }

    if (editingBrand) {
      // UPDATE
      await brandsRepo.update({
        ...editingBrand,
        name: newBrand.trim(),
      });
    } else {
      // CREATE
      await brandsRepo.add({
        name: newBrand.trim(),
        itemCount: 0,
      });
    }

    await loadBrands();
    closeForm();
  }

  /* ===========================
        DELETE BRAND
     =========================== */
  async function handleDelete(id?: number) {
    if (!id) return;

    if (!confirm("Delete this brand?")) return;

    await brandsRepo.delete(id);
    await loadBrands();
  }

  return (
    <div className="p-2 sm:p-4 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <h1 className="text-lg font-semibold">Brands</h1>

        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded shadow"
        >
          <FaPlus /> Create New
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-200 text-gray-700">
            <tr>
              <th className="p-3 text-left">Brand Name</th>
              <th className="p-3 text-left">No. of Items</th>
              <th className="p-3 text-center">Actions</th>
            </tr>
          </thead>
          <tbody>
            {brands.map((brand) => (
              <tr key={brand.id} className="border-b hover:bg-gray-50">
                <td className="p-3">{brand.name}</td>
                <td className="p-3">{brand.itemCount ?? 0}</td>
                <td className="p-3 text-center flex justify-center gap-2">
                  <button
                    onClick={() => openEdit(brand)}
                    className="p-2 bg-blue-500 text-white rounded"
                  >
                    <FaEdit />
                  </button>
                  <button
                    onClick={() => handleDelete(brand.id)}
                    className="p-2 bg-red-500 text-white rounded"
                  >
                    <FaTrash />
                  </button>
                </td>
              </tr>
            ))}

            {brands.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center p-4 text-gray-500">
                  No brands found
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
              {editingBrand ? "Edit Brand" : "Create Brand"}
            </h2>

            <div>
              <label className="block text-xs font-medium mb-1">
                Brand Name
              </label>
              <input
                type="text"
                value={newBrand}
                onChange={(e) => setNewBrand(e.target.value)}
                className="w-full p-2 border rounded"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
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
