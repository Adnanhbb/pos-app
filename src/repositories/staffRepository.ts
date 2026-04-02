// src/staffRepository.ts
import { getUsersPaged, addUser, updateUser,getUserById, deleteUser, User, Role } from "../db";

export type StaffForm = Omit<User, "id">;

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
    return addUser(user);
  },

  /** Update an existing user */
  update: async (user: User) => {
    return updateUser(user);
  },


  /** Soft-delete a user by ID */
  remove: async (id: number) => {
    const user = await getUserById(id); // make sure this helper exists in db.ts
    if (!user) throw new Error("User not found");

    await updateUser({ 
      ...user, 
      isDeleted: true, 
      deletedAt: Date.now() 
    });

    return true;
  },

  restore: async (id: number) => {
  const user = await getUserById(id);
  if (!user) throw new Error("User not found");
  await updateUser({ ...user, isDeleted: false, deletedAt: null });
},

permanentDelete: async (id: number) => {
  return deleteUser(id);
},
  
};


