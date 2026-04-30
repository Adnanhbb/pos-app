// src/Items.tsx
import React, { useEffect, useRef, useState } from "react";
// import {
//   getItemsPaged,
//   addItem,
//   updateItem,
//   deleteItem,
//   Item,
//   getBrands,
//   getAllCategories,
//   getUnits,
//   Brand,
//   Category,
//   Unit,
// } from "./db";
import {
  FaPlus,
  FaEdit,
  FaTrash,
  FaSearch,
  FaTh,
  FaList,
  FaBoxes,
  FaUndo,
  FaEye
} from "react-icons/fa";

import { settingsRepository } from "./repositories/settingsRepository";
import { categoriesRepository, Category } from "./repositories/categoriesRepository";
import { Brand, brandsRepository } from "./repositories/brandsRepository";
import { Unit, unitRepository } from "./repositories/unitRepository";
import { Item, itemsRepository } from "./repositories/itemsRepository";
import { useLang } from "./i18n/LanguageContext";
import { batchRepository } from "./repositories/batchRepository";
import {
  cylinderRepo_getByItemId,
  cylinderRepo_add,
  cylinderRepo_update,
} from "./repositories/cylinderRepository";

const PAGE_SIZE = 8;

export default function ItemsPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [view, setView] = useState<"table" | "cards">("table");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const [brands, setBrands] = useState<Brand[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);

  const [showDeletedModal, setShowDeletedModal] = useState(false);
  const [deletedItems, setDeletedItems] = useState<Item[]>([]);

  const [isFormOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);

 const emptyForm: Omit<Item, "id"> = {
  name: "",
  barcode: "",
  brand: "",      // string name
  category: "",   // string name
  minunit: "",    // string name
  maxunit: "",    // string name
  ConvQty: 1,
  purchasePrice: 0,
  retailPrice: 0,
  discountPrice: 0,
  wholesalePrice: 0,
  description: "",
  availableStock: 0,
  isDeleted: false,
  deletedAt: null
};


  const [form, setForm] = useState<Omit<Item, "id">>(emptyForm);

  const svgRefs = useRef<Record<number | string, SVGSVGElement | null>>({});

  const [gasBuyPrice, setGasBuyPrice] = useState<number>(0);
  const [gasSellPrice, setGasSellPrice] = useState<number>(0);
  const [showGasFields, setShowGasFields] = useState(false);

  const { t, lang, setLang } = useLang();
  
  // Load items for table/cards
  async function loadPage() {
    const { total: t, data } = await itemsRepository.getPaged(page, PAGE_SIZE, query);
    setItems(data);
    setTotal(t);
  }

  useEffect(() => {
    loadPage();
  }, [page, query]);

  // Load dropdown data
  useEffect(() => {
    async function loadDropdowns() {
      const b = await brandsRepository.getAll();
      const c = await categoriesRepository.getAll();
      const u = await unitRepository.getAll();

      setBrands(b);
      setCategories(c);
      setUnits(u);

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

// --- Open Edit ---
async function openEdit(it: Item) {
  setEditingItem(it);

  const isGas = it.category?.trim().toLowerCase() === "gas";

  if (isGas) {
    // Fetch saved 11.8kg prices from settings
    const settings = await settingsRepository.get();

    const buy112 = Number(settings?.cylBPrice) || 0;
    const sell112 = Number(settings?.cylSPrice) || 0;
    const discount112 = Number(settings?.cylDPrice) || 0;
    const wholesale112 = Number(settings?.cylWPrice) || 0;

    // Calculate 1kg prices
    const perKgBuy = +(buy112 / 11.8).toFixed(2);
    const perKgSell = +(sell112 / 11.8).toFixed(2);
    const perKgDiscount = +(discount112 / 11.8).toFixed(2);
    const perKgWholesale = +(wholesale112 / 11.8).toFixed(2);

    setForm({
      name: it.name,
      barcode: it.barcode,
      brand: it.brand,
      category: it.category,
      minunit: it.minunit,
      maxunit: it.maxunit,
      ConvQty: it.ConvQty,
      purchasePrice: perKgBuy,
      retailPrice: perKgSell,
      discountPrice: perKgDiscount,
      wholesalePrice: perKgWholesale,
      description: it.description || "",
      availableStock: it.availableStock,
      isDeleted: it.isDeleted,
      deletedAt: it.deletedAt,
    });
  } else {
    // Non-Gas items, use existing item values
    setForm({
      name: it.name,
      barcode: it.barcode,
      brand: it.brand,
      category: it.category,
      minunit: it.minunit,
      maxunit: it.maxunit,
      ConvQty: it.ConvQty,
      purchasePrice: it.purchasePrice,
      retailPrice: it.retailPrice,
      discountPrice: it.discountPrice || 0,
      wholesalePrice: it.wholesalePrice,
      description: it.description || "",
      availableStock: it.availableStock,
      isDeleted: it.isDeleted,
      deletedAt: it.deletedAt,
    });
  }

  setFormOpen(true);
}

 // --- Close Form ---
function closeForm() {
  setEditingItem(null);

  // Reset main form
  setForm(emptyForm);

  // Close modal
  setFormOpen(false);
}

  function getCategoryIdByName(name: string) {
  return categories.find(c => c.name === name)?.id;
}

function getBrandIdByName(name: string) {
  return brands.find(b => b.name === name)?.id;
}

function getUnitIdByName(name: string) {
  return units.find(u => u.name === name)?.id;
}

// --- handleSave ---
async function handleSave() {
  if (!form.name.trim()) return alert("Name is required");
  if (!form.barcode.trim()) return alert("Barcode is required");

  /* --------------------------------------------------
     🔍 DUPLICATE CHECK
  -------------------------------------------------- */
  const allItems = await itemsRepository.getAll();

  const duplicate = allItems.find(i =>
    i.name.trim().toLowerCase() === form.name.trim().toLowerCase() &&
    (!editingItem || i.id !== editingItem.id)
  );

  if (duplicate) {
    alert("This item name already exists");
    return;
  }

  /* --------------------------------------------------
     🔗 LOOKUPS
  -------------------------------------------------- */
  const brandId = brands.find(b => b.name === form.brand)?.id;
  const categoryId = categories.find(c => c.name === form.category)?.id;
  const minunitId = units.find(u => u.name === form.minunit)?.id;
  const maxunitId = units.find(u => u.name === form.maxunit)?.id;

  /* ==================================================
     ✏️ EDIT MODE
  ================================================== */
  if (editingItem) {
    const oldBrandId = brands.find(b => b.name === editingItem.brand)?.id;
    const oldCategoryId = categories.find(c => c.name === editingItem.category)?.id;
    const oldMinUnitId = units.find(u => u.name === editingItem.minunit)?.id;
    const oldMaxUnitId = units.find(u => u.name === editingItem.maxunit)?.id;

    if (oldCategoryId !== categoryId) {
      if (oldCategoryId) await categoriesRepository.decrementItemCount(oldCategoryId);
      if (categoryId) await categoriesRepository.incrementItemCount(categoryId);
    }

    if (oldBrandId !== brandId) {
      if (oldBrandId) await brandsRepository.decrementItemCount(oldBrandId);
      if (brandId) await brandsRepository.incrementItemCount(brandId);
    }

    if (oldMinUnitId !== minunitId) {
      if (oldMinUnitId) await unitRepository.decrementItemCount(oldMinUnitId);
      if (minunitId) await unitRepository.incrementItemCount(minunitId);
    }

    if (oldMaxUnitId !== maxunitId) {
      if (oldMaxUnitId) await unitRepository.decrementItemCount(oldMaxUnitId);
      if (maxunitId) await unitRepository.incrementItemCount(maxunitId);
    }

    await itemsRepository.update({ ...editingItem, ...form });

    const isCylinder =
  (form.category || "").toLowerCase().includes("gas") ||
  (form.category || "").toLowerCase().includes("cylinder");

if (isCylinder && editingItem?.id) {
  const convQty = Number(form.ConvQty || 1);
  const openingQtyMin = Number(form.availableStock || 0);

  const openingQtyMax =
    convQty > 0 ? Math.floor(openingQtyMin / convQty) : openingQtyMin;

  const existing = await cylinderRepo_getByItemId(editingItem.id);

  if (existing) {
    await cylinderRepo_update({
      ...existing,
      title: form.name,              // ✅ update name
      convQty: convQty,
      filledCylinders: openingQtyMax,
      qtyInStock: openingQtyMax,
    });
  }
}
  }

/* ==================================================
   ➕ CREATE MODE
================================================== */
else {
  // ✅ DO NOT cast to Item
  const newItemId = await itemsRepository.create({
  ...form,
  isDeleted: false,
  deletedAt: null,
} as Item);

  const openingQtyMin = Number(form.availableStock ?? 0);

  /* ---------------- BATCH LOGIC ---------------- */
  if (openingQtyMin > 0) {
    await batchRepository.addBatch({
      itemId: newItemId,
      purchaseDate: new Date().toISOString(),
      qtyPurchased: openingQtyMin,
      qtySold: 0,
      balance: openingQtyMin,
      costPrice: Number(form.purchasePrice || 0),
      sourceSaleId: 0,
      invoiceNo: "Opening Stock",
    });
  }

  /* ---------------- CYLINDER LOGIC ---------------- */
  const isCylinder =
    (form.category || "").toLowerCase().includes("gas") ||
    (form.category || "").toLowerCase().includes("cylinder");

  if (isCylinder) {
    const convQty = Number(form.ConvQty || 1);

    const openingQtyMax =
      convQty > 0 ? Math.floor(openingQtyMin / convQty) : openingQtyMin;

    await cylinderRepo_add({
      itemId: newItemId,
      title: form.name,
      filledCylinders: openingQtyMax,
      emptyCylinders: 0,
      withCustomers: 0,
      convQty,
      qtyInStock: openingQtyMax,
      isDeleted: false,
      deletedAt: null,
    });
  }

  /* ---------------- USAGE COUNTS ---------------- */
  if (categoryId) await categoriesRepository.incrementItemCount(categoryId);
  if (brandId) await brandsRepository.incrementItemCount(brandId);
  if (minunitId) await unitRepository.incrementItemCount(minunitId);
  if (maxunitId) await unitRepository.incrementItemCount(maxunitId);

  setPage(1);
}

  /* --------------------------------------------------
     🔄 REFRESH UI
  -------------------------------------------------- */
  await loadPage();
  closeForm();
}

const loadDeletedItems = async () => {
  const data = await itemsRepository.getDeleted();
  setDeletedItems(data);
};

const openDeletedModal = async () => {
  await loadDeletedItems();
  setShowDeletedModal(true);
};

const handleRestore = async (id?: number) => {
  if (!id) return;

  await itemsRepository.restore(id);

  const item = await itemsRepository.getById(id);
  if (!item) return;

  const openingQty = Number(item.availableStock || 0);

  /* ==================================================
     🔵 RESTORE BATCH (FULL RECREATE RULE)
  ================================================== */
  const existingBatches = await batchRepository.getBatchesByItem(id);

  const hasOpening = existingBatches.some(b =>
    (b.invoiceNo || "").toLowerCase().includes("opening stock")
  );

  if (!hasOpening && openingQty > 0) {
    await batchRepository.addBatch({
      itemId: id,
      purchaseDate: new Date().toISOString(),
      qtyPurchased: openingQty,
      qtySold: 0,
      balance: openingQty,
      costPrice: Number(item.purchasePrice || 0),
      sourceSaleId: 0,
      invoiceNo: "Opening Stock (Restored)",
    });
  }

  /* ==================================================
     🟡 RESTORE CYLINDER
  ================================================== */
  const isCylinder =
    (item.category || "").toLowerCase().includes("gas") ||
    (item.category || "").toLowerCase().includes("cylinder");

  if (isCylinder) {
    const convQty = Number(item.ConvQty || 1);

    const openingQtyMax =
      convQty > 0 ? Math.floor(openingQty / convQty) : openingQty;

    const existingCylinder = await cylinderRepo_getByItemId(id);

    if (existingCylinder) {
      await cylinderRepo_update({
        ...existingCylinder,
        isDeleted: false,
        deletedAt: null,
        title: item.name,
        filledCylinders: openingQtyMax,
        qtyInStock: openingQtyMax,
      });
    } else {
      await cylinderRepo_add({
        itemId: id,
        title: item.name,
        filledCylinders: openingQtyMax,
        emptyCylinders: 0,
        withCustomers: 0,
        convQty,
        qtyInStock: openingQtyMax,
        isDeleted: false,
        deletedAt: null,
      });
    }
  }

  await loadDeletedItems();
  await loadPage();
};

const handlePermanentDelete = async (id?: number) => {
  if (!id) return;

  if (!window.confirm(t("deletePermanentlyConfirm")))
    return;

  // 🔥 NEW
  await batchRepository.getAllBatchesByItem(id);

  await itemsRepository.permanentDelete(id);
  await loadDeletedItems();
  await loadPage();
};

async function handleDelete(id?: number) {
  if (!id) return;
  if (!confirm("Delete this item?")) return;

  const item = items.find(it => it.id === id);
  if (!item) return alert("Item not found");

  const brandId = brands.find(b => b.name === item.brand)?.id;
  const categoryId = categories.find(c => c.name === item.category)?.id;
  const minunitId = units.find(u => u.name === item.minunit)?.id;
  const maxunitId = units.find(u => u.name === item.maxunit)?.id;

  if (categoryId) await categoriesRepository.decrementItemCount(categoryId);
  if (brandId) await brandsRepository.decrementItemCount(brandId);
  if (minunitId) await unitRepository.decrementItemCount(minunitId);
  if (maxunitId) await unitRepository.decrementItemCount(maxunitId);

  /* ==================================================
     🔵 CYLINDER SOFT DELETE
  ================================================== */
  const cyl = await cylinderRepo_getByItemId(id);

  if (cyl) {
    await cylinderRepo_update({
      ...cyl,
      isDeleted: true,
      deletedAt: Date.now(),
    });
  }

  /* ==================================================
     🔵 BATCH SOFT DELETE (NEW REQUIRED LOGIC)
  ================================================== */
  const batches = await batchRepository.getAllBatchesByItem(id);

  for (const b of batches) {
    if (b.id != null) {
      await batchRepository.updateBatch({
        ...b,
        balance: 0,
        qtyPurchased: b.qtyPurchased,
        qtySold: b.qtyPurchased, // fully consumed logically
      });
    }
  }

  /* ==================================================
     🔵 ITEM SOFT DELETE
  ================================================== */
  await itemsRepository.remove(id);

  const newTotal = Math.max(0, total - 1);
  const newPages = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
  if (page > newPages) setPage(newPages);

  await loadPage();
}

const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

const conversionLabel =
            form.minunit && form.maxunit
              ? `No. of ${form.minunit} per ${form.maxunit}`
              : t("unitconversionqty");

function splitStock(
totalMinUnits: number,
convQty: number
) {
  if (!convQty ) {
    return { maxQty: 0, minQty: totalMinUnits };
  }

  const maxQty = Math.trunc(totalMinUnits / convQty);
  const minQty = totalMinUnits % convQty;

  return { maxQty, minQty };
}

    const textAlign = lang === "ur" ? "text-right" : "text-left";

  return (
    <div className="p-2 sm:p-4 lg:p-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-3 w-full sm:w-auto">
          <div className="text-lg font-semibold">{t("items")}</div>
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

             <button
                onClick={openDeletedModal}
                className="flex items-center gap-2 px-3 py-1 rounded bg-blue-600 hover:bg-blue-400 text-white "
              >
                <FaEye />{t("showDeleted")}
              </button>
        
          </div>
        </div>

        <div className="flex gap-2 w-full sm:w-auto flex-wrap">
          <div className="flex items-center bg-white rounded shadow px-2">
            <FaSearch className="text-gray-500" />
            <input
              className="p-2 outline-none w-48"
              placeholder={t("searchitems")}
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
            <FaPlus /> {t("createnew")}
          </button>
        </div>
      </div>

{showDeletedModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
    <div
      className="absolute inset-0 bg-black opacity-40"
      onClick={() => setShowDeletedModal(false)}
    />

    <div className="relative bg-white rounded-lg shadow-lg w-full max-w-lg p-6 z-50">

      <h3 className="text-lg font-semibold mb-4">
        {t("deletedItems")}
      </h3>

      {deletedItems.length === 0 ? (
        <div className="text-gray-500 text-center py-6">
          {t("noDeletedItems")}
        </div>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {deletedItems.map(i => (
            <div
              key={i.id}
              className="flex items-center justify-between border-b p-2"
            >
              <div>
                <div className="font-medium">{i.name}</div>
                <div className="text-xs text-gray-500">
                  {t("deleted")}:
                  {" "}
                  {i.deletedAt
                    ? new Date(i.deletedAt).toLocaleString()
                    : "-"}
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  className="p-2 rounded bg-green-100 hover:bg-green-200"
                  onClick={() => handleRestore(i.id)}
                  title={t("restore")}
                >
                  <FaUndo />
                </button>

                <button
                  className="p-2 rounded bg-red-100 hover:bg-red-200"
                  onClick={() => handlePermanentDelete(i.id)}
                  title={t("deletePermanently")}
                >
                  <FaTrash />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <button
          className="px-4 py-2 border rounded"
          onClick={() => setShowDeletedModal(false)}
        >
          {t("close")}
        </button>
      </div>

    </div>
  </div>
)}

      {/* Table / Cards */}
      {view === "table" ? (
  <div className="w-full overflow-x-auto bg-white rounded-xl shadow">
    <table className="w-full text-sm table-auto">
      <thead className="bg-blue-100 text-gray-700">
        <tr>
            <th className={`p-3 ${textAlign}`}>{t("name")}</th>

            <th className={`p-3 ${textAlign} hidden sm:table-cell`}>
              {t("barcode")}
            </th>

            <th className={`p-3 ${textAlign} hidden md:table-cell`}>
              {t("purchaseprice")}
            </th>

            <th className={`p-3 ${textAlign} hidden md:table-cell`}>
              {t("retailprice")}
            </th>

            <th className={`p-3 ${textAlign} hidden lg:table-cell`}>
              {t("discountprice")}
            </th>

            <th className={`p-3 ${textAlign} hidden lg:table-cell`}>
              {t("wholesaleprice")}
            </th>

            <th className={`p-3 ${textAlign}`}>
              {t("stock")}
            </th>

            <th className="p-3 text-center w-[120px]">
              {t("actions")}
            </th>
          </tr>
      </thead>

      <tbody>
        {items.map((it) => (
          <tr key={it.id} className="border-t hover:bg-gray-50 align-middle">

              {/* NAME */}
              <td className={`p-3 font-medium whitespace-nowrap ${textAlign}`}>
                {it.name}
              </td>

              {/* BARCODE */}
              <td className={`p-3 hidden sm:table-cell ${textAlign}`}>
                <div className={`flex items-center gap-2 ${textAlign === 'text-right' ? 'text-left' : 'justify-start'}`}>
                  <svg
                    ref={(el: SVGSVGElement | null) => {
                      svgRefs.current[it.id ?? it.barcode] = el ?? null;
                    }}
                    aria-hidden
                  />
                  <span className="text-xs text-gray-600 break-all">
                    {it.barcode}
                  </span>
                </div>
              </td>

              {/* PURCHASE */}
              <td className={`p-3 hidden md:table-cell ${textAlign}`}>
                {it.purchasePrice}
              </td>

              {/* RETAIL */}
              <td className={`p-3 hidden md:table-cell ${textAlign}`}>
                {it.retailPrice}
              </td>

              {/* DISCOUNT */}
              <td className={`p-3 hidden lg:table-cell ${textAlign}`}>
                {it.discountPrice || 0}
              </td>

              {/* WHOLESALE */}
              <td className={`p-3 hidden lg:table-cell ${textAlign}`}>
                {it.wholesalePrice}
              </td>

              {/* STOCK */}
              <td className={`p-3 text-blue-500 ${textAlign}`}>
                {(() => {
                  const { maxQty, minQty } = splitStock(it.availableStock, it.ConvQty);
                  return (
                    <div className="leading-tight">
                      { (
                        <div className="font-medium">{maxQty} {it.maxunit}s</div>
                      )}
                      { (
                        <div className="text-green-600 text-xs">
                          {minQty.toFixed(1)} {it.minunit}s
                        </div>
                      )}
                      {maxQty <= 0 && minQty <= 0 && (
                        <div className="text-red-500 text-xs">{t("outofstock")}</div>
                      )}
                    </div>
                  );
                })()}
              </td>

              {/* ACTIONS */}
              <td className="p-3">
                <div className="flex justify-center gap-2">
                  <button
                    onClick={() => openEdit(it)}
                    className="p-2 bg-blue-500 text-white rounded hover:bg-blue-600"
                  >
                    <FaEdit />
                  </button>

                  <button
                    onClick={() => handleDelete(it.id)}
                    className="p-2 bg-red-500 text-white rounded hover:bg-red-600"
                  >
                    <FaTrash />
                  </button>
                </div>
              </td>
            </tr>
        ))}

        {items.length === 0 && (
          <tr>
            <td colSpan={8} className="text-center p-6 text-gray-500">
              {t("noitemsfound")}
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
)  : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
  {items.map((it) => {
    const { maxQty, minQty } = splitStock(it.availableStock, it.ConvQty);

    return (
      <div
  key={it.id}
  className="bg-white rounded-xl shadow border p-4 flex flex-col justify-between hover:shadow-md transition"
>
  {/* HEADER + BARCODE */}
  <div className="mb-1">
    <div className="flex items-center gap-2">
      <FaBoxes className="text-indigo-600 text-lg" />
      <h3 className="font-semibold text-base leading-tight truncate">
        {it.name}
      </h3>
    </div>

    <div className="mt-1">
      <svg
        ref={(el: SVGSVGElement | null) => {
          svgRefs.current[it.id ?? it.barcode] = el ?? null;
        }}
        aria-hidden
      />
      <div className="text-[11px] text-gray-500 break-all">
        {it.barcode}
      </div>
    </div>
  </div>

  {/* DETAILS */}
  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
    <div>
      <span className="text-gray-500 text-xs">{t("brand")}</span>
      <div className="font-medium leading-tight">
        {brands.find(b => b.name === it.brand)?.name || "-"}
      </div>
    </div>

    <div>
      <span className="text-gray-500 text-xs">{t("category")}</span>
      <div className="font-medium leading-tight">
        {categories.find(c => c.name === it.category)?.name || "-"}
      </div>
    </div>

    <div>
      <span className="text-gray-500 text-xs">{t("minunit")}</span>
      <div className="leading-tight">{it.minunit}</div>
    </div>

    <div>
      <span className="text-gray-500 text-xs">{t("maxunit")}</span>
      <div className="leading-tight">{it.maxunit}</div>
    </div>

    <div>
      <span className="text-gray-500 text-xs">{t("conversion")}</span>
      <div className="leading-tight">{it.ConvQty}</div>
    </div>

    <div>
      <span className="text-gray-500 text-xs">{t("stock")}</span>
      <div className="leading-tight text-blue-600">
        {(() => {
          const { maxQty, minQty } = splitStock(it.availableStock, it.ConvQty);

          return (
            <>
              {maxQty > 0 && <div>{maxQty} {it.maxunit}s</div>}
              {minQty > 0 && (
                <div className="text-green-600 text-[11px]">
                  {minQty.toFixed(1)} {it.minunit}s
                </div>
              )}
              {maxQty === 0 && minQty === 0 && (
                <span className="text-red-500 text-[11px]">{t("outofstock")}</span>
              )}
            </>
          );
        })()}
      </div>
    </div>
  </div>

  {/* PRICES */}
  <div className="border-t mt-2 pt-2 text-sm grid grid-cols-2 gap-1">
    <div>
      <span className="text-gray-500 text-xs">{t("purchase")}</span>
      <div className="font-semibold">Rs. {it.purchasePrice}</div>
    </div>

    <div>
      <span className="text-gray-500 text-xs">{t("retail")}</span>
      <div className="font-semibold">Rs. {it.retailPrice}</div>
    </div>

    <div>
      <span className="text-gray-500 text-xs">{t("discount")}</span>
      <div className="font-semibold">Rs. {it.discountPrice || 0}</div>
    </div>

    <div>
      <span className="text-gray-500 text-xs">{t("wholesale")}</span>
      <div className="font-semibold">Rs. {it.wholesalePrice}</div>
    </div>
  </div>

  {/* DESCRIPTION */}
  {it.description && (
    <div className="mt-2 text-[11px] text-gray-600 border-t pt-2">
      {it.description}
    </div>
  )}

  {/* ACTIONS */}
  <div className="flex gap-2 mt-2">
    <button
      onClick={() => openEdit(it)}
      className="flex-1 bg-blue-500 hover:bg-blue-600 text-white py-2 rounded text-sm"
    >
      {t("edit")}
    </button>

    <button
      onClick={() => handleDelete(it.id)}
      className="flex-1 bg-red-500 hover:bg-red-600 text-white py-2 rounded text-sm"
    >
      {t("delete")}
    </button>
  </div>
</div>
    );
  })}
</div>
      )}

      {/* Pagination */}
      <div className="mt-4 flex justify-center gap-2 flex-wrap">
        <button
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
          className={`px-3 py-1 rounded ${page === 1 ? "bg-gray-300" : "bg-indigo-500 text-white"}`}
        >
          {t("prev")}
        </button>
        <span className="px-3 py-1 bg-gray-200 rounded">
          {t("page")} {page} / {totalPages}
        </span>
        <button
          disabled={page === totalPages}
          onClick={() => setPage(page + 1)}
          className={`px-3 py-1 rounded ${page === totalPages ? "bg-gray-300" : "bg-indigo-500 text-white"}`}
        >
          {t("next")}
        </button>
      </div>

      {/* Modal Form */}
      {isFormOpen && (
  <div className="fixed inset-0 bg-black bg-opacity-40 flex items-center justify-center p-4 z-50">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
      
      {/* HEADER */}
      <div className="p-4 border-b flex justify-between items-center">
        <h2 className="text-xl font-bold">{editingItem ? t("edititem") : t("createitem")}</h2>
        <button onClick={closeForm} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">&times;</button>
      </div>

      {/* SCROLLABLE FORM CONTENT */}
      <div className="p-4 overflow-y-auto flex-1">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">

          <div>
            <label className="block text-xs font-medium mb-1">{t("name")}</label>
            <input
              className="w-full p-2 border rounded"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">{t("barcode")}</label>
            <input
              className="w-full p-2 border rounded"
              value={form.barcode}
              onChange={(e) => setForm({ ...form, barcode: e.target.value })}
            />
          </div>

          {/* Brand */}
          <div>
            <select
              className="w-full p-2 border rounded"
              value={form.brand}
              onChange={(e) => setForm({ ...form, brand: e.target.value })}
            >
              <option value="">{t("selectbrand")}</option>
              {brands.map((b) => (
                <option key={b.id} value={b.name}>{b.name}</option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div>
            <select
              className="w-full p-2 border rounded"
              value={form.category}
              onChange={async (e) => {
                const selectedCategory = e.target.value;
                setForm(prev => ({ ...prev, category: selectedCategory }));

                if (selectedCategory.trim().toLowerCase() === "gas") {
                  const settings = await settingsRepository.get();
                  if (settings) {
                    const buy112 = Number(settings.cylBPrice) || 0;
                    const sell112 = Number(settings.cylSPrice) || 0;
                    const discount112 = Number(settings.cylDPrice) || 0;
                    const wholesale112 = Number(settings.cylWPrice) || 0;

                    const perKgBuy = +(buy112 / 11.8).toFixed(2);
                    const perKgSell = +(sell112 / 11.8).toFixed(2);
                    const perKgDiscount = +(discount112 / 11.8).toFixed(2);
                    const perKgWholesale = +(wholesale112 / 11.8).toFixed(2);

                    setForm(prev => ({
                      ...prev,
                      purchasePrice: perKgBuy,
                      retailPrice: perKgSell,
                      discountPrice: perKgDiscount,
                      wholesalePrice: perKgWholesale
                    }));
                  }
                } else {
                  setForm(prev => ({
                    ...prev,
                    purchasePrice: 0,
                    retailPrice: 0,
                    discountPrice: 0,
                    wholesalePrice: 0
                  }));
                }
              }}
            >
              <option value="">{t("selectcategory")}</option>
              {categories.map(c => (
                <option key={c.id} value={c.name}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Min Unit */}
          <div>
            <select
              className="w-full p-2 border rounded"
              value={form.minunit}
              onChange={(e) => setForm({ ...form, minunit: e.target.value })}
            >
              <option value="">{t("selectminunit")}</option>
              {units.map((u) => (
                <option key={u.id} value={u.name}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Max Unit */}
          <div>
            <select
              className="w-full p-2 border rounded"
              value={form.maxunit}
              onChange={(e) => setForm({ ...form, maxunit: e.target.value })}
            >
              <option value="">{t("selectmaxunit")}</option>
              {units.map((u) => (
                <option key={u.id} value={u.name}>{u.name}</option>
              ))}
            </select>
          </div>

          {/* Conversion Quantity */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">{conversionLabel}</label>
            <input
              type="number"
              className="w-full p-2 border rounded"
              value={form.ConvQty}
              onChange={(e) => setForm({ ...form, ConvQty: Number(e.target.value) })}
            />
          </div>

          {/* Prices */}
          <div>
            <label className="block text-xs font-medium mb-1">{form.minunit} {t("purchaseprice")}</label>
            <input
              type="number"
              className="w-full p-2 border rounded"
              value={form.purchasePrice}
              onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">{form.minunit} {t("retailprice")}</label>
            <input
              type="number"
              className="w-full p-2 border rounded"
              value={form.retailPrice}
              onChange={(e) => setForm({ ...form, retailPrice: Number(e.target.value) })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">{form.minunit} {t("discountprice")}</label>
            <input
              type="number"
              className="w-full p-2 border rounded"
              value={form.discountPrice}
              onChange={(e) => setForm({ ...form, discountPrice: Number(e.target.value) })}
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">{form.minunit} {t("wholesaleprice")}</label>
            <input
              type="number"
              className="w-full p-2 border rounded"
              value={form.wholesalePrice}
              onChange={(e) => setForm({ ...form, wholesalePrice: Number(e.target.value) })}
            />
          </div>

          {/* Stock */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">{t("openingstock")} ({form.minunit})</label>
            <input
              type="number"
              className="w-full p-2 border rounded"
              value={form.availableStock}
              onChange={(e) => setForm({ ...form, availableStock: Number(e.target.value) })}
            />
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium mb-1">{t("description")}</label>
            <textarea
              className="w-full p-2 border rounded"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </div>

        </div>
      </div>

      {/* ACTION BUTTONS */}
      <div className="p-4 border-t flex justify-end gap-2">
        <button onClick={closeForm} className="px-4 py-2 bg-gray-300 rounded">{t("cancel")}</button>
        <button onClick={handleSave} className="px-4 py-2 bg-indigo-600 text-white rounded">{t("save")}</button>
      </div>

    </div>
  </div>
)}
    </div>
  );
}
