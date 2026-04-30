// src/Dashboard.tsx
import React, { useState, useEffect, useRef,useMemo, JSX } from "react";
import {
  FaTachometerAlt,
  FaShoppingCart,
  FaUsers,
  FaUserTie,
  FaBoxes,
  FaTruck,
  FaReceipt,
  FaUndo,
  FaMoneyBill,
  FaChartBar,
  FaWarehouse,
  FaClipboardList,
  FaCog,
  FaDollarSign,
  FaShoppingBag,
  FaChartLine,
  FaWallet,
  FaBars,
  FaTimes,
  FaUserCircle,
  FaTags,
  FaListAlt,
  FaPercentage,
  FaThLarge,
  FaMoneyBillWave,
  FaChevronDown,
  FaChevronRight,
  FaChevronLeft,
  FaEdit,
  FaSignOutAlt,
  FaDatabase,
  FaProductHunt,
  FaKeyboard,
  FaSteam,
  FaBath,
  FaBacon,
} from "react-icons/fa";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

// Pages/components
import Staff from "./Staff";
import Customers from "./Customers";
import ItemsPage from "./Items";
import Categories from "./Categories";
import Brands from "./Brands";
import Units from "./Units";
import Discounts from "./Discounts";
import Taxes from "./Taxes";
import Suppliers from "./Suppliers";
import Expenses from "./Expenses";
import Settings from "./Settings";
import CustPayments from "./CustPayments";
import SupPayments from "./SupPayments";
import POS from "./POS";
import Invoices from "./Invoices";
import SalesReport from "./salesReport";
import ProdReport from "./prodReport";
import CustReport from "./custReport";
import SupReport from "./supReport";
import ExpReport from "./expReport";
import ProfReport from "./profReport";
import CFReport from "./CFReport";
import InvReport from "./invReport";
import CylindersQty from "./CylindersQty";
import CylindersPrices from "./CylindersPrices";

// DB helpers
import { authRepository } from "./repositories/authRepository";
import { settingsRepository } from "./repositories/settingsRepository";
import { staffRepository } from "./repositories/staffRepository";
import { salesRepository } from "./repositories/salesRepository";
import { customerPaymentRepository } from "./repositories/customerPaymentRepository";
import { supplierPaymentRepository } from "./repositories/supplierPaymentRepository";
import { expenseRepository } from "./repositories/expenseRepository";
import { useLang } from "./i18n/LanguageContext";

import type { User } from "./db";
import PurchaseReport from "./purReport";
import { FaFolderTree } from "react-icons/fa6";
// import ProdReport from "prodReport";

interface Props {
  user: {
    username: string;
    role: "admin" | "saleboy" |"Dev";
  };
  onLogout: () => void;
}

