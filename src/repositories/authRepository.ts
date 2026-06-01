import { getAllUsers, getUserByUsername, validateUser } from "../db";
import { clearAuthToken } from "../api/authToken";
import { fetchCurrentSession, loginWithPassword, logoutSession, type AuthActor } from "../api/authSession";
import { ApiError } from "../api/client";
import type { Role, User } from "../types/entities";

type SyncableUser = User & { serverId?: number | string | null };
const OFFLINE_LOGIN_ENABLED = import.meta.env.VITE_ALLOW_OFFLINE_LOGIN === "true";

function isBackendUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === undefined;
}

function clearLocalLoginState(): void {
  clearAuthToken();
  localStorage.removeItem("loggedInUserId");
  localStorage.removeItem("loggedInUserName");
  localStorage.removeItem("loggedInUserRole");
}

function getActorServerId(actor: AuthActor): number | string | null {
  return actor.serverId ?? actor.id ?? null;
}

function actorToUser(actor: AuthActor): SyncableUser | null {
  const username = actor.Username ?? actor.username;
  const name = actor.Name ?? actor.name;
  const role = actor.Role ?? actor.role;

  if (!username || !name || !role) return null;

  const serverId = getActorServerId(actor);

  return {
    id: typeof actor.id === "number" ? actor.id : undefined,
    serverId,
    Username: username,
    Name: name,
    Mobile: actor.Mobile ?? actor.mobile ?? "",
    Role: role,
    Password: "",
    isDeleted: false,
    deletedAt: null,
  };
}

async function resolveActorToLocalUser(actor: AuthActor): Promise<User | null> {
  const actorUser = actorToUser(actor);
  if (!actorUser) return null;

  const users = await getAllUsers() as SyncableUser[];
  const serverId = actorUser.serverId;

  const localMatch = users.find((user) => {
    if (serverId != null && user.serverId != null && String(user.serverId) === String(serverId)) return true;
    return user.Username === actorUser.Username;
  });

  if (!localMatch) return actorUser;

  return {
    ...localMatch,
    Name: actorUser.Name || localMatch.Name,
    Username: actorUser.Username || localMatch.Username,
    Mobile: actorUser.Mobile ?? localMatch.Mobile,
    Role: actorUser.Role || localMatch.Role,
    serverId: localMatch.serverId ?? actorUser.serverId,
  } as SyncableUser;
}

export const authRepository = {
  async validateUser(username: string, password: string, role?: Role): Promise<User | null> {
    try {
      const actor = await loginWithPassword(username, password);
      const remoteUser = await resolveActorToLocalUser(actor);

      if (remoteUser) {
        if (role && remoteUser.Role !== role) return null;
        return remoteUser;
      }
    } catch (error) {
      if (!isBackendUnavailable(error)) {
        console.warn("Remote login rejected; local fallback was not attempted.");
        clearLocalLoginState();
        return null;
      }

      if (!OFFLINE_LOGIN_ENABLED) {
        console.warn("Remote login unavailable; explicit offline login is disabled.");
        return null;
      }

      console.warn("Remote login unavailable; using explicitly enabled local login fallback.");
    }

    return await validateUser(username, password, role);
  },

  async getUserByUsername(username: string): Promise<User | null> {
    return await getUserByUsername(username);
  },

  async getCurrentSession(): Promise<User | null> {
    try {
      const actor = await fetchCurrentSession();
      return actor ? await resolveActorToLocalUser(actor) : null;
    } catch {
      return null;
    }
  },

  async restoreStartupSession(): Promise<User | null> {
    try {
      const actor = await fetchCurrentSession();
      return actor ? await resolveActorToLocalUser(actor) : null;
    } catch (error) {
      if (isBackendUnavailable(error) && OFFLINE_LOGIN_ENABLED) {
        return await authRepository.getCurrentUser();
      }

      if (!isBackendUnavailable(error)) {
        clearLocalLoginState();
      }

      return null;
    }
  },

  async getCurrentUser(): Promise<User | null> {
    const idRaw = localStorage.getItem("loggedInUserId");
    const username = localStorage.getItem("loggedInUserName");
    if (!idRaw && !username) return null;

    const users = await getAllUsers() as SyncableUser[];
    const id = idRaw == null ? Number.NaN : Number(idRaw);

    if (!Number.isNaN(id)) {
      const byLocalId = users.find((user) => user.id === id);
      if (byLocalId) return byLocalId;

      const byServerId = users.find((user) => user.serverId != null && String(user.serverId) === String(id));
      if (byServerId) return byServerId;
    }

    if (username) {
      return users.find((user) => user.Name === username || user.Username === username) ?? null;
    }

    return null;
  },

  logout() {
    void logoutSession().catch(() => undefined);
    clearLocalLoginState();
  },
};
