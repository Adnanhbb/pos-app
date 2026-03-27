// src/Taxes.tsx
import React, { useEffect, useState } from "react";
import { FaEdit, FaTrash, FaPlus } from "react-icons/fa";
import {
  Tax,
  getAllTaxes,
  addTax,
  updateTax,
  deleteTax,
  searchTaxes,
} from "./db";
import { useLang } from "./i18n/LanguageContext";

export default function Taxes() {
  const [taxes, setTaxes] = useState<Tax[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const [showModal, setShowModal] = useState(false);
  const [editingTax, setEditingTax] = useState<Tax | null>(null);

  const [formData, setFormData] = useState({
    name: "",
    type: "percentage" as "percentage" | "amount",
    value: 0,
  });

  const { t, lang, setLang } = useLang();
  
  const loadTaxes = async () => {
    const data = searchQuery
      ? await searchTaxes(searchQuery)
      : await getAllTaxes();
    setTaxes(data);
  };

  useEffect(() => {
    loadTaxes();
  }, [searchQuery]);

  const resetForm = () => {
    setFormData({ name: "", type: "percentage", value: 0 });
    setEditingTax(null);
  };

  const openAddModal = () => {
    resetForm();
    setShowModal(true);
  };

  const openEditModal = (tax: Tax) => {
    setEditingTax(tax);
    setFormData({
      name: tax.name,
      type: tax.type,
      value: tax.value,
    });
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name || isNaN(formData.value)) return;

    if (editingTax) {
      await updateTax({ ...editingTax, ...formData });
    } else {
      await addTax(formData);
    }

    resetForm();
    setShowModal(false);
    loadTaxes();
  };

  const handleDelete = async (id?: number) => {
    if (!id) return;
    if (window.confirm("Are you sure you want to delete this tax?")) {
      await deleteTax(id);
      loadTaxes();
    }
  };

      const textAlign = lang === "ur" ? "text-right" : "text-left";

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg">
      <h2 className="text-xl font-semibold mb-4">{t("taxes")}</h2>

      {/* Search & Add */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <input
          type="text"
          placeholder={t("searchtaxes")}
          className="flex-1 border rounded px-3 py-2"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <button
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-500"
          onClick={openAddModal}
        >
          <FaPlus /> {t("addnew")}
        </button>
      </div>

      {/* Taxes Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border">
          <thead className="bg-gray-100">
          <tr>
            <th className={`px-4 py-2 border ${textAlign}`}>{t("number")}</th>
            <th className={`px-4 py-2 border ${textAlign}`}>{t("name")}</th>
            <th className={`px-4 py-2 border ${textAlign}`}>{t("type")}</th>
            <th className={`px-4 py-2 border ${textAlign}`}>{t("value")}</th>
            <th className="px-4 py-2 border text-center">{t("actions")}</th>
          </tr>
          </thead>
          <tbody>
            {taxes.map((d, idx) => (
              <tr key={d.id} className="hover:bg-gray-50">
                <td className={`px-4 py-2 border ${textAlign}`}>{idx + 1}</td>
                <td className={`px-4 py-2 border ${textAlign}`}>{d.name}</td>
                <td className={`px-4 py-2 border ${textAlign}`}>
                  {d.type === "amount" ? t("amount") : t("percentage")}
                </td>
                <td className={`px-4 py-2 border ${textAlign}`}>{d.value}</td>
                <td className={`px-4 py-2 border flex gap-2 justify-center`}>
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
            {taxes.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-2 text-center text-gray-500">
                  {t("notaxesfound")}
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
              {editingTax ? t("edittax") : t("addtax")}
            </h3>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block mb-1 font-medium">{t("name")}</label>
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
                <label className="block mb-1 font-medium">{t("type")}</label>
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
                  <option value="percentage">{t("percentage")}</option>
                  <option value="amount">{t("amount")}</option>
                </select>
              </div>

              <div>
                <label className="block mb-1 font-medium">{t("value")}</label>
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

              <div className="flex justify-end gap-3 mt-4">
                <button
                  type="button"
                  className="px-4 py-2 bg-gray-400 text-white rounded hover:bg-gray-500"
                  onClick={() => setShowModal(false)}
                >
                  {t("cancel")}
                </button>

                <button
                  type="submit"
                  className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500"
                >
                  {editingTax ? t("update") : t("save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
