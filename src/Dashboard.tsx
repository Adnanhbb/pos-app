// src/Dashboard.tsx
import React, { useState, useEffect, useRef } from "react";
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
  FaEdit,
  FaSignOutAlt,
  FaDatabase,
  FaProductHunt,
  FaKeyboard,
  FaSteam,
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

// DB helpers
import { authRepository } from "./repositories/authRepository";
import { settingsRepository } from "./repositories/settingsRepository";
import { staffRepository } from "./repositories/staffRepository";
import { salesRepository } from "./repositories/salesRepository";
import { customerPaymentRepository } from "./repositories/customerPaymentRepository";
import { supplierPaymentRepository } from "./repositories/supplierPaymentRepository";
import { expenseRepository } from "./repositories/expenseRepository";

import type { User } from "./db";
// import ProdReport from "prodReport";

// Sample Data
const salesData = [
  { month: "Jan", sales: 4000 },
  { month: "Feb", sales: 3000 },
  { month: "Mar", sales: 5000 },
  { month: "Apr", sales: 4000 },
  { month: "May", sales: 6000 },
  { month: "Jun", sales: 7000 },
];

const recentOrders = [
  { id: 1, customer: "John Doe", total: "$120", status: "Completed" },
  { id: 2, customer: "Jane Smith", total: "$80", status: "Pending" },
  { id: 3, customer: "Bob Johnson", total: "$200", status: "Completed" },
  { id: 4, customer: "Alice Brown", total: "$50", status: "Cancelled" },
];

interface Props {
  user: {
    username: string;
    role: "admin" | "saleboy";
  };
  onLogout: () => void;
}

