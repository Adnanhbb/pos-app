// src/CylindersQty.tsx
import React, { useEffect, useState } from "react";
import {
  getAllCylinders,
  getCylinderCustomersByCylinder,
  updateCylinder,
  updateCylinderCustomer,
  Cylinder,
  CylinderCustomer,
} from "./db";
import { FaBoxes, FaFill, FaCircle, FaUsers, FaEye, FaUndo } from "react-icons/fa";
import { useLang } from "./i18n/LanguageContext";
import { getAllItems } from "./db";

export default function CylindersQty() {
  const [cylinders, setCylinders] = useState<Cylinder[]>([]);
  const [loading, setLoading] = useState(true);

  // Modals
  const [viewCustomersModal, setViewCustomersModal] = useState(false);
  const [returnCylinderModal, setReturnCylinderModal] = useState(false);
  const [selectedCylinder, setSelectedCylinder] = useState<Cylinder | null>(null);
  const [cylinderCustomers, setCylinderCustomers] = useState<CylinderCustomer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<string>("");
  const [qtyReturned, setQtyReturned] = useState<number>(0);
  const [savingReturn, setSavingReturn] = useState(false);

  const [supplierReturnModal, setSupplierReturnModal] = useState(false);
  const [returnRows, setReturnRows] = useState<any[]>([]);
  const [savingSupplierReturn, setSavingSupplierReturn] = useState(false);

  const { t, lang } = useLang();

  useEffect(() => {
    loadData();
  }, []);

async function loadData() {
  setLoading(true);

  try {
    const data = await getAllCylinders();

    const active = data.filter((c: any) => !c.isDeleted);

    const mapped: Cylinder[] = active.map((c: any) => ({
      id: c.id,
      itemId: c.itemId,
      title: c.title,

      filledCylinders: c.filledCylinders ?? 0,
      emptyCylinders: c.emptyCylinders ?? 0,
      withCustomers: c.withCustomers ?? 0,

      convQty: c.convQty ?? 1,

      qtyInStock:
        (c.filledCylinders ?? 0) +
        (c.emptyCylinders ?? 0) +
        (c.withCustomers ?? 0),

      isDeleted: c.isDeleted ?? false,
      deletedAt: c.deletedAt ?? null,
    }));

    setCylinders(mapped);
  } catch (error) {
    console.error("Error loading cylinders:", error);
  } finally {
    setLoading(false);
  }
}

  // Format quantity display (minUnit to maxUnit)
  function formatQty(
  qty: number,
  convQty: number,
  maxUnit: string,
  minUnit: string
) {
  if (!convQty || convQty <= 1) return `${qty} ${minUnit}`;

  const max = Math.floor(qty / convQty);
  const min = qty % convQty;

  if (max > 0 && min > 0) return `${max} ${maxUnit} ${min} ${minUnit}`;
  if (max > 0) return `${max} ${maxUnit}`;
  return `${min} ${minUnit}`;
}

  // Calculate totals
  const totals = cylinders.reduce(
    (acc, c) => ({
      filled: acc.filled + c.filledCylinders,
      empty: acc.empty + c.emptyCylinders,
      customer: acc.customer + c.withCustomers,
    }),
    { filled: 0, empty: 0, customer: 0 }
  );

  async function handleViewCustomers(cylinder: Cylinder) {
    setSelectedCylinder(cylinder);
    try {
      const data = await getCylinderCustomersByCylinder(cylinder.id!);
      const active = data.filter((cc: CylinderCustomer) => !cc.isDeleted && cc.qtyHeld > 0);
      setCylinderCustomers(active);
    } catch (error) {
      console.error("Error loading customers:", error);
    }
    setViewCustomersModal(true);
  }

  function openSupplierReturnModal() {
  // preload all cylinders with editable qty
  const rows = cylinders
    .filter(c => !c.isDeleted && c.emptyCylinders > 0)
    .map(c => ({
      id: c.id,
      title: c.title,
      available: c.emptyCylinders,
      returnQty: c.emptyCylinders,
    }));

  setReturnRows(rows);
  setSupplierReturnModal(true);
}

function handleReturnQtyChange(index: number, value: number) {
  const updated = [...returnRows];
  updated[index].returnQty = Number(value) || 0;
  setReturnRows(updated);
}

async function handleSupplierReturn() {
  setSavingSupplierReturn(true);

  try {
    for (const row of returnRows) {

      if (!row.returnQty || row.returnQty <= 0) continue;

      const cylinder = cylinders.find(c => c.id === row.id);
      if (!cylinder) continue;

      if (row.returnQty > cylinder.emptyCylinders) {
        alert(`Cannot return more than available for ${cylinder.title}`);
        continue;
      }

      await updateCylinder({
        ...cylinder,
        emptyCylinders: cylinder.emptyCylinders - row.returnQty,
      });
    }

    await loadData();
    setSupplierReturnModal(false);
    alert("Supplier return completed successfully!");

  } catch (error) {
    console.error("Supplier return error:", error);
    alert("Error processing supplier return");
  } finally {
    setSavingSupplierReturn(false);
  }
}
  async function handleReturnCylinder(cylinder: Cylinder) {
    setSelectedCylinder(cylinder);
    setSelectedCustomer("");
    setQtyReturned(0);
    setReturnCylinderModal(true);

    // Load customers with holdings
    try {
      const data = await getCylinderCustomersByCylinder(cylinder.id!);
      const active = data.filter((cc: CylinderCustomer) => !cc.isDeleted && cc.qtyHeld > 0);
      setCylinderCustomers(active);
    } catch (error) {
      console.error("Error loading customers for return:", error);
    }
  }

  async function handleSaveReturn() {
  if (!selectedCylinder || qtyReturned <= 0) {
    alert("Please enter quantity");
    return;
  }

  setSavingReturn(true);

  try {
    /* ==================================================
       🔥 CASE 1: OWN SHOP CYLINDER (NO CUSTOMER)
    ================================================== */
    if (selectedCustomer === "__SHOP__") {

      if (selectedCylinder.filledCylinders < qtyReturned) {
        alert("Not enough filled cylinders in shop");
        setSavingReturn(false);
        return;
      }

      const updatedCylinder: Cylinder = {
        ...selectedCylinder,
        filledCylinders: selectedCylinder.filledCylinders - qtyReturned,
        emptyCylinders: selectedCylinder.emptyCylinders + qtyReturned,
      };

      await updateCylinder(updatedCylinder);

      await loadData();
      setReturnCylinderModal(false);
      alert("Shop cylinder converted to empty successfully!");
      return;
    }

    /* ==================================================
       🔥 CASE 2: CUSTOMER RETURN (EXISTING LOGIC)
    ================================================== */

    if (!selectedCustomer) {
      alert("Please select customer");
      setSavingReturn(false);
      return;
    }

    const allCustomers = await getCylinderCustomersByCylinder(selectedCylinder.id!);

    const customerRecord = allCustomers.find(
      (cc: CylinderCustomer) =>
        cc.customerName === selectedCustomer &&
        !cc.isDeleted
    );

    if (!customerRecord || customerRecord.qtyHeld < qtyReturned) {
      alert("Invalid return quantity");
      setSavingReturn(false);
      return;
    }

    /* ---------------- UPDATE CUSTOMER ---------------- */
    await updateCylinderCustomer({
      ...customerRecord,
      qtyHeld: customerRecord.qtyHeld - qtyReturned,
    });

    /* ---------------- UPDATE CYLINDER ---------------- */
    const updatedCylinder: Cylinder = {
      ...selectedCylinder,
      withCustomers: selectedCylinder.withCustomers - qtyReturned,
      emptyCylinders: selectedCylinder.emptyCylinders + qtyReturned,
    };

    await updateCylinder(updatedCylinder);

    await loadData();
    setReturnCylinderModal(false);
    alert("Cylinder returned successfully!");

  } catch (error) {
    console.error("Error saving return:", error);
    alert("Error saving return");
  } finally {
    setSavingReturn(false);
  }
}

  const textAlign = lang === "ur" ? "text-right" : "text-center";

  if (loading) return <p className="text-center p-4">{t("loading")}</p>;

  return (
    <div className="p-4 sm:p-6">
      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">

    <Card
    title={t("qty_in_stock")}
    value={`${totals.filled + totals.empty + totals.customer}`}
    icon={<FaBoxes size={26} color="#3b82f6" />}
    color="#3b82f6"
  />

  <Card
    title={t("filled_cylinders")}
    value={`${totals.filled}`}
    icon={<FaFill size={26} color="#10b981"/>}
    color="#10b981"
  />

  <Card
    title={t("empty_cylinders")}
    value={`${totals.empty}`}
    icon={<FaCircle size={26} color="#f59e0b"/>}
    color="#f59e0b"
  />

  <Card
    title={t("with_customers")}
    value={`${totals.customer}`}
    icon={<FaUsers size={26} color="#ef4444"/>}
    color="#ef4444"
  />

</div>

<div className="flex justify-end mb-3">
  <button
    onClick={openSupplierReturnModal}
    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
  >
    <FaUndo size={16} />
    Supplier Empty Cylinder Return
  </button>
</div>

      {/* TABLE */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border">
          <thead className="bg-blue-100">
            <tr>
              <th className={`px-2 py-2 sm:px-4 border ${textAlign}`}>{t("cylinder")}</th>
               <th className={`px-2 py-2 sm:px-4 border hidden sm:table-cell ${textAlign}`}>{t("qty_in_stock")}</th>
              <th className={`px-2 py-2 sm:px-4 border hidden md:table-cell ${textAlign}`}>{t("filled_cylinders")}</th>
              <th className={`px-2 py-2 sm:px-4 border hidden lg:table-cell ${textAlign}`}>{t("empty_cylinders")}</th>
              <th className={`px-2 py-2 sm:px-4 border hidden lg:table-cell ${textAlign}`}>{t("with_customers")}</th>
              <th className={`px-2 py-2 sm:px-4 border hidden lg:table-cell ${textAlign}`}>{t("actions")}</th>

            </tr>
          </thead>
          <tbody>
            {cylinders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-3 text-center text-gray-500">
                  No cylinders found
                </td>
              </tr>
            ) : (
              cylinders.map((cylinder) => (
                <tr key={cylinder.id} className="border-b hover:bg-gray-50">

                {/* 🔹 COLUMN 1: CYLINDER NAME */}
                <td className={`px-2 py-2 sm:px-4 font-medium align-top ${textAlign}`}>
                  {cylinder.title}
                </td>

                {/* 🔹 DESKTOP COLUMNS (UNCHANGED) */}
                <td className={`px-2 py-2 sm:px-4 hidden sm:table-cell ${textAlign}`}>
                  {cylinder.filledCylinders + cylinder.emptyCylinders + cylinder.withCustomers}
                </td>

                <td className={`px-2 py-2 sm:px-4 hidden md:table-cell ${textAlign}`}>
                  {cylinder.filledCylinders}
                </td>

                <td className={`px-2 py-2 sm:px-4 hidden lg:table-cell ${textAlign}`}>
                  {cylinder.emptyCylinders}
                </td>

                <td className={`px-2 py-2 sm:px-4 hidden lg:table-cell ${textAlign}`}>
                  {cylinder.withCustomers}
                </td>

                <td className={`px-2 py-2 sm:px-4 hidden lg:table-cell ${textAlign}`}>
                  <button
                    onClick={() => handleViewCustomers(cylinder)}
                    title={t("view_customers")}
                    className="p-2 text-blue-600 hover:bg-blue-100 rounded"
                  >
                    <FaEye size={16} />
                  </button>

                  <button
                    onClick={() => handleReturnCylinder(cylinder)}
                    title={t("return_cylinder")}
                    className="p-2 text-green-600 hover:bg-green-100 rounded"
                  >
                    <FaUndo size={16} />
                  </button>
                </td>

                {/* 🔥 MOBILE STACKED COLUMN */}
                <td className={`px-2 py-2 sm:hidden ${textAlign}`}>
                  <div className="flex flex-col text-xs text-gray-600 gap-1">

                    <span>
                      <strong>{t("qty_in_stock")}:</strong>{" "}
                      {cylinder.filledCylinders + cylinder.emptyCylinders + cylinder.withCustomers}
                    </span>

                    <span>
                      <strong>{t("filled_cylinders")}:</strong>{" "}
                      {cylinder.filledCylinders}
                    </span>

                    <span>
                      <strong>{t("empty_cylinders")}:</strong>{" "}
                      {cylinder.emptyCylinders}
                    </span>

                    <span>
                      <strong>{t("with_customers")}:</strong>{" "}
                      {cylinder.withCustomers}
                    </span>

                    {/* ACTIONS (MOBILE) */}
                    <div className="flex gap-2 mt-1">
                      <button
                        onClick={() => handleViewCustomers(cylinder)}
                        className="p-1 text-blue-600"
                      >
                        <FaEye size={14} />
                      </button>

                      <button
                        onClick={() => handleReturnCylinder(cylinder)}
                        className="p-1 text-green-600"
                      >
                        <FaUndo size={14} />
                      </button>
                    </div>

                  </div>
                </td>
              </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

{supplierReturnModal && (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
    <div className="bg-white rounded-lg p-6 max-w-lg w-full">

      <h3 className="text-lg font-semibold mb-4">
        Supplier Empty Cylinder Return
      </h3>

      <div className="max-h-80 overflow-y-auto space-y-3">
        {returnRows.length === 0 ? (
          <p className="text-gray-500 text-center">
            No empty cylinders available
          </p>
        ) : (
          returnRows.map((row, index) => (
            <div key={row.id} className="flex items-center justify-between gap-2 border p-2 rounded">
              
              <div className="flex-1">
                <p className="font-medium">{row.title}</p>
                <p className="text-sm text-gray-500">
                  Available: {row.available}
                </p>
              </div>

              <input
                type="number"
                min="0"
                max={row.available}
                value={row.returnQty}
                onChange={(e) =>
                  handleReturnQtyChange(index, Number(e.target.value))
                }
                className="w-24 px-2 py-1 border rounded"
              />
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2 mt-4">
        <button
          onClick={() => setSupplierReturnModal(false)}
          className="flex-1 px-4 py-2 bg-gray-300 rounded"
        >
          Cancel
        </button>

        <button
          onClick={handleSupplierReturn}
          disabled={savingSupplierReturn}
          className="flex-1 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          {savingSupplierReturn ? "Processing..." : "Return"}
        </button>
      </div>
    </div>
  </div>
)}

      {/* VIEW CUSTOMERS MODAL */}
      {viewCustomersModal && selectedCylinder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">{t("view_customers")} - {selectedCylinder.title}</h3>
            {cylinderCustomers.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No customers holding this cylinder</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {cylinderCustomers.map((cc) => (
                  <div key={cc.id} className="p-3 bg-gray-50 rounded border">
                    <p className="font-medium">{cc.customerName}</p>
                    <p className="text-sm text-gray-600">
                      {t("qty_held")}: {cc.qtyHeld}
                    </p>                  </div>
                ))}
              </div>
            )}
            <button onClick={() => setViewCustomersModal(false)} className="mt-4 w-full px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400">
              {t("close")}
            </button>
          </div>
        </div>
      )}

      {/* RETURN CYLINDER MODAL */}
      {returnCylinderModal && selectedCylinder && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">{t("return_cylinder")}</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("cylinder")}</label>
              <input type="text" value={selectedCylinder.title} disabled className="w-full px-3 py-2 border border-gray-300 rounded bg-gray-100" />
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("select_customer")}</label>
              <select
              value={selectedCustomer}
              onChange={(e) => setSelectedCustomer(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded"
            >
              <option value="">-- {t("select_customer")} --</option>

              {/* 🔥 NEW DEFAULT OPTION */}
              <option value="__SHOP__">Own shop Cylinder</option>

              {cylinderCustomers.map((cc) => (
                <option key={cc.id} value={cc.customerName}>
                  {cc.customerName} ({cc.qtyHeld})
                </option>
              ))}
            </select>
            </div>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">{t("qty_returned")}</label>
              <input type="number" value={qtyReturned} onChange={(e) => setQtyReturned(Number(e.target.value))} min="0" className="w-full px-3 py-2 border border-gray-300 rounded" placeholder="0" />
            </div>
            <div className="flex gap-2">
              <button onClick={() => setReturnCylinderModal(false)} className="flex-1 px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400">
                {t("cancel")}
              </button>
              <button onClick={handleSaveReturn} disabled={savingReturn} className="flex-1 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50">
                {savingReturn ? t("loading") : t("return")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ==========================================================
   CARD COMPONENT
   ========================================================== */
const Card = ({ title, value, icon, color }: { title: string; value: string | number; icon?: React.ReactNode; color?: string }) => {
  return (
    <div className="p-4 rounded-lg bg-white shadow-md flex items-center gap-3 hover:shadow-lg transition" style={{ borderLeft: `4px solid ${color}` }}>
      {icon}
      <div>
        <p className="text-sm text-gray-600">{title}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </div>
  );
};