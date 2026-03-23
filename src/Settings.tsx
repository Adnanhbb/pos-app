import React, { useEffect, useState, useRef } from "react";
import { getSettings, saveSettings, Settings, updateItem } from "./db";
import { categoriesRepository } from "./repositories/categoriesRepository";
import { itemsRepository } from "./repositories/itemsRepository";

const placeholderImg = "https://via.placeholder.com/150?text=No+Logo";

export default function SettingsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [formData, setFormData] = useState<Omit<Settings, "id"> & {
  // Calculated 1kg fields, not saved
  purchase1kg: string;
  retail1kg: string;
  discount1kg: string;
  wholesale1kg: string;
}>({
  businessName: "",
  email: "",
  contact: "",
  address: "",
  logo: undefined,
  cylBPrice: "",       // 11.8 kg Buy Price → saved
  cylSPrice: "",       // 11.8 kg Sell Price → saved
  cylDPrice: "",       // 11.8 kg Discount Price → saved
  cylWPrice: "",       // 11.8 kg Wholesale Price → saved
  purchase1kg: "",     // calculated
  retail1kg: "",       // calculated
  discount1kg: "",     // calculated
  wholesale1kg: "",     // calculated
  printer: "pos",
  language:"eng"
});


  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"general" | "gas">("general");
  const [hasGasCategory, setHasGasCategory] = useState(false);

  // Load settings
  useEffect(() => {
    async function load() {
      const settings = await getSettings();
      if (settings) {
        setFormData(prev => ({ ...prev, ...settings }));
      }
      setLoading(false);
    }
    load();
  }, []);

  // Check if "Gas" category exists
  useEffect(() => {
    async function checkGasCategory() {
      const categories = await categoriesRepository.getAll();
      setHasGasCategory(categories.some(cat => cat.name.toLowerCase() === "gas"));
    }
    checkGasCategory();
  }, []);

  // Whenever the Gas tab is active, update the 1kg prices
useEffect(() => {
  if (activeTab !== "gas") return;

  setFormData((prev) => ({
    ...prev,
    purchase1kg: prev.cylBPrice ? (Number(prev.cylBPrice) / 11.8).toFixed(2) : "",
    retail1kg: prev.cylSPrice ? (Number(prev.cylSPrice) / 11.8).toFixed(2) : "",
    discount1kg: prev.cylDPrice ? (Number(prev.cylDPrice) / 11.8).toFixed(2) : "",
    wholesale1kg: prev.cylWPrice ? (Number(prev.cylWPrice) / 11.8).toFixed(2) : "",
  }));
}, [activeTab, formData.cylBPrice, formData.cylSPrice, formData.cylDPrice, formData.cylWPrice]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setFormData(p => ({ ...p, logo: reader.result as string }));
    reader.readAsDataURL(file);
  };

