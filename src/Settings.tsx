import React, { useEffect, useState, useRef } from "react";
import { getSettings, saveSettings, Settings } from "./db";
import { useLang } from "./i18n/LanguageContext";

const placeholderImg = "https://via.placeholder.com/150?text=No+Logo";

export default function SettingsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [formData, setFormData] = useState<Omit<Settings, "id">>({
  businessName: "",
  email: "",
  contact: "",
  address: "",
  logo: undefined,
  cylBPrice: "",       // 11.8 kg Buy Price → saved (moved to separate page)
  cylSPrice: "",       // 11.8 kg Sell Price → saved (moved to separate page)
  cylDPrice: "",       // 11.8 kg Discount Price → saved (moved to separate page)
  cylWPrice: "",       // 11.8 kg Wholesale Price → saved (moved to separate page)
  printer: "pos",
  language:"en"
});


  const [loading, setLoading] = useState(true);

  const { t, lang, setLang } = useLang();
  
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
  setLang(formData.language);
  window.dispatchEvent(new Event("settingsUpdated"));

  alert("General settings saved!");
};

  if (loading) return <p>Loading...</p>;

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-screen-lg mx-auto">
      <h2 className="text-xl font-semibold mb-4 text-center">{t("settings_title")}</h2>

      {/* Tab Contents */}
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
              {t("choose_logo")}
            </button>
          </div>

          {/* General Fields */}
          <div className="md:w-2/3 space-y-4">
            
            {/* <label className="font-large text-red-500">Business Settings</label> */}
            <div className="grid grid-cols-3 items-center gap-4">
              <label className="font-medium col-span-1">{t("business_name")}</label>
              <input
                type="text"
                className="border rounded px-3 py-2 w-full col-span-2"
                value={formData.businessName}
                onChange={e => setFormData(p => ({ ...p, businessName: e.target.value }))}
                required
              />
            </div>

            <div className="grid grid-cols-3 items-center gap-4">
              <label className="font-medium col-span-1">{t("email")}</label>
              <input
                type="email"
                className="border rounded px-3 py-2 w-full col-span-2"
                value={formData.email}
                onChange={e => setFormData(p => ({ ...p, email: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-3 items-center gap-4">
              <label className="font-medium col-span-1">{t("contact")}</label>
              <input
                type="text"
                className="border rounded px-3 py-2 w-full col-span-2"
                value={formData.contact}
                onChange={e => setFormData(p => ({ ...p, contact: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-3 items-start gap-4">
              <label className="font-medium col-span-1 pt-2">{t("address")}</label>
              <textarea
                className="border rounded px-3 py-2 w-full col-span-2"
                value={formData.address}
                onChange={e => setFormData(p => ({ ...p, address: e.target.value }))}
              />
            </div>

            {/* <label className="font-large text-red-500">Printer Settings</label> */}
            <div className="grid grid-cols-3 items-center gap-4">

                <label className="font-medium col-span-1">{t("printer_settings")}</label>
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
                  <span>{t("printer_pos")}</span>
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
                  <span>{t("printer_a4")}</span>
                </label>

            </div>

            <p></p>

            {/* <label className="font-large text-red-500">Language Settings</label> */}
            <div className="grid grid-cols-3 items-center gap-4">

                <label className="font-medium col-span-1">{t("language_settings")}</label>
              <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="langType"
                value="en"
                checked={formData.language === "en"}
                onChange={(e) =>
                  setFormData(p => ({ ...p, language: e.target.value as "en" | "ur" }))
                }
                className="accent-indigo-600"
              />
              <span>{t("language_en")}</span>
            </label>

<label className="flex items-center gap-2 cursor-pointer">
  <input
    type="radio"
    name="langType"
    value="ur"
    checked={formData.language === "ur"}
    onChange={(e) =>
      setFormData(p => ({ ...p, language: e.target.value as "en" | "ur" }))
    }
    className="accent-indigo-600"
  />
  <span>{t("language_ur")}</span>
</label>

            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={saveGeneralSettings}
                className="px-6 py-2 bg-green-600 text-white rounded hover:bg-green-500"
              >
                {t("update")}
              </button>
            </div>
          </div>
        </div>

    </div>
  );
}
