import React, { useEffect, useState, useRef } from "react";
import { getSettings, saveSettings, Settings } from "./db";

const placeholderImg =
  "https://via.placeholder.com/150?text=No+Logo";

export default function SettingsPage() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [formData, setFormData] = useState<Omit<Settings, "id">>({
    businessName: "",
    email: "",
    contact: "",
    address: "",
    logo: undefined,
  });

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      const settings = await getSettings();
      if (settings) {
        setFormData({
          businessName: settings.businessName,
          email: settings.email,
          contact: settings.contact,
          address: settings.address,
          logo: settings.logo,
        });
      }
      setLoading(false);
    }
    load();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      setFormData((p) => ({ ...p, logo: reader.result as string }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await saveSettings(formData);
    alert("Settings saved!");
  };

  if (loading) return <p>Loading...</p>;

  return (
    <div className="bg-white p-6 rounded-lg shadow-lg w-full max-w-screen-lg mx-auto">
      <h2 className="text-xl font-semibold mb-4">Settings</h2>

      <form onSubmit={handleSubmit} className="space-y-4 w-full">

        {/* Logo Section */}
        <div className="flex flex-col items-center">
          <div className="w-40 h-40 border rounded-lg overflow-hidden bg-gray-100 flex items-center justify-center">
            <img
              src={formData.logo || placeholderImg}
              alt="Logo Preview"
              className="object-contain w-full h-full"
            />
          </div>

          {/* Hidden real input */}
          <input
            type="file"
            accept="image/*"
            onChange={handleFileChange}
            ref={fileInputRef}
            className="hidden"
          />

          {/* Custom button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="mt-3 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500"
          >
            Choose Logo
          </button>
        </div>

        <div>
          <label className="block mb-1 font-medium">Business Name</label>
          <input
            type="text"
            className="border rounded px-3 py-2 w-full"
            value={formData.businessName}
            onChange={(e) =>
              setFormData((p) => ({ ...p, businessName: e.target.value }))
            }
            required
          />
        </div>

        <div>
          <label className="block mb-1 font-medium">Email</label>
          <input
            type="email"
            className="border rounded px-3 py-2 w-full"
            value={formData.email}
            onChange={(e) =>
              setFormData((p) => ({ ...p, email: e.target.value }))
            }
          />
        </div>

        <div>
          <label className="block mb-1 font-medium">Contact</label>
          <input
            type="text"
            className="border rounded px-3 py-2 w-full"
            value={formData.contact}
            onChange={(e) =>
              setFormData((p) => ({ ...p, contact: e.target.value }))
            }
          />
        </div>

        <div>
          <label className="block mb-1 font-medium">Address</label>
          <textarea
            className="border rounded px-3 py-2 w-full"
            value={formData.address}
            onChange={(e) =>
              setFormData((p) => ({ ...p, address: e.target.value }))
            }
          />
        </div>

        <button
          type="submit"
          className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-500"
        >
          Save
        </button>
      </form>
    </div>
  );
}
