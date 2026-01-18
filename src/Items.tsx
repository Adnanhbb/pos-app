// src/Items.tsx
import React, { useEffect, useRef, useState } from "react";
import {
  getItemsPaged,
  addItem,
  updateItem,
  deleteItem,
  Item,
  getBrands,
  getAllCategories,
  getUnits,
} from "./db";
import {
  FaPlus,
  FaEdit,
  FaTrash,
  FaSearch,
  FaTh,
  FaList,
  FaBoxes,
} from "react-icons/fa";

const PAGE_SIZE = 8;

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [view, setView] = useState<"table" | "cards">("table");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [brands, setBrands] = useState<string[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [units, setUnits] = useState<string[]>([]);

  const [isFormOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

  const emptyForm: Omit<Item, "id"> = {
    name: "",
    barcode: "",
    brand: "",
    category: "",
    minunit: "",
    maxunit: "",
    ConvQty: 1,
    purchasePrice: 0,
    retailPrice: 0,
    discountPrice: 0,
    wholesalePrice: 0,
    description: "",
    availableStock: 0
  };

  const [form, setForm] = useState<Omit<Item, "id">>(emptyForm);

  const svgRefs = useRef<Record<number | string, SVGSVGElement | null>>({});

  // Load items for table/cards
  async function loadPage() {
    const { total: t, data } = await getItemsPaged(page, PAGE_SIZE, query || null);
    setItems(data);
    setTotal(t);
  }

  useEffect(() => {
    loadPage();
  }, [page, query]);

  // Load dropdown data
  useEffect(() => {
    async function loadDropdowns() {
      const b = await getBrands();
      const c = await getAllCategories();
      const u = await getUnits();
      setBrands(b.map((x) => x.name));
      setCategories(c.map((x) => x.name));
      setUnits(u.map((x) => x.name));
    }
    loadDropdowns();
  }, []);

  // Generate barcodes
  useEffect(() => {
    if (typeof window === "undefined") return;
    import("jsbarcode").then((module) => {
      const JsBarcode = (module as any).default ?? (module as any);
      items.forEach((it) => {
        const el = svgRefs.current[it.id ?? it.barcode];
        if (el && it.barcode) {
          try {
            JsBarcode(el, it.barcode.toString(), {
              format: "EAN13",
              displayValue: false,
              width: 1.2,
              height: 30,
            });
          } catch {
            try {
              JsBarcode(el, it.barcode.toString(), {
                format: "CODE128",
                displayValue: false,
                width: 1.2,
                height: 30,
              });
            } catch {}
          }
        }
      });
    });
  }, [items]);

  function openCreate() {
    setEditingItem(null);
    setForm(emptyForm);
    setFormOpen(true);
  }

  function openEdit(it: Item) {
    setEditingItem(it);
    setForm({
      name: it.name,
      barcode: it.barcode,
      brand: it.brand,
      category: it.category,
      minunit: it.minunit,
      maxunit:it.maxunit,
      ConvQty:it.ConvQty,
      purchasePrice: it.purchasePrice,
      retailPrice: it.retailPrice,
      discountPrice: it.discountPrice || 0,
      wholesalePrice: it.wholesalePrice,
      description: it.description || "",
      availableStock: it.availableStock
    });
    setFormOpen(true);
  }

  function closeForm() {
    setEditingItem(null);
    setForm(emptyForm);
    setFormOpen(false);
  }

  async function handleSave() {
    if (!form.name.trim()) return alert("Name is required");
    if (!form.barcode.trim()) return alert("Barcode is required");

    if (editingItem) {
      await updateItem({ ...editingItem, ...form });
    } else {
      await addItem(form as Item);
      setPage(1);
    }
    await loadPage();
    closeForm();
  }

  async function handleDelete(id?: number) {
    if (!id) return;
    if (!confirm("Delete this item?")) return;
    await deleteItem(id);
    const newTotal = Math.max(0, total - 1);
    const newPages = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
    if (page > newPages) setPage(newPages);
    await loadPage();
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const conversionLabel =
              form.minunit && form.maxunit
                ? `No. of ${form.minunit} per ${form.maxunit}`
                : "Unit Conversion Qty";

  function splitStock(
  totalMinUnits: number,
  convQty: number
) {
  if (!convQty || convQty <= 0) {
    return { maxQty: 0, minQty: totalMinUnits };
  }

  const maxQty = Math.floor(totalMinUnits / convQty);
  const minQty = totalMinUnits % convQty;

  return { maxQty, minQty };
}

  return (
    <div className="p-2 sm:p-4 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="text-lg font-semibold">Items</div>
          <div className="ml-3 flex items-center gap-2">
            <button
              onClick={() => setView("table")}
              className={`p-2 rounded ${view === "table" ? "bg-indigo-600 text-white" : "bg-gray-100"}`}
            >
              <FaList />
            </button>
            <button
              onClick={() => setView("cards")}
              className={`p-2 rounded ${view === "cards" ? "bg-indigo-600 text-white" : "bg-gray-100"}`}
            >
              <FaTh />
            </button>
          </div>
        </div>

        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          <div className="flex items-center bg-white rounded shadow px-2">
            <FaSearch className="text-gray-500" />
            <input
              className="p-2 outline-none w-48"
              placeholder="Search by name / barcode / brand / category"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </div>

          <button
            onClick={openCreate}
            className="ml-2 inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded shadow"
          >
            <FaPlus /> Create New
          </button>
        </div>
      </div>

      {/* Table / Cards */}
      {view === "table" ? (
        <div className="overflow-x-auto bg-white rounded-lg shadow">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-200 text-gray-700">
              <tr>
                <th className="p-3 text-left">Name</th>
                <th className="p-3 text-left">Barcode</th>
                {/* <th className="p-3 text-left">Brand</th>
                <th className="p-3 text-left">Category</th>
                <th className="p-3 text-left">Min Unit</th>
                <th className="p-3 text-left">Max Unit</th>
                <th className="p-3 text-left">Conv Qty</th> */}
                <th className="p-3 text-left">Pur_Price</th>
                <th className="p-3 text-left">Ret_Price</th>
                <th className="p-3 text-left">Disc_Price</th>
                <th className="p-3 text-left">Whl_Price</th>
                <th className="p-3 text-left">Avl_Stock</th>
                <th className="p-3 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className="border-b hover:bg-gray-50">
                  <td className="p-3">{it.name}</td>
                  <td className="p-3 flex items-center gap-3">
                    <svg
                      ref={(el: SVGSVGElement | null) => {
                        svgRefs.current[it.id ?? it.barcode] = el ?? null;
                      }}
                      aria-hidden
                    />
                    <div className="text-xs text-gray-600 break-all">{it.barcode}</div>
                  </td>
                  {/* <td className="p-3">{it.brand}</td>
                  <td className="p-3">{it.category}</td>
                  <td className="p-3">{it.minunit}</td>
                  <td className="p-3">{it.maxunit}</td>
                  <td className="p-3">{it.ConvQty}</td> */}
                  <td className="p-3">{it.purchasePrice}</td>
                  <td className="p-3">{it.retailPrice}</td>
                  <td className="p-3">{it.discountPrice || 0}</td>
                  <td className="p-3">{it.wholesalePrice}</td>
                  <td className="p-3 text-sm text-blue-500">
                      {(() => {
                        const { maxQty, minQty } = splitStock(it.availableStock, it.ConvQty);

                        return (
                          <div className="leading-tight">
                            {maxQty > 0 && (
                              <div className="font-medium">
                                {maxQty} {it.maxunit}s
                              </div>
                            )}

                            {minQty > 0 && (
                              <div className="text-green-600 text-xs">
                                {minQty} {it.minunit}s
                              </div>
                            )}

                            {maxQty === 0 && minQty === 0 && (
                              <div className="text-red-500 text-xs">Out of stock</div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                  <td className="p-3 text-center flex justify-center gap-2">
                    <button onClick={() => openEdit(it)} className="p-2 bg-blue-500 text-white rounded">
                      <FaEdit />
                    </button>
                    <button onClick={() => handleDelete(it.id)} className="p-2 bg-red-500 text-white rounded">
                      <FaTrash />
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={11} className="text-center p-4 text-gray-500">
                    No items found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {items.map((it) => (
            <div key={it.id} className="bg-white rounded-xl shadow border p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <FaBoxes className="text-xl text-indigo-600" />
                  <h3 className="font-bold text-lg truncate">{it.name}</h3>
                </div>
                <div className="mb-2">
                  <svg
                    ref={(el: SVGSVGElement | null) => {
                      svgRefs.current[it.id ?? it.barcode] = el ?? null;
                    }}
                    aria-hidden
                  />
                </div>
                <div className="text-sm text-gray-600">Barcode: {it.barcode}</div>
                <div className="text-sm text-gray-600">Brand: {it.brand}</div>
                <div className="text-sm text-gray-600">Category: {it.category}</div>
                <div className="text-sm text-gray-600">Retail: {it.retailPrice}</div>
                <div className="text-sm text-gray-600">Disc: {it.discountPrice || 0}</div>
                <div className="text-sm text-gray-600">Stock: {it.availableStock}</div>
              </div>

              <div className="flex gap-2 mt-3">
                <button onClick={() => openEdit(it)} className="flex-1 bg-blue-500 text-white p-2 rounded text-sm">Edit</button>
                <button onClick={() => handleDelete(it.id)} className="flex-1 bg-red-500 text-white p-2 rounded text-sm">Delete</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      <div className="mt-4 flex justify-center gap-2 flex-wrap">
        <button
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
          className={`px-3 py-1 rounded ${page === 1 ? "bg-gray-300" : "bg-indigo-500 text-white"}`}
        >
          Prev
        </button>
        <span className="px-3 py-1 bg-gray-200 rounded">
          Page {page} / {totalPages}
        </span>
        <button
          disabled={page === totalPages}
          onClick={() => setPage(page + 1)}
          className={`px-3 py-1 rounded ${page === totalPages ? "bg-gray-300" : "bg-indigo-500 text-white"}`}
        >
          Next
        </button>
      </div>

      {/* Modal Form */}
      {isFormOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
          <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-2xl">
            <h2 className="text-xl font-bold mb-4">{editingItem ? "Edit Item" : "Create Item"}</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium mb-1">Name</label>
                <input className="w-full p-2 border rounded" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Barcode</label>
                <input className="w-full p-2 border rounded" value={form.barcode} onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
              </div>

              {/* Dropdowns for Brand / Category / Unit */}
              <div>
                {/* <label className="block text-xs font-medium mb-1">Brand</label> */}
                <select className="w-full p-2 border rounded" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })}>
                  <option value="">Select Brand</option>
                  {brands.map((b) => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>

              <div>
                {/* <label className="block text-xs font-medium mb-1">Category</label> */}
                <select className="w-full p-2 border rounded" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                  <option value="">Select Category</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>

              <div>
                {/* <label className="block text-xs font-medium mb-1"> Minimum Unit</label> */}
                <select className="w-full p-2 border rounded" value={form.minunit} onChange={(e) => setForm({ ...form, minunit: e.target.value })}>
                  <option value="">Select Min Unit</option>
                  {units.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>

              <div>
                {/* <label className="block text-xs font-medium mb-1">Maximum Unit</label> */}
                <select className="w-full p-2 border rounded" value={form.maxunit} onChange={(e) => setForm({ ...form, maxunit: e.target.value })}>
                  <option value="">Select Max Unit</option>
                  {units.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              
               <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">{conversionLabel}</label>
                <input type="number" className="w-full p-2 border rounded" value={form.ConvQty} onChange={(e) => setForm({ ...form, ConvQty: Number(e.target.value) })} />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Purchase Price</label>
                <input type="number" className="w-full p-2 border rounded" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) })} />
              </div>
              
              <div>
                <label className="block text-xs font-medium mb-1">Retail Price</label>
                <input type="number" className="w-full p-2 border rounded" value={form.retailPrice} onChange={(e) => setForm({ ...form, retailPrice: Number(e.target.value) })} />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Discount Price</label>
                <input type="number" className="w-full p-2 border rounded" value={form.discountPrice} onChange={(e) => setForm({ ...form, discountPrice: Number(e.target.value) })} />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1">Wholesale Price</label>
                <input type="number" className="w-full p-2 border rounded" value={form.wholesalePrice} onChange={(e) => setForm({ ...form, wholesalePrice: Number(e.target.value) })} />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Opening Stock ({form.minunit})</label>
                <input type="number" className="w-full p-2 border rounded" value={form.availableStock} onChange={(e) => setForm({ ...form, availableStock: Number(e.target.value) })} />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-xs font-medium mb-1">Description</label>
                <textarea className="w-full p-2 border rounded" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
              </div>
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button onClick={closeForm} className="px-4 py-2 bg-gray-300 rounded">Cancel</button>
              <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white rounded">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
