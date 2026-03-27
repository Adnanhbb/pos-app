// src/units.tsx
import React, { useEffect, useState } from "react";
import { FaPlus, FaEdit, FaTrash } from "react-icons/fa";
import { getUnits, addUnit, updateUnit, deleteUnit, Unit } from "./db";
import { useLang } from "./i18n/LanguageContext";

export default function UnitsPage() {
  const [units, setUnits] = useState<Unit[]>([]);
  const [isFormOpen, setFormOpen] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);
  const [newUnit, setNewUnit] = useState("");

  const { t, lang, setLang } = useLang();
  
  async function loadUnits() {
    const data = await getUnits();
    setUnits(data);
  }

  useEffect(() => {
    loadUnits();
  }, []);

  function openCreate() {
    setEditingUnit(null);
    setNewUnit("");
    setFormOpen(true);
  }

  function openEdit(unit: Unit) {
    setEditingUnit(unit);
    setNewUnit(unit.name);
    setFormOpen(true);
  }

  function closeForm() {
    setEditingUnit(null);
    setNewUnit("");
    setFormOpen(false);
  }

  async function handleSave() {
    if (!newUnit.trim()) {
      alert("Unit Name is required");
      return;
    }

    if (editingUnit) {
      await updateUnit({ ...editingUnit, name: newUnit.trim() });
    } else {
      await addUnit({ name: newUnit.trim(), itemCount: 0 });
    }

    await loadUnits();
    closeForm();
  }

  async function handleDelete(id?: number) {
    if (!id) return;
    if (!confirm("Delete this unit?")) return;
    await deleteUnit(id);
    await loadUnits();
  }

      const textAlign = lang === "ur" ? "text-right" : "text-left";

  return (
    <div className="p-2 sm:p-4 lg:p-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <h1 className="text-lg font-semibold">{t("units")}</h1>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded shadow"
        >
          <FaPlus /> {t("createnew")}
        </button>
      </div>

      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-200 text-gray-700">
            <tr>
            <th className={`p-3 ${textAlign}`}>{t("unitname")}</th>
            <th className={`p-3 ${textAlign}`}>{t("numberofitems")}</th>
            <th className="p-3 text-center">{t("actions")}</th>
          </tr>
          </thead>
          <tbody>
            {units.map((unit) => (
              <tr key={unit.id} className="border-b hover:bg-gray-50">
                <td className="p-3">{unit.name}</td>
                <td className="p-3">{unit.itemCount ?? 0}</td>
                <td className="p-3 text-center flex justify-center gap-2">
                  <button onClick={() => openEdit(unit)} className="p-2 bg-blue-500 text-white rounded">
                    <FaEdit />
                  </button>
                  <button onClick={() => handleDelete(unit.id)} className="p-2 bg-red-500 text-white rounded">
                    <FaTrash />
                  </button>
                </td>
              </tr>
            ))}

            {units.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center p-4 text-gray-500">
                  {t("nounitsfound")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {isFormOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-md">
            <h2 className="text-xl font-bold mb-4">{editingUnit ? t("editunit") : t("createunit")}</h2>

            <div>
              <label className="block text-xs font-medium mb-1">{t("unitname")}</label>
              <input
                type="text"
                value={newUnit}
                onChange={(e) => setNewUnit(e.target.value)}
                className="w-full p-2 border rounded"
              />
            </div>

            <div className="mt-4 flex justify-end gap-2">
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
