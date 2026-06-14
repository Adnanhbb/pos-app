// src/staffRepository.ts
import {
  getAllUsers,
  getUsersPaged,
  addUser,
  updateUser,
  getUserById,
  deleteUser,
} from "../db";
import type { Role, User } from "../types/entities";
import type { SyncMetadata } from "../types/sync";
import { entityApi } from "../api/entityApi";
import { ApiError } from "../api/client";
import {
  canUseApi,
  getServerId,
  prepareRemoteRecordForLocalInsert,
  queueEntityCreate,
  queueEntityDelete,
  queueEntityUpdate,
} from "./helpers/syncRepositoryHelpers";

export type StaffForm = Omit<User, "id">;

type SyncableUser = User & SyncMetadata;

type RemoteUserResponse = Partial<SyncableUser> & {
  data?: unknown;
  id?: number | string;
  username?: string;
  name?: string;
  mobile?: string;
  role?: Role;
  is_deleted?: boolean | number;
  deleted_at?: string | number | null;
};

type RemoteUserListEnvelope = {
  data?: unknown;
};

function currentStaffActorRole(): Role | null {
  if (typeof window === "undefined") return null;
  const role = window.localStorage.getItem("loggedInUserRole");
  return role === "admin" || role === "saleboy" || role === "Dev" ? role : null;
}

function actorCanManageDevUsers(): boolean {
  return currentStaffActorRole() === "Dev";
}

function assertStaffListAccess(): void {
  const role = currentStaffActorRole();
  if (role !== "admin" && role !== "Dev") {
    throw new Error("User management access denied.");
  }
}

function assertDevUserAccess(user: Partial<User>): void {
  if (user.Role === "Dev" && !actorCanManageDevUsers()) {
    throw new Error("Developer support users can only be managed by a Dev user.");
  }
}

function isNetworkUnavailable(error: unknown): boolean {
  return error instanceof ApiError && error.status === undefined;
}

function normalizeUsername(username: unknown): string {
  return typeof username === "string" ? username.trim().toLowerCase() : "";
}

function extractRemoteUserList(response: unknown): RemoteUserResponse[] {
  if (Array.isArray(response)) {
    return response.filter(
      (record): record is RemoteUserResponse =>
        Boolean(record) && typeof record === "object"
    );
  }

  if (response && typeof response === "object") {
    const envelope = response as RemoteUserListEnvelope;
    if (Array.isArray(envelope.data)) {
      return envelope.data.filter(
        (record): record is RemoteUserResponse =>
          Boolean(record) && typeof record === "object"
      );
    }
  }

  throw new Error("The users service returned an invalid response.");
}

function getRemoteServerId(record: RemoteUserResponse): number | string | null {
  return record.serverId ?? record.id ?? null;
}

function createSafeCachedUser(
  remote: RemoteUserResponse,
  existing?: SyncableUser
): SyncableUser {
  const name = remote.Name ?? remote.name;
  const username = remote.Username ?? remote.username;
  const role = remote.Role ?? remote.role;
  const serverId = getRemoteServerId(remote);

  if (
    typeof name !== "string" ||
    typeof username !== "string" ||
    typeof role !== "string" ||
    serverId == null
  ) {
    throw new Error("The users service returned an incomplete user profile.");
  }

  const deletedAt = normalizeDeletedAt(
    remote.deletedAt ?? remote.deleted_at,
    existing?.deletedAt ?? null
  );

  return {
    ...existing,
    id: existing?.id,
    serverId,
    Name: name,
    Username: username,
    Mobile: remote.Mobile ?? remote.mobile ?? "",
    Role: role,
    // Backend-only profiles are viewable offline but are not local credentials.
    Password: existing?.Password ?? "",
    isDeleted: remote.isDeleted ?? Boolean(remote.is_deleted),
    deletedAt,
  };
}

async function cacheRemoteUserProfiles(
  remoteUsers: RemoteUserResponse[]
): Promise<User[]> {
  const localUsers = (await getAllUsers()) as SyncableUser[];
  const cachedUsers: SyncableUser[] = [];

  for (const remote of remoteUsers) {
    const serverId = getRemoteServerId(remote);
    const username = normalizeUsername(remote.Username ?? remote.username);

    const byServerId = serverId == null
      ? undefined
      : localUsers.find(
          (user) =>
            user.serverId != null &&
            String(user.serverId) === String(serverId)
        );
    const byUsername = byServerId
      ? undefined
      : localUsers.find(
          (user) => normalizeUsername(user.Username) === username
        );
    const existing = byServerId ?? byUsername;
    const cachedUser = createSafeCachedUser(remote, existing);

    if (existing?.id != null) {
      await updateUser(cachedUser);
    } else {
      const { id: _remoteLocalId, ...localProfile } = cachedUser;
      const localId = await addUser(localProfile);
      cachedUser.id = localId;
      localUsers.push(cachedUser);
    }

    cachedUsers.push(cachedUser);
  }

  return cachedUsers;
}

