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
  const data = await batchRepository.getBatchesByItem(itemId);
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
    <div style={{ padding: "20px" }}>
      {/* <h2>Purchase Batch Report</h2> */}

      {/* ===================== CARDS ===================== */}
     <div style={{ display: "flex", gap: "15px", marginBottom: "20px" }}>
  
  <Card
    title="Active Batches"
    value={stats.activeBatches}
    icon={<FaBoxes size={26} />}
    color="#3b82f6" // blue
  />

  <Card
    title="Total Qty"
    value={stats.totalQty}
    icon={<FaLayerGroup size={26} />}
    color="#10b981" // green
  />

  <Card
    title="Utilized Qty"
    value={stats.utilizedQty}
    icon={<FaCheckCircle size={26} />}
    color="#f59e0b" // amber
  />

  <Card
    title="Balance Qty"
    value={stats.balanceQty}
    icon={<FaBalanceScale size={26} />}
    color="#ef4444" // red
  />

</div>

      {/* ===================== CONTROLS ===================== */}
      <div
        style={{
          display: "",
          justifyContent: "space-between",
          marginBottom: "15px",
        }}
      >
        {/* Dropdown */}
        Select Item : 
        <select
          value={selectedItemId ?? ""}
          onChange={(e) => setSelectedItemId(Number(e.target.value))}
          style={{ padding: "6px", minWidth: "200px" }}
        >
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>

        {/* Buttons */}
        {/* <div style={{ display: "flex", gap: "10px" }}>
          <button
  onClick={printPDF}
  style={{
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    cursor: "pointer",
  }}
>
  <FaFilePdf color="red" />
  PDF
</button>

<button
  onClick={exportCSV}
  style={{
    display: "flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 10px",
    cursor: "pointer",
  }}
>
  <FaFileExcel color="green" />
  Excel
</button>
        </div> */}
      </div>

      {/* ===================== TABLE ===================== */}
      <table
        border={1}
        cellPadding={8}
        cellSpacing={0}
        width="100%"
      >
        <thead>
          <tr>
            <th className={`p-3 ${textAlign}`}>Item</th>
            <th className={`p-3 ${textAlign}`}>Purchase Date</th>
            <th className={`p-3 ${textAlign}`}>Qty Purchased</th>
            <th className={`p-3 ${textAlign}`}>Qty Utilized</th>
            <th className={`p-3 ${textAlign}`}>Balance</th>
            <th className={`p-3 ${textAlign}`}>Purchase Price</th>
            <th className={`p-3 ${textAlign}`}>Invoice No</th>
          </tr>
        </thead>

        <tbody>
          {batches.length === 0 ? (
            <tr>
              <td colSpan={6} style={{ textAlign: "center" }}>
                No batches found
              </td>
            </tr>
          ) : (
            batches.map((b, i) => (
              <tr key={i}>
                <td className={`p-3 ${textAlign}`}>{b.itemName}</td>
                <td className={`p-3 ${textAlign}`}>{new Date(b.purchaseDate).toLocaleDateString()}</td>
                <td className={`p-3 ${textAlign}`}>{b.qtyPurchased}</td>
                <td className={`p-3 ${textAlign}`}>{b.qtySold}</td>
                <td className={`p-3 ${textAlign}`}>{b.balance}</td>
                <td className={`p-3 ${textAlign}`}>{b.purchasePrice}</td>
                <td>{b.invoiceNo ?? "-"}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
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
      style={{
        flex: 1,
        padding: "16px",
        borderRadius: "12px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        background: `${color}15`, // light background tint
        border: `1px solid ${color}30`,
      }}
    >
      {/* ICON BOX */}
      <div
        style={{
          width: "45px",
          height: "45px",
          borderRadius: "10px",
          background: color,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "white",
        }}
      >
        {icon}
      </div>

      {/* TEXT */}
      <div>
        <div style={{ fontSize: "13px", color: "#555" }}>{title}</div>
        <div style={{ fontSize: "20px", fontWeight: "bold" }}>{value}</div>
      </div>
    </div>
  );
};

export default PurchaseReport;
