import React, { useEffect, useState } from "react";
import { itemsRepository } from "./repositories/itemsRepository";
import { batchRepository } from "./repositories/batchRepository";
import type { Item } from "@/db"; // adjust path if needed
import type { ItemBatch } from "./repositories/batchRepository";
import { FaBoxes, FaLayerGroup, FaCheckCircle, FaBalanceScale, FaFilePdf, FaFileExcel} from "react-icons/fa";
import { useLang } from "./i18n/LanguageContext";

/* ==========================================================
   TYPES
   ========================================================== */
interface Batch {
  id?: number;
  itemId: number;
  itemName: string;
  purchaseDate: string;
  qtyPurchased: number;
  qtySold: number;
  balance: number;
  purchasePrice: number;
  invoiceNo: string;
}

/* ==========================================================
   COMPONENT
   ========================================================== */
const PurchaseReport: React.FC = () => {

  const [items, setItems] = useState<Item[]>([]);
  const [selectedItemId, setSelectedItemId] = useState<number | null>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [initialized, setInitialized] = useState(false);
  const [stats, setStats] = useState({
    activeBatches: 0,
    totalQty: 0,
    utilizedQty: 0,
    balanceQty: 0,
  });

    const { t, lang, setLang } = useLang();
  
  /* ==========================================================
     LOAD ITEMS
     ========================================================== */
  useEffect(() => {
    loadItems();
  }, []);

  const loadItems = async () => {
  const data = await itemsRepository.getAll();
  setItems(data);
};

  /* ==========================================================
     LOAD BATCHES
     ========================================================== */
  useEffect(() => {
    if (selectedItemId) {
      loadBatches(selectedItemId);
    }
  }, [selectedItemId]);

  useEffect(() => {
  if (!initialized && items.length > 0) {
    setSelectedItemId(items[0].id!);
    setInitialized(true);
  }
}, [items, initialized]);

const loadBatches = async (itemId: number) => {
  const data = (await batchRepository.getBatchesByItem(itemId))
  .filter(b => b.balance > 0);
  
  const items = await itemsRepository.getAll();

  const itemMap = new Map(items.map(i => [i.id, i.name]));

  const mapped: Batch[] = data.map((b: ItemBatch) => ({
    id: b.id,
    itemId: b.itemId,
    purchaseDate: b.purchaseDate,
    qtyPurchased: b.qtyPurchased,
    qtySold: b.qtySold,
    balance: b.balance,

    // ✅ REAL NAME FROM MASTER DATA
    itemName: itemMap.get(b.itemId) || "Unknown Item",

    // costPrice → your DB field is correct
    purchasePrice: b.costPrice,
    invoiceNo: b.invoiceNo,
  }));

  setBatches(mapped);
  calculateStats(mapped);
};

  /* ==========================================================
     CALCULATE CARDS
     ========================================================== */
  const calculateStats = (data: Batch[]) => {
    let activeBatches = 0;
    let totalQty = 0;
    let utilizedQty = 0;
    let balanceQty = 0;

    data.forEach((b) => {
      if (b.balance > 0) activeBatches++;
      totalQty += b.qtyPurchased;
      utilizedQty += b.qtySold;
      balanceQty += b.balance;
    });

    setStats({
      activeBatches,
      totalQty,
      utilizedQty,
      balanceQty,
    });
  };

  /* ==========================================================
     EXPORT CSV (EXCEL)
     ========================================================== */
  const exportCSV = () => {
    let csv = "Item,Purchase Date,Qty Purchased,Qty Utilized,Balance,Price\n";

    batches.forEach((b) => {
      csv += `${b.itemName},${b.purchaseDate},${b.qtyPurchased},${b.qtySold},${b.balance},${b.purchasePrice}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "purchase_report.csv";
    a.click();
  };

  /* ==========================================================
     PRINT PDF
     ========================================================== */
  const printPDF = () => {
    window.print();
  };

      const textAlign = lang === "ur" ? "text-right" : "text-left";

  /* ==========================================================
     UI
     ========================================================== */
  return (
    <div className="p-4 sm:p-6">
      {/* SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
  
        <Card
          title={t("activebatches")}
          value={stats.activeBatches}
          icon={<FaBoxes size={26} />}
          color="#3b82f6"
        />

        <Card
          title={t("totalqty")}
          value={stats.totalQty}
          icon={<FaLayerGroup size={26} />}
          color="#10b981"
        />

        <Card
          title={t("utilizedqty")}
          value={stats.utilizedQty}
          icon={<FaCheckCircle size={26} />}
          color="#f59e0b"
        />

        <Card
          title={t("balanceqty")}
          value={stats.balanceQty}
          icon={<FaBalanceScale size={26} />}
          color="#ef4444"
        />

      </div>

      {/* FILTER BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 mb-4 flex-wrap">
        <label className="font-medium">{t("selectitem")}:</label>
        <select
          value={selectedItemId ?? ""}
          onChange={(e) => setSelectedItemId(Number(e.target.value))}
          className="border rounded px-3 py-1 flex-1 sm:flex-auto"
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        <div className="flex gap-2 sm:ml-auto">
          <FaFilePdf
            size={22}
            color="#dc2626"
            title={t("exportpdf")}
            className="cursor-pointer hover:opacity-75"
            onClick={printPDF}
          />
          <FaFileExcel
            size={22}
            color="#16a34a"
            title={t("exportexcel")}
            className="cursor-pointer hover:opacity-75"
            onClick={exportCSV}
          />
        </div>
      </div>
<p className="text-center text-gray-400">( Qtys are in Min Unit )</p>
      {/* TABLE */}
      <div className="overflow-x-auto">
        <table className="w-full text-left border">
          <thead className="bg-blue-100">
            <tr>
              <th className={`px-2 py-2 sm:px-4 border ${textAlign}`}>{t("item")}</th>
              <th className={`px-2 py-2 sm:px-4 border hidden sm:table-cell ${textAlign}`}>{t("purchasedate")}</th>
              <th className={`px-2 py-2 sm:px-4 border hidden md:table-cell ${textAlign}`}>{t("qtypurchased")}</th>
              <th className={`px-2 py-2 sm:px-4 border hidden lg:table-cell ${textAlign}`}>{t("qtysold")}</th>
              <th className={`px-2 py-2 sm:px-4 border hidden lg:table-cell ${textAlign}`}>{t("balance")}</th>
              <th className={`px-2 py-2 sm:px-4 border hidden lg:table-cell ${textAlign}`}>{t("purchaseprice")}</th>
              <th className={`px-2 py-2 sm:px-4 border hidden lg:table-cell ${textAlign}`}>{t("invoiceno")}</th>
            </tr>
          </thead>

          <tbody>
            {batches.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-3 text-center text-gray-500">
                  {t("nobatchesfound")}
                </td>
              </tr>
            ) : (
              batches.map((b, i) => (
                <tr key={i} className="border-b hover:bg-gray-50">
                  <td className={`px-2 py-2 sm:px-4 font-medium ${textAlign}`}>{b.itemName}</td>
                  
                  <td className={`px-2 py-2 sm:px-4 hidden sm:table-cell ${textAlign}`}>
                    {new Date(b.purchaseDate).toLocaleDateString()}
                  </td>
                  
                  <td className={`px-2 py-2 sm:px-4 hidden md:table-cell ${textAlign}`}>{b.qtyPurchased}</td>
                  
                  <td className={`px-2 py-2 sm:px-4 hidden lg:table-cell ${textAlign}`}>{b.qtySold}</td>
                  
                  <td className={`px-2 py-2 sm:px-4 hidden lg:table-cell ${textAlign}`}>{b.balance}</td>
                  
                  <td className={`px-2 py-2 sm:px-4 hidden lg:table-cell ${textAlign}`}>{b.purchasePrice.toFixed(2)}</td>
                  
                  <td className={`px-2 py-2 sm:px-4 hidden lg:table-cell ${textAlign}`}>{b.invoiceNo ?? "-"}</td>

                  {/* MOBILE STACKED VIEW */}
                  <td className={`px-2 py-2 sm:hidden flex flex-col text-xs text-gray-600 gap-1 ${textAlign}`}>
                    <span className="font-semibold text-gray-800">{new Date(b.purchaseDate).toLocaleDateString()}</span>
                    <span>Qty Purchased: {b.qtyPurchased}</span>
                    <span>Qty Sold: {b.qtySold}</span>
                    <span>Balance: {b.balance}</span>
                    <span>Price: {b.purchasePrice.toFixed(2)}</span>
                    <span>Invoice: {b.invoiceNo ?? "-"}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ==========================================================
   CARD COMPONENT
   ========================================================== */
const Card = ({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: number;
  icon?: React.ReactNode;
  color?: string;
}) => {
  return (
    <div
      className="p-4 rounded-lg bg-white shadow-md flex items-center gap-3 hover:shadow-lg transition"
      style={{ borderLeft: `4px solid ${color}` }}
    >
      {/* ICON BOX */}
      <div
        className="flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center"
        style={{ backgroundColor: color, opacity: 0.9 }}
      >
        <div style={{ color: "white" }}>{icon}</div>
      </div>

      {/* TEXT */}
      <div className="flex-1">
        <div className="text-xs sm:text-sm text-gray-600">{title}</div>
        <div className="text-lg sm:text-2xl font-bold text-gray-900">{value}</div>
      </div>
    </div>
  );
};

export default PurchaseReport;