function paginateUsers(
  users: User[],
  page: number,
  pageSize: number,
  searchQuery?: string,
  roleFilter?: Role
): { total: number; data: User[] } {
  const query = searchQuery?.trim().toLowerCase() ?? "";
  let filtered = users.filter((user) => !user.isDeleted);

  if (!actorCanManageDevUsers()) {
    filtered = filtered.filter((user) => user.Role !== "Dev");
  }
  if (roleFilter) {
    filtered = filtered.filter((user) => user.Role === roleFilter);
  }
  if (query) {
    filtered = filtered.filter(
      (user) =>
        user.Name.toLowerCase().includes(query) ||
        user.Username.toLowerCase().includes(query) ||
        user.Mobile.toLowerCase().includes(query)
    );
  }

  filtered.sort((left, right) =>
    left.Name.localeCompare(right.Name, undefined, { sensitivity: "base" })
  );

  const total = filtered.length;
  const start = Math.max(0, page - 1) * pageSize;
  return { total, data: filtered.slice(start, start + pageSize) };
}

function normalizeRemoteUser(
  remote: unknown,
  fallback: Partial<SyncableUser>
): SyncableUser | null {
  if (!remote || typeof remote !== "object") return null;

  const response = remote as RemoteUserResponse;
  const record = response.data && typeof response.data === "object"
    ? response.data as RemoteUserResponse
    : response;

  const name = record.Name ?? record.name ?? fallback.Name;
  const username = record.Username ?? record.username ?? fallback.Username;
  const role = record.Role ?? record.role ?? fallback.Role;

  if (!name || !username || !role) return null;

  const deletedAt =
    record.deletedAt ??
    (typeof record.deleted_at === "string"
      ? Date.parse(record.deleted_at)
      : record.deleted_at) ??
    fallback.deletedAt ??
    null;

  return {
    ...fallback,
    Name: name,
    Username: username,
    Mobile: record.Mobile ?? record.mobile ?? fallback.Mobile ?? "",
    Role: role,
    Password: fallback.Password ?? "",
    isDeleted: record.isDeleted ?? Boolean(record.is_deleted) ?? fallback.isDeleted ?? false,
    deletedAt: Number.isNaN(deletedAt) ? null : deletedAt,
    id: fallback.id ?? (typeof record.id === "number" ? record.id : undefined),
    serverId: record.serverId ?? fallback.serverId ?? record.id ?? null,
  } as SyncableUser;
}


function getRemoteUserData(remoteRecord: unknown): RemoteUserResponse | null {
  if (!remoteRecord || typeof remoteRecord !== "object") return null;

  const response = remoteRecord as RemoteUserResponse;
  if (response.data && typeof response.data === "object") {
    return response.data as RemoteUserResponse;
  }

  return response;
}

function normalizeDeletedAt(value: unknown, fallback: number | null): number | null {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? fallback : parsed;
  }

  return fallback;
}
async function queueUserCreate(user: SyncableUser) {
  // The current local User model includes Password. The backend must hash
  // passwords, and future auth design should avoid queueing plain text secrets.
  await queueEntityCreate("users", user);
}

async function queueUserUpdate(user: SyncableUser) {
  // The current local User model includes Password. The backend must hash
  // passwords, and future auth design should avoid queueing plain text secrets.
  await queueEntityUpdate("users", user);
}

async function queueUserDelete(user: Partial<SyncableUser>) {
  await queueEntityDelete("users", user);
}

