import React, { useEffect, useMemo, useState } from "react";
import {
  FaBalanceScale,
  FaBoxes,
  FaCreditCard,
  FaEye,
  FaMoneyBillWave,
  FaUsers,
} from "react-icons/fa";
import { cylinderCustomerRepository } from "./repositories/cylinderCustomerRepository";
import { customersRepository } from "./repositories/customerRepository";
import type { Customer, CylinderCustomer } from "./types/entities";
import { useLang } from "./i18n/LanguageContext";

type CustomerCylinderSummary = {
  customerName: string;
  totalQty: number;
  payable: number;
  paid: number;
  balance: number;
  types: {
    cylinderType: string;
    qtyHeld: number;
  }[];
};

const PAGE_SIZE = 10;

function normalizeCustomerName(name: string) {
  return name.trim().toLocaleLowerCase();
}

function getAccountValues(customer?: Customer) {
  const payable = Number(customer?.payable ?? 0);
  const paid = Number(customer?.paid ?? 0);

  return {
    payable,
    paid,
    balance: Number(customer?.balance ?? payable - paid),
  };
}

export default function CustomerCylinders() {
  const [rows, setRows] = useState<CustomerCylinderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [selectedCustomer, setSelectedCustomer] =
    useState<CustomerCylinderSummary | null>(null);

  const { t, lang } = useLang();
  const textAlign = lang === "ur" ? "text-right" : "text-left";
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  const pagedRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return rows.slice(start, start + PAGE_SIZE);
  }, [page, rows]);

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  async function loadData() {
    setLoading(true);

    try {
      const [data, customers] = await Promise.all([
        cylinderCustomerRepository.getAll(),
        customersRepository.getAll(),
      ]);
      const active = data.filter(
        (cc: CylinderCustomer) => !cc.isDeleted && Number(cc.qtyHeld || 0) > 0
      );

      const customersByName = new Map<string, Customer[]>();
      customers.forEach((customer) => {
        const key = normalizeCustomerName(customer.name);
        const matches = customersByName.get(key) ?? [];
        matches.push(customer);
        customersByName.set(key, matches);
      });

      const grouped = new Map<string, CustomerCylinderSummary>();

      active.forEach((cc) => {
        const customerName = cc.customerName?.trim() || "Unknown Customer";
        const customerMatches =
          customersByName.get(normalizeCustomerName(customerName)) ?? [];
        const account = getAccountValues(
          customerMatches.length === 1 ? customerMatches[0] : undefined
        );
        const cylinderType = cc.cylinderType?.trim() || t("cylinder");
        const qtyHeld = Number(cc.qtyHeld || 0);

        if (!grouped.has(customerName)) {
          grouped.set(customerName, {
            customerName,
            totalQty: 0,
            ...account,
            types: [],
          });
        }

        const customer = grouped.get(customerName)!;
        const existingType = customer.types.find(
          (type) => type.cylinderType === cylinderType
        );

        if (existingType) {
          existingType.qtyHeld += qtyHeld;
        } else {
          customer.types.push({ cylinderType, qtyHeld });
        }

        customer.totalQty += qtyHeld;
      });

      const summaries = Array.from(grouped.values())
        .map((customer) => ({
          ...customer,
          types: customer.types.sort((a, b) =>
            a.cylinderType.localeCompare(b.cylinderType)
          ),
        }))
        .sort((a, b) => a.customerName.localeCompare(b.customerName));

      setRows(summaries);
      setPage(1);
    } catch (error) {
      console.error("Error loading customer cylinders:", error);
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return <p className="text-center p-4">{t("loading")}</p>;
  }

  const totals = rows.reduce(
    (summary, row) => ({
      cylinders: summary.cylinders + row.totalQty,
      payable: summary.payable + row.payable,
      paid: summary.paid + row.paid,
      balance: summary.balance + row.balance,
    }),
    { cylinders: 0, payable: 0, paid: 0, balance: 0 }
  );

  return (
    <div className="p-4 sm:p-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 mb-5">
        <SummaryCard
          title={t("totalcustomers")}
          value={rows.length}
          icon={<FaUsers size={26} className="text-indigo-600" />}
        />
        <SummaryCard
          title={t("total_customer_cylinders")}
          value={totals.cylinders}
          icon={<FaBoxes size={26} className="text-blue-600" />}
        />
        <SummaryCard
          title={t("payable")}
          value={totals.payable}
          icon={<FaMoneyBillWave size={26} className="text-amber-600" />}
        />
        <SummaryCard
          title={t("paid")}
          value={totals.paid}
          icon={<FaCreditCard size={26} className="text-emerald-600" />}
        />
        <SummaryCard
          title={t("balance")}
          value={totals.balance}
          icon={<FaBalanceScale size={26} className="text-rose-600" />}
        />
      </div>

      <div className="overflow-x-auto bg-white rounded-lg shadow">
        <table className="min-w-full text-sm">
          <thead className="bg-blue-100 text-gray-700">
            <tr>
              <th className={`p-3 ${textAlign}`}>{t("customername")}</th>
              {/* <th className={`p-3 ${textAlign}`}>{t("type")}</th> */}
              <th className={`p-3 ${textAlign}`}>{t("total_customer_cylinders")}</th>
              <th className={`p-3 ${textAlign}`}>{t("payable")}</th>
              <th className={`p-3 ${textAlign}`}>{t("paid")}</th>
              <th className={`p-3 ${textAlign}`}>{t("balance")}</th>
              <th className="p-3 text-center">{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center p-4 text-gray-500">
                  {t("nocustomercylindersfound")}
                </td>
              </tr>
            ) : (
              pagedRows.map((row) => (
                <tr key={row.customerName} className="border-b hover:bg-gray-50">
                  <td className={`p-3 font-medium ${textAlign}`}>
                    {row.customerName}
                  </td>
                  {/* <td className={`p-3 ${textAlign}`}>
                    {row.types.map((type) => type.cylinderType).join(", ")}
                  </td> */}
                  <td className={`p-3 ${textAlign}`}>{row.totalQty}</td>
                  <td className={`p-3 ${textAlign}`}>{row.payable}</td>
                  <td className={`p-3 ${textAlign}`}>{row.paid}</td>
                  <td className={`p-3 ${textAlign}`}>{row.balance}</td>
                  <td className="p-3">
                    <div className="flex justify-center">
                      <button
                        onClick={() => setSelectedCustomer(row)}
                        title={t("view_customer_cylinder_types")}
                        className="p-2 text-blue-600 hover:bg-blue-100 rounded"
                      >
                        <FaEye size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 flex justify-center gap-2 flex-wrap">
        <button
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
          className={`px-3 py-1 rounded ${
            page === 1 ? "bg-gray-300" : "bg-indigo-500 text-white"
          }`}
        >
          {t("prev")}
        </button>
        <span className="px-3 py-1 bg-gray-200 rounded">
          {t("page")} {page} / {totalPages}
        </span>
        <button
          disabled={page === totalPages}
          onClick={() => setPage(page + 1)}
          className={`px-3 py-1 rounded ${
            page === totalPages ? "bg-gray-300" : "bg-indigo-500 text-white"
          }`}
        >
          {t("next")}
        </button>
      </div>

      {selectedCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-6 max-w-md w-full">
            <h3 className="text-lg font-semibold mb-4">
              {t("customer_cylinders")} - {selectedCustomer.customerName}
            </h3>

            <div className="grid grid-cols-3 gap-2 mb-4 text-center">
              <AccountValue label={t("payable")} value={selectedCustomer.payable} />
              <AccountValue label={t("paid")} value={selectedCustomer.paid} />
              <AccountValue label={t("balance")} value={selectedCustomer.balance} />
            </div>

            <div className="space-y-2 max-h-96 overflow-y-auto">
              {selectedCustomer.types.map((type) => (
                <div
                  key={type.cylinderType}
                  className="p-3 bg-gray-50 rounded border flex items-center justify-between gap-3"
                >
                  <p className="font-medium">{type.cylinderType}</p>
                  <p className="text-sm text-gray-600">
                    {t("qty_held")}: {type.qtyHeld}
                  </p>
                </div>
              ))}
            </div>

            <button
              onClick={() => setSelectedCustomer(null)}
              className="mt-4 w-full px-4 py-2 bg-gray-300 text-gray-800 rounded hover:bg-gray-400"
            >
              {t("close")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AccountValue({ label, value }: { label: string; value: number }) {
  return (
    <div className="p-2 bg-gray-50 border rounded">
      <p className="text-xs text-gray-600">{label}</p>
      <p className="font-semibold">{value}</p>
    </div>
  );
}

function SummaryCard({
  title,
  value,
  icon,
}: {
  title: string;
  value: string | number;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-4 rounded-lg bg-white shadow-md flex items-center gap-3">
      {icon}
      <div>
        <p className="text-sm text-gray-600">{title}</p>
        <p className="text-2xl font-bold">{value}</p>
      </div>
    </div>
  );
}