export default function Dashboard({ user, onLogout }: Props) {
  const [viewMode, setViewMode] = useState<"grid" | "stack">("stack");
  const [activeItem, setActiveItem] = useState(user.role === "saleboy" ? "POS" : "Dashboard");
  const [timeFilter, setTimeFilter] = useState<"Today" | "Weekly" | "Monthly" | "Custom">("Today");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [businessName, setBusinessName] = useState<string>("");
  const [businessLogo, setBusinessLogo] = useState<string>("");
  const [reportsOpen, setReportsOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editForm, setEditForm] = useState<Omit<User, "id">>({
  Name: "",
  Mobile: "",
  Role: "admin",
  Username: "",
  Password: "",
});

  const [customStart, setCustomStart] = useState<string>("");
  const [customEnd, setCustomEnd] = useState<string>("");
  const desktopUserMenuRef = useRef<HTMLDivElement>(null);
  const mobileUserMenuRef = useRef<HTMLDivElement>(null);

  const menuItems = [
  { name: "Dashboard", icon: <FaTachometerAlt className="text-blue-500"/>, disabled: user?.role === "saleboy" },
  { name: "Staff", icon: <FaUserTie className="text-yellow-500"/>, disabled: user?.role === "saleboy" },
  { name: "Customers", icon: <FaUsers className="text-green-500"/>, disabled: user?.role === "saleboy" },
  { name: "Suppliers", icon: <FaTruck className="text-red-500"/>, disabled: user?.role === "saleboy" },
  { name: "Entries", icon: <FaKeyboard className="text-blue-300"/>, disabled: user?.role === "saleboy" },
  { name: "Items", icon: <FaBoxes className="text-yellow-300"/>, disabled: user?.role === "saleboy" },
  { name: "Sales", icon: <FaTruck className="text-green-300"/>, disabled: user?.role === "saleboy" },
  { name: "Payments", icon: <FaMoneyBill className="text-red-300"/>, disabled: user?.role === "saleboy" },
  { name: "Expenses", icon: <FaDollarSign className="text-blue-400"/>, disabled: user?.role === "saleboy" },
  { name: "Reports", icon: <FaChartBar className="text-yellow-400"/>, disabled: user?.role === "saleboy" },
  { name: "Settings", icon: <FaCog className="text-red-400"/>, disabled: user?.role === "saleboy" },
];

  const timeFilters = ["Today", "Weekly", "Monthly", "Custom"] as const;

  const [salesChartData, setSalesChartData] = useState<{ month: string; sales: number }[]>([]);

  const isWithinRange = (dateStr: string, start: Date, end: Date) => {
  const d = new Date(dateStr);
  return d >= start && d <= end;
  };

const getDateRange = (filter: string): { start: Date; end: Date } => {
  const now = new Date();
  let start: Date;
  let end: Date = new Date();
  end.setHours(23, 59, 59, 999); // ensure end of day

  switch (filter) {
    case "Daily":
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      break;

    case "Weekly":
      start = new Date();
      start.setDate(now.getDate() - 7);
      break;

    case "Monthly":
      start = new Date(now.getFullYear(), now.getMonth(), 1);
      break;

    case "Custom":
      start = new Date(customStart);
      end = new Date(customEnd);
      end.setHours(23, 59, 59, 999); // include full day
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

const handleMenuClick = (itemName: string) => {

  // If user clicks the same menu item, do nothing
  if (itemName === activeItem) return;

  // Confirm only when leaving POS
  if (activeItem === "POS" && itemName !== "POS") {
    const confirmLeave = window.confirm(
      "Are you sure you want to leave the POS?"
    );
    if (!confirmLeave) return;
  }

  // Proceed with navigation
  setActiveItem(itemName);

  if (sidebarOpen) setSidebarOpen(false);

  if (itemName === "Dashboard") {
    loadDashboardData();
  }
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
  };

  // initial load
  loadSettings();

  // ✅ listen for settings updates
  const handleSettingsUpdated = () => {
    loadSettings();
  };

  window.addEventListener("settingsUpdated", handleSettingsUpdated);

  // cleanup (VERY important)
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
      <div className="lg:hidden fixed top-0 left-0 right-0 flex items-center justify-between bg-white shadow p-4 z-50">
        <h2 className="text-xl font-bold">{activeItem}</h2>
        <div className="flex items-center gap-3">
          <div className="relative" ref={mobileUserMenuRef}>
            <div className="flex items-center gap-1 cursor-pointer" onClick={() => setUserMenuOpen(!userMenuOpen)}>
              <FaUserCircle size={28} className="text-gray-700" />
              <span className="text-gray-700 font-medium">{currentUser ? currentUser.Name : "Guest"}</span>
            </div>
 {userMenuOpen && (
  <div className="absolute right-0 top-full mt-1 bg-white shadow-lg rounded p-2 w-44 z-50">
    {currentUser?.Role === "admin" && (
      <button
        onClick={openEditCurrentUser}
        className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"
      >
        <FaEdit /> Edit User
      </button>
    )}
    <button
      onClick={logout}
      className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"
    >
      <FaSignOutAlt /> Log Out
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
<aside className={`w-64 bg-white shadow-lg p-4 lg:block fixed lg:static top-0 left-0 h-screen z-50 overflow-y-auto transform transition-transform ${sidebarOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}>
  <div className="flex justify-between items-center mb-4 lg:hidden">
    <h2 className="text-xl font-bold">Menu</h2>
    <button onClick={() => setSidebarOpen(false)}><FaTimes size={24} /></button>
  </div>

  <div className="flex items-center justify-between mb-4 hidden lg:flex">
    <h2 className="text-xl font-bold">Menu</h2>
  </div>

  {viewMode === "stack" ? (
    <ul className="space-y-2">
      {menuItems.map((item) => {
  const isDisabled = user?.role === "saleboy" && item.disabled;

  return item.name === "Entries" ? (
    <li key="Entries">
      <button
        onClick={() => !isDisabled && setEntriesOpen(!entriesOpen)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-semibold ${
          isDisabled ? "text-gray-400 cursor-not-allowed" : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        <span className="flex items-center gap-3">{item.icon} {item.name}</span>
        {entriesOpen ? <FaChevronDown /> : <FaChevronRight />}
      </button>
      {entriesOpen && (
        <ul className="ml-6 mt-1 space-y-1">
          {[{ name: "Categories", icon: <FaListAlt /> },
            { name: "Brands", icon: <FaTags /> },
            { name: "Units", icon: <FaThLarge /> },
            { name: "Discounts", icon: <FaPercentage /> },
            { name: "Taxes", icon: <FaMoneyBillWave /> }
          ].map((sub) => (
            <li key={sub.name}>
              <button
                onClick={() => !isDisabled && handleMenuClick(sub.name)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm ${
                  isDisabled
                    ? "text-gray-400 cursor-not-allowed"
                    : activeItem === sub.name
                    ? "bg-blue-100 text-blue-600 font-semibold shadow"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {sub.icon} {sub.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  ) : item.name === "Sales" ? (
    <li key="Sales">
      <button
        onClick={() => !isDisabled && setPosOpen(!posOpen)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-semibold ${
          isDisabled ? "text-gray-400 cursor-not-allowed" : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        <span className="flex items-center gap-3">{item.icon} Sales</span>
        {posOpen ? <FaChevronDown /> : <FaChevronRight />}
      </button>
      {posOpen && (
        <ul className="ml-6 mt-1 space-y-1">
          {[{ name: "POS", icon: <FaReceipt /> }, { name: "POS Invoices", icon: <FaDatabase /> }].map((sub) => (
            <li key={sub.name}>
              <button
                onClick={() => !isDisabled && handleMenuClick(sub.name === "POS Invoices" ? "Invoices" : sub.name)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm ${
                  isDisabled
                    ? "text-gray-400 cursor-not-allowed"
                    : activeItem === (sub.name === "POS Invoices" ? "Invoices" : sub.name)
                    ? "bg-blue-100 text-blue-600 font-semibold shadow"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {sub.icon} {sub.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  ) : item.name === "Payments" ? (
    <li key="Payments">
      <button
        onClick={() => !isDisabled && setPaymentsOpen(!paymentsOpen)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-semibold ${
          isDisabled ? "text-gray-400 cursor-not-allowed" : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        <span className="flex items-center gap-3">{item.icon} {item.name}</span>
        {paymentsOpen ? <FaChevronDown /> : <FaChevronRight />}
      </button>
      {paymentsOpen && (
        <ul className="ml-6 mt-1 space-y-1">
          <li>
            <button
              onClick={() => !isDisabled && handleMenuClick("CustPayments")}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm ${
                isDisabled
                  ? "text-gray-400 cursor-not-allowed"
                  : activeItem === "CustPayments"
                  ? "bg-blue-100 text-blue-600 font-semibold shadow"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <FaUsers /> Customer
            </button>
          </li>
          <li>
            <button
              onClick={() => !isDisabled && handleMenuClick("SupPayments")}
              className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm ${
                isDisabled
                  ? "text-gray-400 cursor-not-allowed"
                  : activeItem === "SupPayments"
                  ? "bg-blue-100 text-blue-600 font-semibold shadow"
                  : "text-gray-700 hover:bg-gray-100"
              }`}
            >
              <FaTruck /> Supplier
            </button>
          </li>
        </ul>
      )}
    </li>
  ) : item.name === "Reports" ? (
    <li key="Reports">
      <button
        onClick={() => !isDisabled && setReportsOpen(!reportsOpen)}
        className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-semibold ${
          isDisabled ? "text-gray-400 cursor-not-allowed" : "text-gray-700 hover:bg-gray-100"
        }`}
      >
        <span className="flex items-center gap-3">{item.icon} {item.name}</span>
        {reportsOpen ? <FaChevronDown /> : <FaChevronRight />}
      </button>
      {reportsOpen && (
        <ul className="ml-6 mt-1 space-y-1">
          {[{ name: "Sales Report", icon: <FaChartLine color="red"/> },
            { name: "Products Report", icon: <FaBoxes color="blue"/> },
            { name: "Customers Report", icon: <FaUsers color="green"/> },
            { name: "Suppliers Report", icon: <FaTruck color="blue"/> },
            { name: "Expenses Report", icon: <FaDollarSign color="red"/> },
            { name: "Cash-flow Report", icon: <FaMoneyBill color="green"/> },
            { name: "Profit Report", icon: <FaMoneyBill color="green"/> }
          ].map((sub) => (
            <li key={sub.name}>
              <button
                onClick={() => !isDisabled && handleMenuClick(sub.name)}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm ${
                  isDisabled
                    ? "text-gray-400 cursor-not-allowed"
                    : activeItem === sub.name
                    ? "bg-blue-100 text-blue-600 font-semibold shadow"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {sub.icon} {sub.name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  ) : (
    <li
      key={item.name}
      onClick={() => !isDisabled && handleMenuClick(item.name)}
      className={`flex items-center gap-3 px-3 py-2 rounded-lg transition ${
        isDisabled
          ? "text-gray-400 cursor-not-allowed"
          : activeItem === item.name
          ? "bg-blue-100 text-blue-600 font-semibold shadow"
          : "text-gray-700 hover:bg-gray-100"
      }`}
    >
      <span className="text-lg">{item.icon}</span>
      <span className="text-sm font-medium">{item.name}</span>
    </li>
  );
})}
    </ul>

  ) : (
    <div className="grid grid-cols-3 gap-3">
      {menuItems.map((item) => (
        <div
          key={item.name}
          onClick={() => handleMenuClick(item.name)}
          className={`flex flex-col items-center p-2 rounded-lg cursor-pointer transition ${
            activeItem === item.name
              ? "bg-blue-100 text-blue-600 shadow"
              : "text-gray-700 hover:bg-gray-100"
          }`}
        >
          <span className="text-xl">{item.icon}</span>
          <span className="text-xs text-center">{item.name}</span>
        </div>
      ))}
    </div>
  )}
</aside>

{sidebarOpen && (
  <div
    className="fixed inset-0 bg-black bg-opacity-30 z-40 lg:hidden"
    onClick={() => setSidebarOpen(false)}
  />
)}
      {/* MAIN CONTENT */}
      <main className="flex-1 p-4 lg:p-4 flex-col gap-6 pt-20 lg:pt-6">
        {/* HEADER DESKTOP */}
        <div className="hidden lg:flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">{activeItem}</h2>
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
            <div className="absolute right-0 top-full mt-1 bg-white shadow-lg rounded p-2 w-44 z-50">
              {currentUser?.Role === "admin" && (
                <button
                  onClick={openEditCurrentUser}
                  className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"
                >
                  <FaEdit /> Edit User
                </button>
              )}
              <button
                onClick={logout}
                className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"
              >
                <FaSignOutAlt /> Log Out
              </button>
            </div>
          )}
          </div>
        </div>

        {/* Edit User Modal */}
        {editUserOpen && currentUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
              <h3 className="text-lg font-semibold mb-4">Edit User</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block mb-1 font-medium">Name</label>
                  <input className="w-full p-2 border rounded" value={editForm.Name} onChange={(e) => setEditForm((p) => ({ ...p, Name: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Mobile</label>
                  <input className="w-full p-2 border rounded" value={editForm.Mobile} onChange={(e) => setEditForm((p) => ({ ...p, Mobile: e.target.value }))} />
                </div>
                <div>
                  <label className="block mb-1 font-medium">Role</label>
                  <select className="w-full p-2 border rounded" value={editForm.Role} onChange={(e) => setEditForm((p) => ({ ...p, Role: e.target.value }))}>
                    <option value="admin">admin</option>
                    <option value="saleboy">saleboy</option>
                  </select>
                </div>
                <div>
                  <label className="block mb-1 font-medium">Username</label>
                  <input className="w-full p-2 border rounded" value={editForm.Username} onChange={(e) => setEditForm((p) => ({ ...p, Username: e.target.value }))} />
                </div>
                <div className="md:col-span-2">
                  <label className="block mb-1 font-medium">Password</label>
                  <input className="w-full p-2 border rounded" value={editForm.Password} onChange={(e) => setEditForm((p) => ({ ...p, Password: e.target.value }))} />
                </div>
              </div>
              <div className="flex justify-end gap-3 mt-6">
                <button onClick={() => setEditUserOpen(false)} className="px-4 py-2 bg-gray-300 rounded">Cancel</button>
                <button onClick={() => saveEditedUser()} className="px-4 py-2 bg-indigo-600 text-white rounded">Save</button>
              </div>
            </div>
          </div>
        )}

        {/* CONDITIONAL PAGE RENDERING */}
        {/* CONDITIONAL PAGE RENDERING */}

        {user.role === "saleboy" ? (
          <POS currentUser={user}/>
        ) : activeItem === "Staff" ? (
          <Staff />
        ) : activeItem === "Customers" ? (
          <Customers />
        ) : activeItem === "Suppliers" ? (
          <Suppliers />
        ) : activeItem === "Items" ? (
          <ItemsPage />
        ) : activeItem === "Categories" ? (
          <Categories />
        ) : activeItem === "Brands" ? (
          <Brands />
        ) : activeItem === "Units" ? (
          <Units />
        ) : activeItem === "Discounts" ? (
          <Discounts />
        ) : activeItem === "Taxes" ? (
          <Taxes />
        ) : activeItem === "Expenses" ? (
          <Expenses />
        ) : activeItem === "Settings" ? (
          <Settings />
        ) : activeItem === "CustPayments" ? (
          <CustPayments />
        ) : activeItem === "SupPayments" ? (
          <SupPayments />
        ) : activeItem === "POS" ? (
          <POS currentUser={user}/>
        ) : activeItem === "Invoices" ? (
          <Invoices />
        ) : activeItem === "Sales Report" ? (
          <SalesReport />
        ) : activeItem === "Products Report" ? (
          <ProdReport />
        ) : activeItem === "Customers Report" ? (
          <CustReport />
        ) : activeItem === "Suppliers Report" ? (
          <SupReport />
        ) : activeItem === "Expenses Report" ? (
          <ExpReport />
        ) : activeItem === "Cash-flow Report" ? (
          <CFReport />
        ) : activeItem === "Profit Report" ? (
          <ProfReport />
        ) : (
          <>
            {/* Dashboard KPIs */}
            <div className="flex flex-wrap gap-2 mb-6">
              {timeFilters.map((filter) => (
                <button key={filter} onClick={() => setTimeFilter(filter)} className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${timeFilter === filter ? "bg-blue-600 text-white shadow" : "bg-gray-200 text-gray-700 hover:bg-gray-300"}`}>{filter}</button>
              ))}
            </div>

            {/* KPI ROW 1 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaDollarSign size={28} className="text-green-500" />
                <div>
                  <h3 className="text-sm font-medium">Sales</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.sales.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaDollarSign size={28} className="text-red-500" />
                <div>
                  <h3 className="text-sm font-medium">Purchases</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.purchases.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaUndo size={28} className="text-yellow-500" />
                <div>
                  <h3 className="text-sm font-medium">Customer Returns</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.customerReturns.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaUndo size={28} className="text-red-500" />
                <div>
                  <h3 className="text-sm font-medium">Supplier Returns</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.supplierReturns.toFixed()}</p>
                </div>
              </div>
            </div>

            {/* KPI ROW 2 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-6">
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaMoneyBill size={24} className="text-pink-500" />
                <div>
                  <h3 className="text-sm font-medium">Dues Received</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.customerPayments.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaMoneyBill size={24} className="text-indigo-500" />
                <div>
                  <h3 className="text-sm font-medium">Dues Paid</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.supplierPayments.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaDollarSign size={24} className="text-blue-500" />
                <div>
                  <h3 className="text-sm font-medium">Expenses</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.expenses.toFixed()}</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaChartLine size={24} className="text-orange-500" />
                <div>
                  <h3 className="text-sm font-medium">Net Profit</h3>
                  <p className="text-xl font-bold mt-1">Rs.{kpis.profit.toFixed()}</p>
                </div>
              </div>
            </div>

            {/* Sales Chart */}
            <div className="bg-white p-4 rounded-lg shadow-lg mt-6">
              <h3 className="text-lg font-semibold mb-3">
                Sales Overview {new Date().getFullYear()}
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
      <h3 className="text-lg font-semibold mb-4">Select Date Range</h3>
      <div className="grid grid-cols-1 gap-4">
        <div>
          <label className="block mb-1 font-medium">Start Date</label>
          <input
            type="date"
            className="w-full border p-2 rounded"
            value={customStart}
            onChange={(e) => setCustomStart(e.target.value)}
          />
        </div>
        <div>
          <label className="block mb-1 font-medium">End Date</label>
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
          Cancel
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
          OK
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
}
