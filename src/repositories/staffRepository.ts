// src/staffRepository.ts
import { getUsersPaged, addUser, updateUser, deleteUser, User, Role } from "../db";

export type StaffForm = Omit<User, "id">;

export const staffRepository = {
  /** Fetch a paged list of users with optional search & role filter */
  getPaged: async (
    page: number,
    pageSize: number,
    searchQuery?: string,
    roleFilter?: Role
  ): Promise<{ total: number; data: User[] }> => {
    return getUsersPaged(
      page,
      pageSize,
      "Name",                  // sort by Name
      "asc",                   // ascending
      roleFilter ?? null,      // filter by role or null
      searchQuery || null      // search or null
    );
  },

  /** Create a new user */
  create: async (user: StaffForm) => {
    return addUser(user);
  },

  /** Update an existing user */
  update: async (user: User) => {
    return updateUser(user);
  },

  /** Delete a user by ID */
  remove: async (id: number) => {
    return deleteUser(id);
  },
  
};


