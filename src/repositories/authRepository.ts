import { getAllUsers, getUserByUsername, validateUser } from "../db";
import { clearAuthToken } from "../api/authToken";
import { fetchCurrentSession, loginWithPassword, logoutSession, type AuthActor } from "../api/authSession";
import type { Role, User } from "../types/entities";

function actorToUser(actor: AuthActor): User | null {
  const username = actor.Username ?? actor.username;
  const name = actor.Name ?? actor.name;
  const role = actor.Role ?? actor.role;

  if (!username || !name || !role) return null;

  return {
    id: typeof actor.id === "number" ? actor.id : actor.serverId,
    Username: username,
    Name: name,
    Mobile: actor.Mobile ?? actor.mobile ?? "",
    Role: role,
    Password: "",
    isDeleted: false,
    deletedAt: null,
  };
}

export const authRepository = {
  async validateUser(username: string, password: string, role?: Role): Promise<User | null> {
    try {
      const actor = await loginWithPassword(username, password);
      const remoteUser = actorToUser(actor);

      if (remoteUser) {
        if (role && remoteUser.Role !== role) return null;
        return remoteUser;
      }
    } catch (error) {
      // Preserve offline-first local login behavior when the backend is absent,
      // not migrated yet, or rejects a user that still exists only locally.
      console.warn("Remote login unavailable; falling back to local login.", error);
    }

    return await validateUser(username, password, role);
  },

  async getUserByUsername(username: string): Promise<User | null> {
    return await getUserByUsername(username);
  },

  async getCurrentSession(): Promise<User | null> {
    try {
      const actor = await fetchCurrentSession();
      return actor ? actorToUser(actor) : null;
    } catch {
      return null;
    }
  },

  async getCurrentUser(): Promise<User | null> {
    const idRaw = localStorage.getItem("loggedInUserId");
    if (!idRaw) return null;

    const id = Number(idRaw);
    if (Number.isNaN(id)) return null;

    const users = await getAllUsers();
    return users.find(u => u.id === id) ?? null;
  },

  logout() {
    void logoutSession();
    clearAuthToken();
    localStorage.removeItem("loggedInUserId");
    localStorage.removeItem("loggedInUserName");
    localStorage.removeItem("loggedInUserRole");
  },
};