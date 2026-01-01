// src/Dashboard.tsx
import React, { useState, useEffect, useRef } from "react";
import {
  FaTachometerAlt,
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


// DB helpers
import { authRepository } from "./repositories/authRepository";
import { settingsRepository } from "./repositories/settingsRepository";
import { staffRepository } from "./repositories/staffRepository";

import type { User } from "./db";

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

export default function Dashboard() {
  const [viewMode, setViewMode] = useState<"grid" | "stack">("stack");
  const [activeItem, setActiveItem] = useState("Dashboard");
  const [timeFilter, setTimeFilter] = useState<"Today" | "Weekly" | "Monthly" | "Custom">("Today");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [entriesOpen, setEntriesOpen] = useState(false);
  const [posOpen, setPosOpen] = useState(false);
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [businessName, setBusinessName] = useState<string>("");
  const [businessLogo, setBusinessLogo] = useState<string>("");

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [editUserOpen, setEditUserOpen] = useState(false);
  const [editForm, setEditForm] = useState<Omit<User, "id">>({
  Name: "",
  Mobile: "",
  Role: "admin",
  Username: "",
  Password: "",
});


  const userMenuRef = useRef<HTMLDivElement>(null);

  const menuItems = [
    { name: "Dashboard", icon: <FaTachometerAlt /> },
    { name: "Staff", icon: <FaUserTie /> },
    { name: "Customers", icon: <FaUsers /> },
    { name: "Suppliers", icon: <FaTruck /> },
    { name: "Entries", icon: <FaKeyboard /> },
    { name: "Items", icon: <FaBoxes /> },
    { name: "Sales", icon: <FaTruck /> },
    { name: "Payments", icon: <FaMoneyBill /> },
    { name: "Expenses", icon: <FaDollarSign /> },
    { name: "Reports", icon: <FaChartBar /> },
    { name: "Settings", icon: <FaCog /> },
  ];

  const timeFilters = ["Today", "Weekly", "Monthly", "Custom"] as const;

  const handleMenuClick = (itemName: string) => {
    setActiveItem(itemName);
    if (sidebarOpen) setSidebarOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
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
  async function loadSettings() {
    const settings = await settingsRepository.get();
    if (!settings) return;

    setBusinessName(settings.businessName || "My Business");
    setBusinessLogo(settings.logo || "/images/logo.png"); // fallback
  }

  loadSettings();
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
          <div className="relative" ref={userMenuRef}>
            <div className="flex items-center gap-1 cursor-pointer" onClick={() => setUserMenuOpen(!userMenuOpen)}>
              <FaUserCircle size={28} className="text-gray-700" />
              <span className="text-gray-700 font-medium">{currentUser ? currentUser.Name : "Guest"}</span>
            </div>
            {userMenuOpen && (
              <div className="absolute right-0 mt-2 bg-white shadow-lg rounded p-2 w-40 z-50">
                <button onClick={() => openEditCurrentUser()} className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"><FaEdit /> Edit User</button>
                <button onClick={() => logout()} className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"><FaSignOutAlt /> Log Out</button>
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
            {menuItems.map((item) =>
              item.name === "Entries" ? (
                <li key="Entries">
                  <button onClick={() => setEntriesOpen(!entriesOpen)} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-semibold text-gray-700 hover:bg-gray-100`}>
                    <span className="flex items-center gap-3">{item.icon} {item.name}</span>
                    {entriesOpen ? <FaChevronDown /> : <FaChevronRight />}
                  </button>
                  {entriesOpen && (
                    <ul className="ml-6 mt-1 space-y-1">
                      {[{ name: "Categories", icon: <FaListAlt /> }, { name: "Brands", icon: <FaTags /> }, { name: "Units", icon: <FaThLarge /> }, { name: "Discounts", icon: <FaPercentage /> }, { name: "Taxes", icon: <FaMoneyBillWave /> }].map((sub) => (
                        <li key={sub.name}>
                          <button onClick={() => handleMenuClick(sub.name)} className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm text-gray-700 hover:bg-gray-100 ${activeItem === sub.name ? "bg-blue-100 text-blue-600 font-semibold shadow" : ""}`}>{sub.icon} {sub.name}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ) : item.name === "Sales" ? (
                <li key="Sales">
                  <button onClick={() => setPosOpen(!posOpen)} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-semibold text-gray-700 hover:bg-gray-100`}>
                    <span className="flex items-center gap-3">{item.icon} Sales</span>
                    {posOpen ? <FaChevronDown /> : <FaChevronRight />}
                  </button>
                  {posOpen && (
                    <ul className="ml-6 mt-1 space-y-1">
                      {[{ name: "POS", icon: <FaReceipt /> }, { name: "POS Data Store", icon: <FaDatabase /> }].map((sub) => (
                        <li key={sub.name}>
                          <button onClick={() => handleMenuClick(sub.name)} className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm text-gray-700 hover:bg-gray-100 ${activeItem === sub.name ? "bg-blue-100 text-blue-600 font-semibold shadow" : ""}`}>{sub.icon} {sub.name}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ) : item.name === "Payments" ? (
                <li key="Payments">
                  <button onClick={() => setPaymentsOpen(!paymentsOpen)} className={`w-full flex items-center justify-between px-3 py-2 rounded-lg font-semibold text-gray-700 hover:bg-gray-100`}>
                    <span className="flex items-center gap-3">{item.icon} {item.name}</span>
                    {paymentsOpen ? <FaChevronDown /> : <FaChevronRight />}
                  </button>
                  {paymentsOpen && (
                    <ul className="ml-6 mt-1 space-y-1">
                      <li>
                        <button onClick={() => handleMenuClick("CustPayments")} className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm text-gray-700 hover:bg-gray-100 ${activeItem === "CustPayments" ? "bg-blue-100 text-blue-600 font-semibold shadow" : ""}`}><FaUsers /> Customer</button>
                      </li>
                      <li>
                        <button onClick={() => handleMenuClick("SupPayments")} className={`flex items-center gap-3 px-3 py-2 rounded-lg w-full text-sm text-gray-700 hover:bg-gray-100 ${activeItem === "SupPayments" ? "bg-blue-100 text-blue-600 font-semibold shadow" : ""}`}><FaTruck /> Supplier</button>
                      </li>
                    </ul>
                  )}
                </li>
              ) : (
                <li key={item.name} onClick={() => handleMenuClick(item.name)} className={`flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition ${activeItem === item.name ? "bg-blue-100 text-blue-600 font-semibold shadow" : "text-gray-700 hover:bg-gray-100"}`}>
                  <span className="text-lg">{item.icon}</span>
                  <span className="text-sm font-medium">{item.name}</span>
                </li>
              )
            )}
          </ul>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {menuItems.map((item) => (
              <div key={item.name} onClick={() => handleMenuClick(item.name)} className={`flex flex-col items-center p-2 rounded-lg cursor-pointer transition ${activeItem === item.name ? "bg-blue-100 text-blue-600 shadow" : "text-gray-700 hover:bg-gray-100"}`}>
                <span className="text-xl">{item.icon}</span>
                <span className="text-xs text-center">{item.name}</span>
              </div>
            ))}
          </div>
        )}
      </aside>

      {sidebarOpen && <div className="fixed inset-0 bg-black bg-opacity-30 z-40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      {/* MAIN CONTENT */}
      <main className="flex-1 p-4 lg:p-8 flex flex-col gap-6 pt-20 lg:pt-8">
        {/* HEADER DESKTOP */}
        <div className="hidden lg:flex justify-between items-center mb-6">
          <h2 className="text-xl font-bold">{activeItem}</h2>
          <div className="flex items-center gap-2 text-2xl font-serif font-semibold text-gray-500">
            {businessLogo && <img src={businessLogo} alt="Logo" className="h-8 w-8 rounded-md object-cover" />}
            <span>{businessName}</span>
          </div>
          <div className="relative" ref={userMenuRef}>
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => setUserMenuOpen(!userMenuOpen)}>
              <FaUserCircle size={32} className="text-gray-700" />
              <span className="font-medium text-gray-700">{currentUser ? currentUser.Name : "Guest"}</span>
            </div>
            {userMenuOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white shadow-lg rounded p-2 w-44 z-50">
                <button onClick={() => openEditCurrentUser()} className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"><FaEdit /> Edit User</button>
                <button onClick={() => logout()} className="block w-full text-left px-3 py-1 hover:bg-gray-100 text-sm flex items-center gap-2"><FaSignOutAlt /> Log Out</button>
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
        {activeItem === "Staff" ? (
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
         ) 
        : activeItem === "SupPayments" ? (
           <SupPayments />
         ) 
        : activeItem === "POS" ? (
          <POS />
        )
        :(
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
                  <p className="text-xl font-bold mt-1">$12,345</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaWallet size={28} className="text-teal-500" />
                <div>
                  <h3 className="text-sm font-medium">Payments</h3>
                  <p className="text-xl font-bold mt-1">$3,200</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaShoppingBag size={28} className="text-yellow-500" />
                <div>
                  <h3 className="text-sm font-medium">Purchases</h3>
                  <p className="text-xl font-bold mt-1">567</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaMoneyBill size={28} className="text-red-500" />
                <div>
                  <h3 className="text-sm font-medium">Expenses</h3>
                  <p className="text-xl font-bold mt-1">$1,800</p>
                </div>
              </div>
            </div>

            {/* KPI ROW 2 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mt-6">
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaUndo size={24} className="text-pink-500" />
                <div>
                  <h3 className="text-sm font-medium">Returns</h3>
                  <p className="text-xl font-bold mt-1">$1,200</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaMoneyBill size={24} className="text-indigo-500" />
                <div>
                  <h3 className="text-sm font-medium">Dues Payable</h3>
                  <p className="text-xl font-bold mt-1">$5,000</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaDollarSign size={24} className="text-teal-500" />
                <div>
                  <h3 className="text-sm font-medium">Dues Received</h3>
                  <p className="text-xl font-bold mt-1">$3,200</p>
                </div>
              </div>
              <div className="bg-white p-4 rounded-lg shadow-lg flex items-center gap-3">
                <FaChartLine size={24} className="text-orange-500" />
                <div>
                  <h3 className="text-sm font-medium">Profit</h3>
                  <p className="text-xl font-bold mt-1">$4,500</p>
                </div>
              </div>
            </div>

            {/* Sales Chart */}
            <div className="bg-white p-4 rounded-lg shadow-lg mt-6">
              <h3 className="text-lg font-semibold mb-3">Sales Overview</h3>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={salesData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Line type="monotone" dataKey="sales" stroke="#8884d8" />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Recent Orders */}
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
            </div>
          </>
        )}
      </main>
    </div>
  );
}
