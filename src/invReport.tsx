import React, { useEffect, useMemo, useState } from "react";
import { itemsRepository, Item } from "./repositories/itemsRepository";
import { useLang } from "./i18n/LanguageContext";

import {
  FaBoxOpen,
  FaShoppingCart,
  FaTag,
  FaPercent,
  FaWarehouse,
  FaCoins,
} from "react-icons/fa";

/* =====================================================
   TYPES
===================================================== */

type InventoryRow = {
  id: number;
  name: string;
  qty: number;
  convQty?: number;
  minunit?: string;
  maxunit?: string;
  purchaseValue: number;
  retailValue: number;
  discountValue: number;
  wholesaleValue: number;
};

/* =====================================================
   COMPONENT
===================================================== */

export default function InvReport() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const { t, lang, setLang } = useLang();
  
  /* =====================================================
     LOAD DATA
  ===================================================== */

  async function loadInventory() {
    setLoading(true);

    const items = await itemsRepository.getAll();

    const mapped: InventoryRow[] = items.map((item: Item) => {
      const qty = item.availableStock || 0;

      return {
        id: item.id!,
        name: item.name,
        qty,
         convQty: item.ConvQty,
        minunit: item.minunit,
        maxunit: item.maxunit,
        purchaseValue: qty * (item.purchasePrice || 0),
        retailValue: qty * (item.retailPrice || 0),
        discountValue: qty * (item.discountPrice || 0),
        wholesaleValue: qty * (item.wholesalePrice || 0),
      };
    });

    setRows(mapped);
    setLoading(false);
  }

  useEffect(() => {
    loadInventory();
  }, []);

  function formatAvailableQty(
  qty: number,
  convQty?: number,
  maxUnit?: string,
  minUnit?: string
) {
  if (!convQty || convQty <= 1) {
    // No conversion defined
    return `${qty}${minUnit ?? ""}`;
  }

  const max = Math.trunc(qty / convQty);
  const min = qty % convQty;

  if (max > 0 && min > 0)
    return `${max}${maxUnit} ${min}${minUnit}`;

  if (max > 0)
    return `${max}${maxUnit}`;

  return `${max}${maxUnit} ${min}${minUnit}`;
}

  /* =====================================================
     TOTALS
  ===================================================== */

  const totals = useMemo(() => {
    const purchase = rows.reduce((s, r) => s + r.purchaseValue, 0);
    const retail = rows.reduce((s, r) => s + r.retailValue, 0);
    const discount = rows.reduce((s, r) => s + r.discountValue, 0);
    const wholesale = rows.reduce((s, r) => s + r.wholesaleValue, 0);

    const zakat = retail * 0.025;

    return {
      purchase,
      retail,
      discount,
      wholesale,
      zakat,
    };
  }, [rows]);

  /* =====================================================
     HELPERS
  ===================================================== */

  const money = (n: number) =>
    n.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  /* =====================================================
     UI
  ===================================================== */

      const textAlign = lang === "ur" ? "text-right" : "text-left";

  return (
    <div className="p-4 space-y-6">

      {/* ================= SUMMARY CARDS ================= */}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">

        <SummaryCard
          title={t("purchaseValue")}
          value={money(totals.purchase)}
          icon={<FaShoppingCart size={22} />}
          color="bg-blue-500"
        />

        <SummaryCard
          title={t("retailValue")}
          value={money(totals.retail)}
          icon={<FaTag size={22} />}
          color="bg-green-500"
        />

        <SummaryCard
          title={t("discountValue")}
          value={money(totals.discount)}
          icon={<FaPercent size={22} />}
          color="bg-orange-500"
        />

        <SummaryCard
          title={t("wholesaleValue")}
          value={money(totals.wholesale)}
          icon={<FaWarehouse size={22} />}
          color="bg-purple-500"
        />

        <SummaryCard
          title={t("totalZakat")}
          value={money(totals.zakat)}
          icon={<FaCoins size={22} />}
          color="bg-emerald-600"
        />

      </div>

      {/* ================= TABLE ================= */}

      <div className="bg-white dark:bg-gray-900 rounded-xl shadow overflow-x-auto">

        <table className="w-full text-sm table-auto">

          <thead className="bg-blue-100 dark:bg-gray-800">
            <tr className="text-left">
              <th className={` p-2 sm:p-3 ${textAlign}`}>{t("item")}</th>
              <th className={` p-2 sm:p-3 ${textAlign}`}>{t("availableQty")}</th>
              <th className={`hidden sm:table-cell p-2 sm:p-3 ${textAlign}`}>{t("purchaseValue")}</th>
              <th className={` p-2 sm:p-3 ${textAlign}`}>{t("retailValue")}</th>
              <th className={`hidden sm:table-cell p-2 sm:p-3 ${textAlign}`}>{t("discountValue")}</th>
              <th className={`hidden sm:table-cell p-2 sm:p-3 ${textAlign}`}>{t("wholesaleValue")}</th>
            </tr>
          </thead>

          <tbody>

            {loading ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-sm sm:text-base">
                  {t("loadingInventory")}
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="p-4 text-center text-sm sm:text-base">
                  {t("noInventoryFound")}
                </td>
              </tr>
            ) : (
              rows.map(row => (
                <tr
                  key={row.id}
                  className="border-t dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <td className="p-2 sm:p-3 flex items-center gap-1 sm:gap-2 font-medium">
                    <FaBoxOpen size={14} />
                    {row.name}
                  </td>

                  <td>
                    {formatAvailableQty(
                        row.qty ?? 0,
                        row.convQty,
                        row.maxunit,
                        row.minunit
                    )}
                    </td>

                  <td className="hidden sm:table-cell p-2 sm:p-3">{money(row.purchaseValue)}</td>
                  <td className="p-2 sm:p-3">{money(row.retailValue)}</td>
                  <td className="hidden sm:table-cell p-2 sm:p-3">{money(row.discountValue)}</td>
                  <td className="hidden sm:table-cell p-2 sm:p-3">{money(row.wholesaleValue)}</td>
                </tr>
              ))
            )}

          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =====================================================
   SUMMARY CARD COMPONENT
===================================================== */

function SummaryCard({
  title,
  value,
  icon,
  color,
}: {
  title: string;
  value: string;
  icon: React.ReactNode;
  color: string;
}) {
  return (
    <div className="rounded-xl shadow bg-white dark:bg-gray-900 p-4 flex items-center gap-4">

      <div className={`p-2 sm:p-3 rounded-lg text-white flex items-center justify-center ${color}`}>
        {icon}
      </div>

      <div>
        <p className="text-xs text-gray-500">{title}</p>
        <p className="text-lg font-semibold">{value}</p>
      </div>
    </div>
  );
}