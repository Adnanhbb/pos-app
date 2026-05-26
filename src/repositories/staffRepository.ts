// src/staffRepository.ts
import { getUsersPaged, addUser, updateUser,getUserById, deleteUser } from "../db";
import type { Role, User } from "../types/entities";
import type { SyncMetadata } from "../types/sync";
import { entityApi } from "../api/entityApi";
import {
  canUseApi,
  getServerId,
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
    includeDeleted: boolean = false // new param
  ): Promise<{ total: number; data: User[] }> => {
    const { total, data } = await getUsersPaged(
      page,
      pageSize,
      "Name",
      "asc",
      roleFilter ?? null,
      searchQuery || null
    );

    // filter out deleted unless requested
    const filteredData = includeDeleted ? data : data.filter(u => !u.isDeleted);

    return { total: filteredData.length, data: filteredData };
  },

  /** Create a new user */
  create: async (user: StaffForm) => {
    if (await canUseApi()) {
      try {
        const remote = await entityApi.create<SyncableUser>("users", user);
        const remoteUser = normalizeRemoteUser(remote, user);

        if (remoteUser) {
          return await addUser(remoteUser);
        }

        return await addUser(user);
      } catch {
        // Fall through to local write + queue when the API is unavailable or rejects.
      }
    }

    const localId = await addUser(user);
    const created = (await getUserById(localId)) as SyncableUser | undefined;

    await queueUserCreate(created ?? { ...user, id: localId });
    return localId;
  },

  /** Update an existing user */
  update: async (user: User) => {
    const syncableUser = user as SyncableUser;
    const serverId = getServerId(syncableUser);

    if (serverId != null && await canUseApi()) {
      try {
        const remote = await entityApi.update<SyncableUser>("users", serverId, syncableUser);
        const remoteUser = normalizeRemoteUser(remote, syncableUser);

        return await updateUser(remoteUser ?? user);
      } catch {
        // Fall through to local update + queue when the API write fails.
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
      } catch {
        // Fall through to local soft delete + queue when the API write fails.
      }
    }

    await updateUser(deletedUser);
    await queueUserDelete(deletedUser);

    return true;
  },

  restore: async (id: number) => {
  const user = await getUserById(id);
  if (!user) throw new Error("User not found");
  await staffRepository.update({ ...user, isDeleted: false, deletedAt: null });
},

permanentDelete: async (id: number) => {
  const user = (await getUserById(id)) as SyncableUser | undefined;
  const serverId = user ? getServerId(user) : null;

  if (serverId != null && await canUseApi()) {
    try {
      await entityApi.remove("users", serverId);
      return await deleteUser(id);
    } catch {
      // Fall through to local hard delete + queue when the API write fails.
    }
  }

  await deleteUser(id);
  await queueUserDelete(user ?? { id });
},
  
};