// --- Save General Settings (tab 1) ---
const saveGeneralSettings = async () => {
  const currentSettings = await getSettings();
  if (!currentSettings) return;

  const updated = {
    ...currentSettings,
    businessName: formData.businessName,
    email: formData.email,
    contact: formData.contact,
    address: formData.address,
    logo: formData.logo,
    printer: formData.printer,
    language: formData.language
  };

  await saveSettings(updated);

  // ⭐ ADD THIS LINE
  window.dispatchEvent(new Event("settingsUpdated"));

  alert("General settings saved!");
};

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

  alert("Gas cylinder prices saved and applied to all Gas items!");
};

  if (loading) return <p>Loading...</p>;

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-screen-lg mx-auto">
      <h2 className="text-xl font-semibold mb-4 text-center">SETTINGS</h2>

      {/* Tabs */}
      <div className="flex border-b mb-6">
        <button
          onClick={() => setActiveTab("general")}
          className={`px-4 py-2 font-medium ${activeTab === "general" ? "border-b-2 border-blue-600 text-blue-600" : ""}`}
        >
          General
        </button>
        {hasGasCategory && (
          <button
            onClick={() => setActiveTab("gas")}
            className={`px-4 py-2 font-medium ${activeTab === "gas" ? "border-b-2 border-blue-600 text-blue-600" : ""}`}
          >
            Gas Cylinder Prices
          </button>
        )}
      </div>

      {/* Tab Contents */}
      {activeTab === "general" && (
        <div className="flex flex-col md:flex-row gap-8">
          {/* Logo Section */}
          <div className="md:w-1/3 flex flex-col items-center">
            <div className="w-40 h-40 border rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
              <img
                src={formData.logo || placeholderImg}
                alt="Logo Preview"
                className="object-contain w-full h-full"
              />
            </div>
            <input type="file" accept="image/*" onChange={handleFileChange} ref={fileInputRef} className="hidden" />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
            >
              Choose Logo
            </button>
          </div>

          {/* General Fields */}
          <div className="md:w-2/3 space-y-4">
            
            {/* <label className="font-large text-red-500">Business Settings</label> */}
            <div className="grid grid-cols-3 items-center gap-4">
              <label className="font-medium col-span-1">Business Name</label>
              <input
                type="text"
                className="border rounded px-3 py-2 w-full col-span-2"
                value={formData.businessName}
                onChange={e => setFormData(p => ({ ...p, businessName: e.target.value }))}
                required
              />
            </div>

            <div className="grid grid-cols-3 items-center gap-4">
              <label className="font-medium col-span-1">Email</label>
              <input
                type="email"
                className="border rounded px-3 py-2 w-full col-span-2"
                value={formData.email}
                onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-3 items-center gap-4">
              <label className="font-medium col-span-1">Contact</label>
              <input
                type="text"
                className="border rounded px-3 py-2 w-full col-span-2"
                value={formData.contact}
                onChange={e => setFormData(p => ({ ...p, contact: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-3 items-start gap-4">
              <label className="font-medium col-span-1 pt-2">Address</label>
              <textarea
                className="border rounded px-3 py-2 w-full col-span-2"
                value={formData.address}
                onChange={e => setFormData(p => ({ ...p, address: e.target.value }))}
              />
            </div>

            {/* <label className="font-large text-red-500">Printer Settings</label> */}
            <div className="grid grid-cols-3 items-center gap-4">

                <label className="font-medium col-span-1">Printer Settings</label>
                  <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="printerType"
                    value="pos"
                    checked={formData.printer === "pos"}
                    onChange={(e) =>
                      setFormData(p => ({ ...p, printer: e.target.value as "pos" | "a4" }))
                    }
                    className="accent-indigo-600"
                  />
                  <span>POS Printer</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="printerType"
                    value="a4"
                    checked={formData.printer === "a4"}
                    onChange={(e) =>
                      setFormData(p => ({ ...p, printer: e.target.value as "pos" | "a4" }))
                    }
                    className="accent-indigo-600"
                  />
                  <span>A4 Printer</span>
                </label>

            </div>

            <p></p>

            {/* <label className="font-large text-red-500">Language Settings</label> */}
            <div className="grid grid-cols-3 items-center gap-4">

                <label className="font-medium col-span-1">Language Settings</label>
              <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="langType"
                value="eng"
                checked={formData.language === "eng"}
                onChange={(e) =>
                  setFormData(p => ({ ...p, language: e.target.value as "eng" | "urd" }))
                }
                className="accent-indigo-600"
              />
              <span>English</span>
            </label>

<label className="flex items-center gap-2 cursor-pointer">
  <input
    type="radio"
    name="langType"
    value="urd"
    checked={formData.language === "urd"}
    onChange={(e) =>
      setFormData(p => ({ ...p, language: e.target.value as "eng" | "urd" }))
    }
    className="accent-indigo-600"
  />
  <span>Urdu</span>
</label>

            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={saveGeneralSettings}
                className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-500"
              >
                Update
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === "gas" && hasGasCategory && (
  <div className="md:w-2/3 mx-auto space-y-4">
    {/* <h3 className="font-semibold mb-2 text-center">Gas Cylinder Prices</h3> */}

    <div className="grid grid-cols-3 gap-4 items-center font-medium text-green-500">
      <div></div>
      <div className="text-center font-bold">11.8 Kg</div>
      <div className="text-center font-bold">1 Kg</div>
    </div>

    {/* Purchase Price */}
    <div className="grid grid-cols-3 gap-4 items-center">
      <div className="font-medium text-red-500">Purchase Price</div>
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
      <div className="font-medium text-red-500">Retail Price</div>
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
  <div className="font-medium text-red-500">Discount Price</div>
  <input
    type="number"
    className="border rounded px-3 py-2 w-full"
    value={formData.cylDPrice || ""}
    onChange={(e) => {
      const val = e.target.value;
      setFormData((p) => ({
        ...p,
        cylDPrice: val, // updated here
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
  <div className="font-medium text-red-500">Wholesale Price</div>
  <input
    type="number"
    className="border rounded px-3 py-2 w-full"
    value={formData.cylWPrice || ""}
    onChange={(e) => {
      const val = e.target.value;
      setFormData((p) => ({
        ...p,
        cylWPrice: val, // updated here
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
        Update
      </button>
    </div>
  </div>
)}

    </div>
  );
}