export default function Dashboard({ user, onLogout }: Props) {
  const [viewMode, setViewMode] = useState<"grid" | "stack">("stack");
  const [activeItem, setActiveItem] = useState(user.role === "saleboy" ? "POS" : "Dashboard");
  const [timeFilter, setTimeFilter] = useState<"Today" | "Weekly" | "Monthly" | "Yearly" | "Custom">("Today");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [businessName, setBusinessName] = useState<string>("");
  const [businessLogo, setBusinessLogo] = useState<string>("");
  const [reportsOpen, setReportsOpen] = useState(false);
  const [cylindersOpen, setCylindersOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editForm, setEditForm] = useState<Omit<User, "id">>({
  Name: "",
  Mobile: "",
  Role: "admin",
  Username: "",
  Password: "",
  isDeleted: false,
  deletedAt: null
});

  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const [cartHasItems, setCartHasItems] = useState(false);
  const desktopUserMenuRef = useRef<HTMLDivElement>(null);
  const mobileUserMenuRef = useRef<HTMLDivElement>(null);

  const [languageLoaded, setLanguageLoaded] = useState(false);

  const { t, lang, setLang } = useLang();

 const menuItems = useMemo(() => [
  { key: "dashboard", label: "dashboard", icon: <FaTachometerAlt className="text-blue-500" />, disabled: user?.role === "saleboy" },
  { key: "staff", label: "staff", icon: <FaUserTie className="text-yellow-500" />, disabled: user?.role === "saleboy" },
  { key: "customers", label: "customers", icon: <FaUsers className="text-green-500" />, disabled: user?.role === "saleboy" },
  { key: "suppliers", label: "suppliers", icon: <FaTruck className="text-red-500" />, disabled: user?.role === "saleboy" },
  { key: "entries", label: "entries", icon: <FaKeyboard className="text-blue-300" />, disabled: user?.role === "saleboy" },
  { key: "items", label: "items", icon: <FaBoxes className="text-yellow-300" />, disabled: user?.role === "saleboy" },
  { key: "sales", label: "sales", icon: <FaTruck className="text-green-300" />, disabled: user?.role === "saleboy" },
  { key: "cylinders", label: "cylinders", icon: <FaBath className="text-purple-500" />, disabled: user?.role === "saleboy" },
  { key: "payments", label: "payments", icon: <FaMoneyBill className="text-red-300" />, disabled: user?.role === "saleboy" },
  { key: "expenses", label: "expenses", icon: <FaDollarSign className="text-blue-400" />, disabled: user?.role === "saleboy" },
  { key: "reports", label: "reports", icon: <FaChartBar className="text-yellow-400" />, disabled: user?.role === "saleboy" },
  { key: "settings", label: "settings", icon: <FaCog className="text-red-400" />, disabled: user?.role === "saleboy" },
], [t, user?.role]);
  

  const timeFilters = ["Today", "Weekly", "Monthly","Yearly", "Custom"] as const;

  const getTimeFilterLabel = (filter: typeof timeFilters[number]) => {
  switch (filter) {
    case "Today":
      return t("time_today");
    case "Weekly":
      return t("time_weekly");
    case "Monthly":
      return t("time_monthly");
      case "Yearly":
      return t("time_yearly");
    case "Custom":
      return t("time_custom");
  }
};

  const [salesChartData, setSalesChartData] = useState<{ month: string; sales: number }[]>([]);

  const isWithinRange = (dateStr: string, start: Date, end: Date) => {
  const d = new Date(dateStr);
  return d >= start && d <= end;
  };

const getDateRange = (filter: string): { start: Date; end: Date } => {

const now = new Date();
let start: Date;
let end: Date = new Date(now);

switch (filter) {
  case "Daily":
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    break;

  case "Weekly": {
    // Monday as start of week (business standard)
    const day = now.getDay(); // 0=Sun, 1=Mon...
    const diff = now.getDate() - day + (day === 0 ? -6 : 1);

    start = new Date(now);
    start.setDate(diff);
    start.setHours(0, 0, 0, 0);
    break;
  }

  case "Monthly":
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    break;

  case "Yearly":
    start = new Date(now.getFullYear(), 0, 1);
    break;

  case "Custom":
    start = new Date(customStart);
    end = new Date(customEnd);
    end.setHours(23, 59, 59, 999);
    break;

  default:
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

  return { start, end };
};

const [kpis, setKpis] = useState({
  sales: 0,
  purchases: 0,
  customerReturns: 0,
  supplierReturns: 0,
  customerPayments: 0,
  supplierPayments: 0,
  expenses: 0,
  profit: 0,
});

const loadDashboardData = async () => {
  const { start, end } = getDateRange(timeFilter);

  const transactions = await salesRepository.getAllSales();
  const customerPayments = await customerPaymentRepository.getAll();
  const supplierPayments = await supplierPaymentRepository.getAll();
  const expenses = await expenseRepository.getAll();

  // ---- FILTER BY DATE ----
  const filteredTx = transactions.filter(t =>
    isWithinRange(t.date, start, end)
  );

  const filteredCustomerPayments = customerPayments.filter(p =>
    isWithinRange(p.paymentDate, start, end)
  );

  const filteredSupplierPayments = supplierPayments.filter(p =>
    isWithinRange(p.paymentDate, start, end)
  );

  const filteredExpenses = expenses.filter(e =>
    isWithinRange(e.date, start, end)
  );

  // ---- SALES ----
  const sales = filteredTx
    .filter(t => t.transactionType === "Sale")
    .reduce((sum, t) => sum + (t.subtotal - t.discount + t.tax), 0);

  // ---- PURCHASES ----
  const purchases = filteredTx
    .filter(t => t.transactionType === "Purchase")
    .reduce((sum, t) => sum + (t.subtotal - t.discount + t.tax), 0);

  // ---- RETURNS ----
  const customerReturns = filteredTx
    .filter(t =>
      t.transactionType === "Return" &&
      t.invoiceNo.startsWith("RET-C-")
    )
    .reduce((sum, t) => sum + (t.subtotal - t.discount + t.tax), 0);

  const supplierReturns = filteredTx
    .filter(t =>
      t.transactionType === "Return" &&
      t.invoiceNo.startsWith("RET-S-")
    )
    .reduce((sum, t) => sum + (t.subtotal - t.discount + t.tax), 0);

  // ---- PAYMENTS ----
  const totalCustomerPayments = filteredCustomerPayments
    .reduce((sum, p) => sum + p.amount, 0);

  const totalSupplierPayments = filteredSupplierPayments
    .reduce((sum, p) => sum + p.amount, 0);

  // ---- EXPENSES ----
  const totalExpenses = filteredExpenses
    .reduce((sum, e) => sum + e.amount, 0);

 // ---- PROFIT ----
const salesProfit = filteredTx
  .filter(t => t.transactionType === "Sale")
  .reduce((sum, t) => sum + t.profit, 0);

const customerReturnProfit = filteredTx
  .filter(t => t.transactionType === "Return" && t.invoiceNo.startsWith("RET-C-"))
  .reduce((sum, t) => sum + t.profit, 0);

const totalProfit = salesProfit + customerReturnProfit;

  setKpis({
    sales,
    purchases,
    customerReturns,
    supplierReturns,
    customerPayments: totalCustomerPayments,
    supplierPayments: totalSupplierPayments,
    expenses: totalExpenses,
    profit: totalProfit,
  });

  // ---- SALES CHART (CURRENT YEAR ONLY - INDEPENDENT) ----
const currentYear = new Date().getFullYear();

const months = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const salesByMonth: { month: string; sales: number }[] = months.map((m, i) => {
  const total = transactions   // 👈 IMPORTANT: use ALL transactions
    .filter(t => t.transactionType === "Sale")
    .filter(t => {
      const d = new Date(t.date);
      return d.getFullYear() === currentYear && d.getMonth() === i;
    })
    .reduce((sum, t) => sum + (t.subtotal - t.discount + t.tax), 0);

  return { month: m, sales: total };
});

setSalesChartData(salesByMonth);
};

const handleMenuClick = (key: string) => {
  if (key === activeItem) return;

  if (activeItem === "transactions" && key !== "transactions") {
    if (cartHasItems && !window.confirm("You have got items in the cart.Are you sure you want to leave the POS?")) return;
  }

  setActiveItem(key);
  if (sidebarOpen) setSidebarOpen(false);

  if (key === "dashboard") loadDashboardData();
};

// ----- STATE -----
const [showCustomModal, setShowCustomModal] = useState(false);

// ----- TRIGGER MODAL WHEN CUSTOM SELECTED -----
useEffect(() => {
  if (timeFilter === "Custom") {
    setShowCustomModal(true);
  }
}, [timeFilter]);

useEffect(() => {
  loadDashboardData();
}, [timeFilter, customStart, customEnd]);

 useEffect(() => {
  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target as Node;

    if (
      desktopUserMenuRef.current &&
      desktopUserMenuRef.current.contains(target)
    ) return;

    if (
      mobileUserMenuRef.current &&
      mobileUserMenuRef.current.contains(target)
    ) return;

    setUserMenuOpen(false);
  };

  document.addEventListener("mousedown", handleClickOutside);
  return () => document.removeEventListener("mousedown", handleClickOutside);
}, []);

  useEffect(() => {
  authRepository
    .getCurrentUser()
    .then(setCurrentUser)
    .catch((err) => {
      console.error("Failed to load current user", err);
      setCurrentUser(null);
    });
}, []);

useEffect(() => {
  const loadSettings = async () => {
    const settings = await settingsRepository.get();
    if (!settings) return;

    setBusinessName(settings.businessName || "My Business");
    setBusinessLogo(settings.logo || "/images/logo.png");

    // set activeItem only after settings are loaded
    setActiveItem("dashboard"); // or whatever your default key is
  };

  loadSettings();

  const handleSettingsUpdated = () => {
    loadSettings();
  };

  window.addEventListener("settingsUpdated", handleSettingsUpdated);

  return () => {
    window.removeEventListener("settingsUpdated", handleSettingsUpdated);
  };
}, []);

  const openEditCurrentUser = () => {
    if (!currentUser) { alert("No user is currently signed in."); return; }
    setEditForm({
      Name: currentUser.Name,
      Mobile: currentUser.Mobile,
      Role: currentUser.Role ?? "admin",
      Username: currentUser.Username,
      Password: currentUser.Password,
      isDeleted: currentUser.isDeleted,
      deletedAt: currentUser.deletedAt
    });
    setEditUserOpen(true);
    setUserMenuOpen(false);
  };

const saveEditedUser = async () => {
  if (!currentUser?.id) {
    alert("No user to update.");
    return;
  }

  if (!editForm.Name?.trim() || !editForm.Username?.trim()) {
    alert("Name and Username are required.");
    return;
  }

  try {
    const userToUpdate: User = {
      id: currentUser.id,
      Name: editForm.Name,
      Mobile: editForm.Mobile,
      Role: editForm.Role,
      Username: editForm.Username,
      Password: editForm.Password,
      isDeleted: editForm.isDeleted,
      deletedAt: editForm.deletedAt
    };

    await staffRepository.update(userToUpdate);

    // Reload the current user ONLY
    const refreshed = await authRepository.getCurrentUser();
    setCurrentUser(refreshed);

    setEditUserOpen(false);
    alert("User updated.");
  } catch (err) {
    console.error(err);
    alert("Failed to update user.");
  }
};

  const logout = () => {
    localStorage.removeItem("loggedInUserId");
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen bg-gray-100 relative">
      {/* MOBILE TOP BAR */}
    <div className="lg:hidden fixed top-0 inset-x-0 flex items-center justify-between bg-white shadow p-4 z-50 overflow-visible">
                  <h2 className="text-xl font-bold">{activeItem ? t(activeItem) : ""} </h2>

          <div className="flex items-center gap-3">
          <div className="relative" ref={mobileUserMenuRef}>
            <div className="flex items-center gap-1 cursor-pointer" onClick={() => setUserMenuOpen(!userMenuOpen)}>
              <FaUserCircle size={28} className="text-gray-700" />
              <span className="text-gray-700 font-medium">{currentUser ? currentUser.Name : "Guest"}</span>
            </div>
 {userMenuOpen && (
  <div
    className={`absolute top-full mt-1 bg-white shadow-lg rounded p-2 w-44 z-50
      ${lang === "ur" ? "left-0" : "right-0"}`}
  >
    {currentUser?.Role === "admin" && (
      <button
        onClick={openEditCurrentUser}
        className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"
      >
        <FaEdit /> {t("edituser")}
      </button>
    )}
    <button
      onClick={logout}
      className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"
    >
      <FaSignOutAlt /> {t("logout")}
    </button>
  </div>
)}
          </div>
          <button onClick={() => setSidebarOpen(true)}>
            <FaBars size={24} />
          </button>
        </div>
      </div>

{/* SIDEBAR */}
<aside
  className={`
    w-64 bg-white shadow-lg p-4
    fixed lg:static top-0 h-screen z-50 overflow-y-auto

    transform transition-transform duration-300 ease-in-out

    ${lang === "ur" ? "left-0" : "right-0"}

    ${
      sidebarOpen
        ? "translate-x-0"
        : lang === "ur"
        ? "-translate-x-full"
        : "translate-x-full"
    }

    lg:translate-x-0
  `}
>
  {/* Mobile Header */}
  <div className="flex justify-between items-center mb-4 lg:hidden">
    <h2 className="text-xl font-bold">{t("menu")}</h2>
    <button onClick={() => setSidebarOpen(false)}>
      <FaTimes size={24} />
    </button>
  </div>

  {/* Desktop Header */}
  <div className="flex items-center justify-between mb-4 hidden lg:flex">
    <h2 className="text-xl font-bold">{t("menu")}</h2>
  </div>

  {viewMode === "stack" ? (
    <ul className="space-y-2">
  {menuItems.map((item) => {
    const isDisabled = user?.role === "saleboy" && item.disabled;

    // Submenu button
    const SubMenuButton = ({
      name,
      icon,
      clickKey,
    }: {
      name: string;
      icon: JSX.Element;
      clickKey?: string;
    }) => (
      <li key={name}>
        <button
          onClick={() => !isDisabled && handleMenuClick(clickKey ?? name)}
          className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm ${
            isDisabled
              ? "text-gray-400 cursor-not-allowed"
              : activeItem === (clickKey ?? name)
              ? "bg-blue-100 text-blue-600 font-semibold shadow"
              : "text-gray-700 hover:bg-gray-100"
          }`}
        >
          {icon} {t(name)}
        </button>
      </li>
    );

    // Toggle button for collapsible items
    const CollapsibleButton = ({
      label,
      open,
      setOpen,
    }: {
      label: string;
      open: boolean;
      setOpen: (v: boolean) => void;
    }) => (
      <button
        onClick={() => !isDisabled && setOpen(!open)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-semibold ${
          isDisabled ? "text-gray-400 cursor-not-allowed" : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        <span className="flex items-center gap-3">{item.icon} {t(label)}</span>
        {open ? (
      <FaChevronDown />
      ) : lang === "ur" ? (
        <FaChevronLeft />
      ) : (
        <FaChevronRight />
      )}
      </button>
    );

    // Render each menu item with submenus
    switch (item.key) {
      case "entries":
        return (
          <li key="Entries">
            <CollapsibleButton label="entries" open={entriesOpen} setOpen={setEntriesOpen} />
            {entriesOpen && (
              <ul className="ml-6 mt-1 space-y-1">
                {[
                  { name: "categories", icon: <FaListAlt /> },
                  { name: "brands", icon: <FaTags /> },
                  { name: "units", icon: <FaThLarge /> },
                  { name: "discounts", icon: <FaPercentage /> },
                  { name: "taxes", icon: <FaMoneyBillWave /> },
                ].map((sub) => (
                  <SubMenuButton key={sub.name} {...sub} />
                ))}
              </ul>
            )}
          </li>
        );
      case "sales":
        return (
          <li key="Sales">
            <CollapsibleButton label="pos" open={posOpen} setOpen={setPosOpen} />
            {posOpen && (
              <ul className="ml-6 mt-1 space-y-1">
                <SubMenuButton name="transactions" icon={<FaReceipt />} />
                <SubMenuButton name="posinvoices" icon={<FaDatabase />} clickKey="posinvoices" />
                <SubMenuButton name="batchPurchase" icon={<FaFolderTree />} clickKey="batchPurchase" />

              </ul>
            )}
          </li>
        );
      case "payments":
        return (
          <li key="Payments">
            <CollapsibleButton label="payments" open={paymentsOpen} setOpen={setPaymentsOpen} />
            {paymentsOpen && (
              <ul className="ml-6 mt-1 space-y-1">
                <SubMenuButton name="customer" icon={<FaUsers />} clickKey="customer" />
                <SubMenuButton name="supplier" icon={<FaTruck />} clickKey="supplier" />
              </ul>
            )}
          </li>
        );
      case "reports":
        return (
          <li key="Reports">
            <CollapsibleButton label="reports" open={reportsOpen} setOpen={setReportsOpen} />
            {reportsOpen && (
              <ul className="ml-6 mt-1 space-y-1">
                {[
                  { name: "salesreport", icon: <FaChartLine color="red" /> },
                  { name: "productsReport", icon: <FaBoxes color="blue" /> },
                  { name: "customersreport", icon: <FaUsers color="green" /> },
                  { name: "suppliersreport", icon: <FaTruck color="blue" /> },
                  { name: "expensesreport", icon: <FaDollarSign color="red" /> },
                  { name: "cashflowreport", icon: <FaMoneyBill color="green" /> },
                  { name: "profitreport", icon: <FaMoneyBill color="green" /> },
                  { name: "inventoryreport", icon: <FaMoneyBill color="red" /> },
                ].map((sub) => (
                  <SubMenuButton key={sub.name} {...sub} />
                ))}
              </ul>
            )}
          </li>
        );
      case "cylinders":
        return (
          <li key="Cylinders">
            <CollapsibleButton label="cylinders" open={cylindersOpen} setOpen={setCylindersOpen} />
            {cylindersOpen && (
              <ul className="ml-6 mt-1 space-y-1">
                <SubMenuButton name="cylinders_qty" icon={<FaBoxes />} clickKey="cylinders_qty" />
                <SubMenuButton name="cylinder_prices" icon={<FaDollarSign />} clickKey="cylinder_prices" />
              </ul>
            )}
          </li>
        );
      default:
        return (
    <li
      key={item.key}
      onClick={() => !isDisabled && handleMenuClick(item.key)}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition ${
        isDisabled
          ? "text-gray-400 cursor-not-allowed"
          : activeItem === item.key
          ? "bg-blue-100 text-blue-600 font-semibold shadow cursor-pointer"
          : "text-gray-700 hover:bg-gray-100 cursor-pointer"
      }`}
    >
            <span className="text-lg">{item.icon}</span>
            <span className="text-sm font-medium">{t(item.key)}</span>
          </li>
        );
    }
  })}
</ul>
  ) : (
    <div className="grid grid-cols-3 gap-3">
      {menuItems.map((item) => (
        <div
          key={item.key}
          onClick={() => handleMenuClick(item.key)}
          className={`flex flex-col items-center p-2 rounded-lg cursor-pointer transition ${
            activeItem === item.key
              ? "bg-blue-100 text-blue-600 shadow"
              : "text-gray-700 hover:bg-gray-100"
          }`}
        >
          <span className="text-xl">{item.icon}</span>
          <span className="text-xs text-center"><span>{t(item.key)}</span></span>
        </div>
      ))}
    </div>
  )}
