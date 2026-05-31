import { apiClient } from "./client";
import type { SyncEntityName } from "../types/sync";

function entityPath(entity: SyncEntityName) {
  return `/${entity}.php`;
}

function entityItemPath(entity: SyncEntityName, id: number | string) {
  return `${entityPath(entity)}?id=${encodeURIComponent(String(id))}`;
}

export const entityApi = {
  list<T>(entity: SyncEntityName) {
    return apiClient.get<T[]>(entityPath(entity));
  },

  getById<T>(entity: SyncEntityName, id: number | string) {
    return apiClient.get<T>(entityItemPath(entity, id));
  },

  create<T>(entity: SyncEntityName, payload: any) {
    return apiClient.post<T>(entityPath(entity), payload);
  },

  update<T>(entity: SyncEntityName, id: number | string, payload: any) {
    return apiClient.put<T>(entityItemPath(entity, id), payload);
  },

  remove<T>(entity: SyncEntityName, id: number | string) {
    return apiClient.delete<T>(entityItemPath(entity, id));
  },

  restore<T>(entity: SyncEntityName, id: number | string) {
    return apiClient.patch<T>(`${entityItemPath(entity, id)}&restore=1`);
  },

  permanentRemove<T>(entity: SyncEntityName, id: number | string) {
    return apiClient.delete<T>(`${entityItemPath(entity, id)}&permanent=1`);
  },
};
