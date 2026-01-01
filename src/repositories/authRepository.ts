import { getAllUsers, User } from "../db";

export const authRepository = {
  async getCurrentUser(): Promise<User | null> {
    const idRaw = localStorage.getItem("loggedInUserId");
    if (!idRaw) return null;

    const id = Number(idRaw);
    if (Number.isNaN(id)) return null;

    const users = await getAllUsers();
    return users.find(u => u.id === id) ?? null;
  },

  logout() {
    localStorage.removeItem("loggedInUserId");
  },
};