</aside>

{sidebarOpen && (
  <div
    className="fixed inset-0 bg-black/30 z-40 lg:hidden"
    onClick={() => setSidebarOpen(false)}
  />
)}
      {/* MAIN CONTENT */}
      <main className="flex-1 p-4 lg:p-4 flex-col gap-6 pt-20 lg:pt-6">
        {/* HEADER DESKTOP */}
        <div className="hidden lg:flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">{t(activeItem)}</h2>
          <div className="flex items-center gap-2 text-2xl font-serif font-semibold text-gray-500">
            {businessLogo && <img src={businessLogo} alt="Logo" className="h-8 w-8 rounded-md object-cover" />}
            <span>{businessName}</span>
          </div>
          <div className="relative" ref={desktopUserMenuRef}>
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setUserMenuOpen(!userMenuOpen)}>
              <FaUserCircle size={32} className="text-gray-700" />
              <span className="font-medium text-gray-700">{currentUser ? currentUser.Name : "Guest"}</span>
            </div>
           {userMenuOpen && (
  <div
    className={`absolute top-full mt-1 bg-white shadow-lg rounded p-2 w-44 z-50
      ${lang === "ur" ? "left-0" : "right-0"}`}
  >
    {currentUser?.Role === "admin" && (
      <button
        onClick={openEditCurrentUser}
        className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"
      >
        <FaEdit /> {t("edituser")}
      </button>
    )}
    <button
      onClick={logout}
      className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"
    >
      <FaSignOutAlt /> {t("logout")}
    </button>
  </div>
)}
          </div>
        </div>

        {/* Edit User Modal */}
        {editUserOpen && currentUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
              <h3 className="text-lg font-semibold mb-4">{t("edituser")}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">{t("name")}</label>
                  <input className="w-full p-2 border rounded" value={editForm.Name} onChange={(e) => setEditForm((p) => ({ ...p, Name: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-1 font-medium">{t("mobile")}</label>
                  <input className="w-full p-2 border rounded" value={editForm.Mobile} onChange={(e) => setEditForm((p) => ({ ...p, Mobile: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-1 font-medium">{t("role")}</label>
                  <select className="w-full p-2 border rounded" value={editForm.Role} onChange={(e) => setEditForm((p) => ({ ...p, Role: e.target.value }))}>
                    <option value="admin">{t("admin")}</option>
                    <option value="saleboy">{t("saleboy")}</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">{t("username")}</label>
                  <input className="w-full p-2 border rounded" value={editForm.Username} onChange={(e) => setEditForm((p) => ({ ...p, Username: e.target.value }))} />
                </div>
                <div className="md:col-span-2">
                  <label className="block mb-1 font-medium">{t("password")}</label>
                  <input className="w-full p-2 border rounded" value={editForm.Password} onChange={(e) => setEditForm((p) => ({ ...p, Password: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setEditUserOpen(false)} className="px-4 py-2 bg-gray-300 rounded">{t("cancel")}</button>
                <button onClick={() => saveEditedUser()} className="px-4 py-2 bg-indigo-600 text-white rounded">{t("save")}</button>
              </div>
            </div>
          </div>
        )}

        {/* CONDITIONAL PAGE RENDERING */}

        {user.role === "saleboy" ? (
          <POS currentUser={user} onCartStateChange={setCartHasItems} />
        ) : activeItem === "staff" ? (
          <Staff />
        ) : activeItem === "customers" ? (
          <Customers />
        ) : activeItem === "suppliers" ? (
          <Suppliers />
        ) : activeItem === "items" ? (
          <ItemsPage />
        ) : activeItem === "categories" ? (
          <Categories />
        ) : activeItem === "brands" ? (
          <Brands />
        ) : activeItem === "units" ? (
          <Units />
        ) : activeItem === "discounts" ? (
          <Discounts />
        ) : activeItem === "taxes" ? (
          <Taxes />
        ) : activeItem === "expenses" ? (
          <Expenses />
        ) : activeItem === "settings" ? (
          <Settings />
        ) : activeItem === "customer" ? (
          <CustPayments />
        ) : activeItem === "supplier" ? (
          <SupPayments />
        ) : activeItem === "transactions" ? (
          <POS currentUser={user} onCartStateChange={setCartHasItems} />
        ) : activeItem === "posinvoices" ? (
          <Invoices />
        ) : activeItem === "salesreport" ? (
          <SalesReport />
        ) : activeItem === "batchPurchase" ? (
          <PurchaseReport />
        ) : activeItem === "productsReport" ? (
          <ProdReport />
        ) : activeItem === "customersreport" ? (
          <CustReport />
        ) : activeItem === "suppliersreport" ? (
          <SupReport />
        ) : activeItem === "expensesreport" ? (
          <ExpReport />
        ) : activeItem === "cashflowreport" ? (
          <CFReport />
        ) : activeItem === "profitreport" ? (
          <ProfReport />
        )  : activeItem === "inventoryreport" ? (
          <InvReport />
        ) : activeItem === "cylinders_qty" ? (
          <CylindersQty />
        ) : activeItem === "cylinder_prices" ? (
          <CylindersPrices />
        ): (
          <>
            {/* Dashboard KPIs */}
            <div className="flex flex-wrap gap-2 mb-6">
            {timeFilters.map((filter) => {
              const label =
                filter === "Today"
                  ? t("time_today")
                  : filter === "Weekly"
                  ? t("time_weekly")
                  : filter === "Monthly"
                  ? t("time_monthly")
                  : filter ==="Yearly"
                  ? t("time_yearly")
                  : t("time_custom");

              return (
                <button
                  key={filter}
                  onClick={() => setTimeFilter(filter)}
                  className={`px-2 py-2 rounded-lg text-sm font-semibold transition ${
                    timeFilter === filter
                      ? "bg-blue-600 text-white shadow"
                      : "bg-gray-200 text-gray-700 hover:bg-gray-300"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

            {/* KPI ROW 1 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaDollarSign size={28} className="text-green-500" />
                <div>
                  <h3 className="text-sm font-medium">{t("sales")}</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.sales.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaDollarSign size={28} className="text-red-500" />
                <div>
                  <h3 className="text-sm font-medium">{t("purchases")}</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.purchases.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaUndo size={28} className="text-yellow-500" />
                <div>
                  <h3 className="text-sm font-medium">{t("customerreturns")}</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.customerReturns.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaUndo size={28} className="text-red-500" />
                <div>
                  <h3 className="text-sm font-medium">{t("supplierreturns")}</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.supplierReturns.toFixed()}</p>
                </div>
              </div>
            </div>

            {/* KPI ROW 2 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-6">
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaMoneyBill size={24} className="text-pink-500" />
                <div>
                  <h3 className="text-sm font-medium">{t("duesreceived")}</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.customerPayments.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaMoneyBill size={24} className="text-indigo-500" />
                <div>
                  <h3 className="text-sm font-medium">{t("duespaid")}</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.supplierPayments.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaDollarSign size={24} className="text-blue-500" />
                <div>
                  <h3 className="text-sm font-medium">{t("expenses")}</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.expenses.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaChartLine size={24} className="text-orange-500" />
                <div>
                  <h3 className="text-sm font-medium">{t("netprofit")}</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.profit.toFixed()}</p>
                </div>
              </div>
            </div>

            {/* Sales Chart */}
            <div className="bg-white p-4 rounded-lg shadow-lg mt-6">
              <h3 className="text-lg font-semibold mb-3">
                {t("salesoverview")} {new Date().getFullYear()}
              </h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={salesChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="sales" stroke="#8884d8" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Recent Orders
            <div className="bg-white p-4 rounded-lg shadow-lg mt-6">
              <h3 className="text-lg font-semibold mb-3">Recent Orders</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead>
                    <tr>
                      <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Order ID</th>
                      <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Customer</th>
                      <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Total</th>
                      <th className="px-3 py-2 text-left text-sm font-semibold text-gray-700">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {recentOrders.map((order) => (
                      <tr key={order.id}>
                        <td className="px-3 py-2 text-sm text-gray-700">{order.id}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">{order.customer}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">{order.total}</td>
                        <td className="px-3 py-2 text-sm text-gray-700">{order.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div> */}
          </>
        )}
      </main>

      {/* ----- CUSTOM DATE MODAL ----- */}
{/* ----- CUSTOM DATE MODAL ----- */}
{showCustomModal && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
    <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
      <h3 className="text-lg font-semibold mb-4">{t("selectdaterange")}</h3>
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="block mb-1 font-medium">{t("startdate")}</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
          />
        </div>
        <div>
          <label className="block mb-1 font-medium">{t("enddate")}</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={customEnd}
            onChange={(e) => setCustomEnd(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-3 mt-6">
        <button
          onClick={() => {
            setShowCustomModal(false);
            setTimeFilter("Today"); // optional reset
          }}
          className="px-4 py-2 bg-gray-300 rounded"
        >
          {t("cancel")}
        </button>
        <button
          onClick={() => {
            if (!customStart || !customEnd) {
              alert("Please select both start and end dates.");
              return;
            }
            setShowCustomModal(false); // close modal
            loadDashboardData();       // refresh dashboard
          }}
          className="px-4 py-2 bg-indigo-600 text-white rounded"
        >
          {t("ok")}
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
}
