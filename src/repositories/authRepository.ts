import { getAllUsers, getUserByUsername, validateUser } from "../db";
import { clearAuthToken } from "../api/authToken";
import { fetchCurrentSession, loginWithPassword, logoutSession, type AuthActor } from "../api/authSession";
import { ApiError } from "../api/client";
import type { Role, User } from "../types/entities";
import {
  resolveBackendActorIdentity,
  type BackendAuthenticatedUser,
} from "../services/authIdentityService";

type SyncableUser = User & { serverId?: number | string | null };
export type AuthenticatedUser =
  | BackendAuthenticatedUser
  | (SyncableUser & { identitySource: "offline" });
const OFFLINE_LOGIN_ENABLED = import.meta.env.VITE_ALLOW_OFFLINE_LOGIN === "true";

function isBackendUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === undefined;
}

function clearLocalLoginState(): void {
  clearAuthToken();
  localStorage.removeItem("loggedInUserId");
  localStorage.removeItem("loggedInUserServerId");
  localStorage.removeItem("loggedInUserName");
  localStorage.removeItem("loggedInUserRole");
}

async function resolveActorToLocalUser(actor: AuthActor): Promise<AuthenticatedUser | null> {
  const users = await getAllUsers() as SyncableUser[];
  return resolveBackendActorIdentity(actor, users);
}

function asOfflineIdentity(user: User): AuthenticatedUser {
  return {
    ...(user as SyncableUser),
    identitySource: "offline",
  };
}

export const authRepository = {
  async validateUser(username: string, password: string, role?: Role): Promise<AuthenticatedUser | null> {
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

    const localUser = await validateUser(username, password, role);
    return localUser ? asOfflineIdentity(localUser) : null;
  },

  async getUserByUsername(username: string): Promise<User | null> {
    return await getUserByUsername(username);
  },

  async getCurrentSession(): Promise<AuthenticatedUser | null> {
    try {
      const actor = await fetchCurrentSession();
      return actor ? await resolveActorToLocalUser(actor) : null;
    } catch {
      return null;
    }
  },

  async restoreStartupSession(): Promise<AuthenticatedUser | null> {
    try {
      const actor = await fetchCurrentSession();
      return actor ? await resolveActorToLocalUser(actor) : null;
    } catch (error) {
      if (isBackendUnavailable(error) && OFFLINE_LOGIN_ENABLED) {
        const localUser = await authRepository.getCurrentUser();
        return localUser ? asOfflineIdentity(localUser) : null;
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

  rememberAuthenticatedUser(user: AuthenticatedUser): void {
    localStorage.setItem("loggedInUserName", user.Name);
    localStorage.setItem("loggedInUserRole", user.Role);

    if (user.identitySource === "backend") {
      localStorage.removeItem("loggedInUserId");
      if (user.serverId != null) {
        localStorage.setItem("loggedInUserServerId", String(user.serverId));
      } else {
        localStorage.removeItem("loggedInUserServerId");
      }
      return;
    }

    localStorage.removeItem("loggedInUserServerId");
    if (user.id != null) {
      localStorage.setItem("loggedInUserId", String(user.id));
    } else {
      localStorage.removeItem("loggedInUserId");
    }
  },

  logout() {
    void logoutSession().catch(() => undefined);
    clearLocalLoginState();
  },
};