export const staffRepository = {
  /** Fetch a paged list of users with optional search & role filter */
  getPaged: async (
    page: number,
    pageSize: number,
    searchQuery?: string,
    roleFilter?: Role,
    includeDeleted: boolean = false
  ): Promise<{ total: number; data: User[] }> => {
    assertStaffListAccess();

    // The backend endpoint intentionally lists active users only. Deleted-user
    // review remains a local/offline workflow.
    if (!includeDeleted && await canUseApi()) {
      try {
        const response = await entityApi.list<RemoteUserResponse>("users");
        const remoteUsers = extractRemoteUserList(response);
        const cachedUsers = await cacheRemoteUserProfiles(remoteUsers);
        return paginateUsers(
          cachedUsers,
          page,
          pageSize,
          searchQuery,
          roleFilter
        );
      } catch (error) {
        if (!isNetworkUnavailable(error)) {
          throw error;
        }
      }
    }

    const { total, data } = await getUsersPaged(
      page,
      pageSize,
      "Name",
      "asc",
      roleFilter ?? null,
      searchQuery || null,
      actorCanManageDevUsers() ? null : "Dev"
    );

    const filteredData = includeDeleted ? data : data.filter((user) => !user.isDeleted);

    return { total, data: filteredData };
  },

  /** Create a new user */
  create: async (user: StaffForm) => {
    assertDevUserAccess(user);

    if (await canUseApi()) {
      try {
        const remote = await entityApi.create<SyncableUser>("users", user);
        const remoteUser = normalizeRemoteUser(remote, user);

        if (remoteUser) {
          return await addUser(prepareRemoteRecordForLocalInsert(remoteUser) as Omit<User, "id">);
        }

        return await addUser(user);
      } catch (error) {
        if (!isNetworkUnavailable(error)) {
          throw error;
        }
      }
    }

    const localId = await addUser(user);
    const created = (await getUserById(localId)) as SyncableUser | undefined;

    await queueUserCreate(created ?? { ...user, id: localId });
    return localId;
  },

  /** Update an existing user */
  update: async (user: User) => {
    assertDevUserAccess(user);

    const syncableUser = user as SyncableUser;
    const serverId = getServerId(syncableUser);

    if (serverId != null && await canUseApi()) {
      try {
        const remote = await entityApi.update<SyncableUser>("users", serverId, syncableUser);
        const remoteUser = normalizeRemoteUser(remote, syncableUser);

        return await updateUser(remoteUser ?? user);
      } catch (error) {
        if (!isNetworkUnavailable(error)) {
          throw error;
        }
      }
    }

    await updateUser(user);
    await queueUserUpdate(syncableUser);
  },



  applyRemoteMirror: async (
    localId: number | string,
    remoteRecord: unknown
  ): Promise<void> => {
    const remoteUser = getRemoteUserData(remoteRecord);
    const serverId = remoteUser
      ? remoteUser.serverId ?? remoteUser.id ?? null
      : null;

    if (serverId == null) {
      console.warn("Users sync mirror skipped: no serverId returned.", {
        localId,
        remoteRecord,
      });
      return;
    }

    const numericLocalId = Number(localId);
    const localUser = Number.isNaN(numericLocalId)
      ? undefined
      : await getUserById(numericLocalId);

    if (!localUser) {
      console.warn("Users sync mirror skipped: local user not found.", {
        localId,
        serverId,
      });
      return;
    }

    const mirroredUser: SyncableUser = {
      ...(localUser as SyncableUser),
      serverId,
    };

    const name = remoteUser?.Name ?? remoteUser?.name;
    if (typeof name === "string") {
      mirroredUser.Name = name;
    }

    const username = remoteUser?.Username ?? remoteUser?.username;
    if (typeof username === "string") {
      mirroredUser.Username = username;
    }

    const mobile = remoteUser?.Mobile ?? remoteUser?.mobile;
    if (typeof mobile === "string") {
      mirroredUser.Mobile = mobile;
    }

    const role = remoteUser?.Role ?? remoteUser?.role;
    if (typeof role === "string") {
      mirroredUser.Role = role;
    }

    if (typeof remoteUser?.isDeleted === "boolean") {
      mirroredUser.isDeleted = remoteUser.isDeleted;
    } else if (remoteUser?.is_deleted != null) {
      mirroredUser.isDeleted = Boolean(remoteUser.is_deleted);
    }

    mirroredUser.deletedAt = normalizeDeletedAt(
      remoteUser?.deletedAt ?? remoteUser?.deleted_at,
      mirroredUser.deletedAt ?? null
    );

    await updateUser(mirroredUser);
    console.info("Users sync mirror applied.", {
      localId,
      serverId,
    });
  },

  /** Soft-delete a user by ID */
  remove: async (id: number) => {
    const user = await getUserById(id); // make sure this helper exists in db.ts
    if (!user) throw new Error("User not found");
    assertDevUserAccess(user);

    const deletedUser: SyncableUser = { 
      ...user, 
      isDeleted: true, 
      deletedAt: Date.now() 
    } as SyncableUser;

    const serverId = getServerId(deletedUser);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.remove("users", serverId);
        await updateUser(deletedUser);
        return true;
      } catch (error) {
        if (!isNetworkUnavailable(error)) {
          throw error;
        }
      }
    }

    await updateUser(deletedUser);
    await queueUserDelete(deletedUser);

    return true;
  },

  restore: async (id: number) => {
  const user = await getUserById(id);
  if (!user) throw new Error("User not found");
  assertDevUserAccess(user);
  await staffRepository.update({ ...user, isDeleted: false, deletedAt: null });
},

permanentDelete: async (id: number) => {
  const user = (await getUserById(id)) as SyncableUser | undefined;
  if (user) assertDevUserAccess(user);
  const serverId = user ? getServerId(user) : null;

  if (serverId != null && await canUseApi()) {
    try {
      await entityApi.remove("users", serverId);
      return await deleteUser(id);
    } catch (error) {
      if (!isNetworkUnavailable(error)) {
        throw error;
      }
    }
  }

  await deleteUser(id);
  await queueUserDelete(user ?? { id });
},
  
};


