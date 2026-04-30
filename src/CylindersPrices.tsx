// src/CylindersPrices.tsx
import React, { useEffect, useState } from "react";
import { getSettings, saveSettings, updateItem } from "./db";
import { categoriesRepository } from "./repositories/categoriesRepository";
import { itemsRepository } from "./repositories/itemsRepository";
import { useLang } from "./i18n/LanguageContext";

export default function CylindersPrices() {
  const [formData, setFormData] = useState({
    cylBPrice: "",       // 11.8 kg Buy Price → saved
    cylSPrice: "",       // 11.8 kg Sell Price → saved
    cylDPrice: "",       // 11.8 kg Discount Price → saved
    cylWPrice: "",       // 11.8 kg Wholesale Price → saved
    purchase1kg: "",     // calculated
    retail1kg: "",       // calculated
    discount1kg: "",     // calculated
    wholesale1kg: "",     // calculated
  });

  const [loading, setLoading] = useState(true);
  const [hasGasCategory, setHasGasCategory] = useState(false);

  const { t } = useLang();

  // Load settings
  useEffect(() => {
    async function load() {
      const settings = await getSettings();
      if (settings) {
        setFormData(prev => ({
          ...prev,
          cylBPrice: settings.cylBPrice || "",
          cylSPrice: settings.cylSPrice || "",
          cylDPrice: settings.cylDPrice || "",
          cylWPrice: settings.cylWPrice || "",
        }));
      }
      setLoading(false);
    }
    load();
  }, []);

  // Check if "Gas" category exists
//   useEffect(() => {
//     async function checkGasCategory() {
//       const categories = await categoriesRepository.getAll();
//       setHasGasCategory(categories.some(cat => cat.name.toLowerCase() === "gas"));
//     }
//     checkGasCategory();
//   }, []);

  // Update the 1kg prices whenever the 11.8kg prices change
  useEffect(() => {
    setFormData((prev) => ({
      ...prev,
      purchase1kg: prev.cylBPrice ? (Number(prev.cylBPrice) / 11.8).toFixed(2) : "",
      retail1kg: prev.cylSPrice ? (Number(prev.cylSPrice) / 11.8).toFixed(2) : "",
      discount1kg: prev.cylDPrice ? (Number(prev.cylDPrice) / 11.8).toFixed(2) : "",
      wholesale1kg: prev.cylWPrice ? (Number(prev.cylWPrice) / 11.8).toFixed(2) : "",
    }));
  }, [formData.cylBPrice, formData.cylSPrice, formData.cylDPrice, formData.cylWPrice]);

  const saveGasPrices = async () => {
    if (!hasGasCategory) return;

    const currentSettings = await getSettings();
    if (!currentSettings) return;

    await saveSettings({
      ...currentSettings,
      cylBPrice: formData.cylBPrice,
      cylSPrice: formData.cylSPrice,
      cylDPrice: formData.cylDPrice,
      cylWPrice: formData.cylWPrice
    });

    // 🔹 UPDATE ALL GAS ITEMS
    const items = await itemsRepository.getAll();

    const gasItems = items.filter(
      item => item.category === "Gas"
    );

    for (const item of gasItems) {
      await updateItem({
        ...item,
        purchasePrice: Number((Number(formData.cylBPrice)/11.8).toFixed(2)),   //Purchase price
        retailPrice: Number((Number(formData.cylSPrice)/11.8).toFixed(2)),     // retail price
        discountPrice: Number((Number(formData.cylDPrice)/11.8).toFixed(2)),   // discount
        wholesalePrice: Number((Number(formData.cylWPrice)/11.8).toFixed(2))   // wholesale
      });
    }

    alert(t("gas_prices_saved"));
  };

  if (loading) return <p>{t("loading")}</p>;

//   if (!hasGasCategory) {
//     return (
//       <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-screen-lg mx-auto">
//         <h2 className="text-xl font-semibold mb-4 text-center">{t("cylinders_prices_title")}</h2>
//         <p className="text-center text-gray-500">{t("no_gas_category")}</p>
//       </div>
//     );
//   }

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-screen-lg mx-auto">
      <h2 className="text-xl font-semibold mb-4 text-center">{t("cylinders_prices_title")}</h2>

      <div className="md:w-2/3 mx-auto space-y-4">
        <div className="grid grid-cols-3 gap-4 items-center font-medium text-green-500">
          <div></div>
          <div className="text-center font-bold">11.8 {t("kg")}</div>
          <div className="text-center font-bold">1 {t("kg")}</div>
        </div>

        {/* Purchase Price */}
        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="font-medium text-red-500">{t("cyl_purchase_price")}</div>
          <input
            type="number"
            className="border rounded px-3 py-2 w-full"
            value={formData.cylBPrice}
            onChange={(e) => {
              const val = e.target.value;
              setFormData((p) => ({
                ...p,
                cylBPrice: val,
                purchase1kg: val ? (Number(val) / 11.8).toFixed(2) : ""
              }));
            }}
          />
          <input
            type="number"
            className="border rounded px-3 py-2 w-full bg-gray-100"
            value={formData.purchase1kg || ""}
            readOnly
          />
        </div>

        {/* Retail Price */}
        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="font-medium text-red-500">{t("cyl_retail_price")}</div>
          <input
            type="number"
            className="border rounded px-3 py-2 w-full"
            value={formData.cylSPrice}
            onChange={(e) => {
              const val = e.target.value;
              setFormData((p) => ({
                ...p,
                cylSPrice: val,
                retail1kg: val ? (Number(val) / 11.8).toFixed(2) : ""
              }));
            }}
          />
          <input
            type="number"
            className="border rounded px-3 py-2 w-full bg-gray-100"
            value={formData.retail1kg || ""}
            readOnly
          />
        </div>

        {/* Discount Price */}
        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="font-medium text-red-500">{t("cyl_discount_price")}</div>
          <input
            type="number"
            className="border rounded px-3 py-2 w-full"
            value={formData.cylDPrice || ""}
            onChange={(e) => {
              const val = e.target.value;
              setFormData((p) => ({
                ...p,
                cylDPrice: val,
                discount1kg: val ? (Number(val) / 11.8).toFixed(2) : ""
              }));
            }}
          />
          <input
            type="number"
            className="border rounded px-3 py-2 w-full bg-gray-100"
            value={formData.discount1kg || ""}
            readOnly
          />
        </div>

        {/* Wholesale Price */}
        <div className="grid grid-cols-3 gap-4 items-center">
          <div className="font-medium text-red-500">{t("cyl_wholesale_price")}</div>
          <input
            type="number"
            className="border rounded px-3 py-2 w-full"
            value={formData.cylWPrice || ""}
            onChange={(e) => {
              const val = e.target.value;
              setFormData((p) => ({
                ...p,
                cylWPrice: val,
                wholesale1kg: val ? (Number(val) / 11.8).toFixed(2) : ""
              }));
            }}
          />
          <input
            type="number"
            className="border rounded px-3 py-2 w-full bg-gray-100"
            value={formData.wholesale1kg || ""}
            readOnly
          />
        </div>

        <div className="flex justify-end mt-3">
          <button
            type="button"
            onClick={saveGasPrices}
            className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-500"
          >
            {t("update")}
          </button>
        </div>
      </div>
    </div>
  );
}