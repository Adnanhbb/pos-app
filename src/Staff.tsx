// src/Staff.tsx
import React, { useEffect, useState, useMemo } from "react";
import { staffRepository, StaffForm } from "./repositories/staffRepository";
import { User, Role } from "./db";
import { FaPlus, FaEdit, FaTrash, FaSearch, FaTh, FaList } from "react-icons/fa";
import { useLang } from "./i18n/LanguageContext";

const PAGE_SIZE = 8;

export default function Staff() {
  const [users, setUsers] = useState<User[]>([]);
  const [view, setView] = useState<"table" | "cards">("table");
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<Role | "all">("all");

  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  // Modal / form state
  const [isFormOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const emptyForm: StaffForm = {
    Name: "",
    Mobile: "",
    Role: "saleboy",
    Username: "",
    Password: "",
  };
  const [form, setForm] = useState<StaffForm>(emptyForm);

  const roles = useMemo(() => ["all", "admin", "saleboy"] as const, []);

  const { t, lang, setLang } = useLang();
  
  /** Load current page of users */
  const loadPage = async () => {
    const { total: t, data } = await staffRepository.getPaged(
      page,
      PAGE_SIZE,
      query,
      roleFilter !== "all" ? roleFilter : undefined
    );
    setUsers(data);
    setTotal(t);
  };

  useEffect(() => {
    loadPage();
  }, [page, roleFilter, query]);

  /** Open create form */
  const openCreate = () => {
    setEditingUser(null);
    setForm(emptyForm);
    setFormOpen(true);
  };

  /** Open edit form */
  const openEdit = (user: User) => {
    setEditingUser(user);
    setForm({
      Name: user.Name,
      Mobile: user.Mobile,
      Role: user.Role,
      Username: user.Username,
      Password: user.Password,
    });
    setFormOpen(true);
  };

  /** Close modal */
  const closeForm = () => {
    setEditingUser(null);
    setForm(emptyForm);
    setFormOpen(false);
  };

  /** Save new or edited user */
  const handleSave = async () => {
    if (!form.Name.trim()) return alert("Name is required");
    if (!form.Username.trim()) return alert("Username is required");
    if (!form.Password.trim()) return alert("Password is required");

    if (editingUser) await staffRepository.update({ ...editingUser, ...form });
    else {
      await staffRepository.create(form);
      setPage(1);
    }

    closeForm();
    await loadPage();
  };

  /** Delete user */
  const handleDelete = async (id?: number) => {
    if (!id) return;
    if (!confirm("Delete this user?")) return;
    await staffRepository.remove(id);
    const newTotal = Math.max(0, total - 1);
    const newTotalPages = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
    if (page > newTotalPages) setPage(newTotalPages);
    await loadPage();
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const textAlign = lang === "ur" ? "text-right" : "text-left";

  return (
  <div className="p-4 lg:p-8">

    {/* Header Controls */}
    <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 mb-6">
      <div className="flex items-center gap-3 w-full lg:w-auto flex-wrap">
        {/* <div className="text-lg font-semibold">{t("staff")}</div> */}
        <div className="ml-3 flex items-center gap-2 flex-wrap">
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

      <div className="flex gap-2 w-full lg:w-auto flex-wrap">
        <div className="flex items-center bg-white rounded shadow px-2 flex-1 min-w-[150px]">
          <FaSearch className="text-gray-500" />
          <input
            className="p-2 outline-none w-full"
            placeholder={t("search")}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(1);
            }}
          />
        </div>

        <select
          className="p-2 border rounded flex-1 min-w-[120px]"
          value={roleFilter}
          onChange={(e) => {
            setRoleFilter(e.target.value as Role | "all");
            setPage(1);
          }}
        >
          {roles.map((r) => (
            <option key={r} value={r}>
              {r === "all" ? t("allroles") : r}
            </option>
          ))}
        </select>

        <button
          onClick={openCreate}
          className="ml-2 inline-flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded shadow flex-none"
        >
          <FaPlus /> {t("createnew")}
        </button>
      </div>
    </div>

    {/* Table / Card View */}
    {view === "table" ? (
      <div className="bg-white rounded shadow overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className={`px-4 py-3 ${textAlign}`}>#</th>
              <th className={`px-4 py-3 ${textAlign}`}>{t("name")}</th>
              <th className={`px-4 py-3 ${textAlign}`}>{t("mobile")}</th>
              <th className={`px-4 py-3 hidden sm:table-cell ${textAlign}`}>{t("role")}</th>
              <th className={`px-4 py-3 hidden md:table-cell ${textAlign}`}>{t("username")}</th>
              <th className={`px-4 py-3 ${textAlign}`}>{t("actions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-gray-500">
                  No users
                </td>
              </tr>
            ) : (
              users.map((u, idx) => (
                <tr key={u.id ?? idx} className="border-b hover:bg-gray-50">
                  <td className="px-4 py-3">{(page - 1) * PAGE_SIZE + (idx + 1)}</td>
                  <td className="px-4 py-3">{u.Name}</td>
                  <td className="px-4 py-3">{u.Mobile}</td>
                  <td className="px-4 py-3 hidden sm:table-cell">{u.Role}</td>
                  <td className="px-4 py-3 hidden md:table-cell">{u.Username}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <button className="p-2 rounded bg-yellow-100" onClick={() => openEdit(u)}>
                        <FaEdit />
                      </button>
                      <button className="p-2 rounded bg-red-100" onClick={() => handleDelete(u.id)}>
                        <FaTrash />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {users.length === 0 && <div className="text-gray-500">No users</div>}
        {users.map((u) => (
          <div key={u.id} className="bg-white rounded shadow p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold">{u.Name}</div>
                <div className="text-xs text-gray-500">{u.Role}</div>
              </div>
              <div className="flex gap-2">
                <button className="p-2 rounded bg-yellow-100" onClick={() => openEdit(u)}>
                  <FaEdit />
                </button>
                <button className="p-2 rounded bg-red-100" onClick={() => handleDelete(u.id)}>
                  <FaTrash />
                </button>
              </div>
            </div>
            <div className="text-xs text-gray-600">Username: {u.Username}</div>
            <div className="text-xs text-gray-600">Mobile: {u.Mobile}</div>
          </div>
        ))}
      </div>
    )}

    {/* Pagination */}
    <div className="flex flex-wrap items-center justify-between mt-4 gap-2">
      <div className="text-sm text-gray-600">
        Showing page {page} / {totalPages} — {total} total
      </div>
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setPage(1)} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-50">
          First
        </button>
        <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="px-3 py-1 border rounded disabled:opacity-50">
          Prev
        </button>
        <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="px-3 py-1 border rounded disabled:opacity-50">
          Next
        </button>
        <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className="px-3 py-1 border rounded disabled:opacity-50">
          Last
        </button>
      </div>
    </div>

    {/* Modal Form */}
    {isFormOpen && (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black opacity-40" onClick={closeForm} />
        <div className="relative bg-white rounded-lg shadow-lg w-full max-w-xl p-6 z-50">
          <h3 className="text-lg font-semibold mb-4">{editingUser ? "Edit User" : t("createnewuser")}</h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">{t("name")}</label>
              <input className="w-full p-2 border rounded" value={form.Name} onChange={(e) => setForm({ ...form, Name: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">{t("mobile")}</label>
              <input className="w-full p-2 border rounded" value={form.Mobile} onChange={(e) => setForm({ ...form, Mobile: e.target.value })} />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">{t("role")}</label>
              <select className="w-full p-2 border rounded" value={form.Role} onChange={(e) => setForm({ ...form, Role: e.target.value as Role })}>
                <option value="admin">{t("admin")}</option>
                <option value="saleboy">{t("saleboy")}</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">{t("username")}</label>
              <input className="w-full p-2 border rounded" value={form.Username} onChange={(e) => setForm({ ...form, Username: e.target.value })} />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium mb-1">{t("password")}</label>
              <input type="password" className="w-full p-2 border rounded" value={form.Password} onChange={(e) => setForm({ ...form, Password: e.target.value })} />
            </div>
          </div>

          <div className="mt-4 flex justify-end gap-2 flex-wrap">
            <button className="px-4 py-2 border rounded" onClick={closeForm}>{t("cancel")}</button>
            <button className="px-4 py-2 bg-indigo-600 text-white rounded" onClick={handleSave}>{t("save")}</button>
          </div>
        </div>
      </div>
    )}
  </div>
);
}
