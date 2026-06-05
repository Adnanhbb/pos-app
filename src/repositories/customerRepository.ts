// src/customersRepository.ts

import {
  getAllCustomers,
  addCustomer,
  updateCustomer,
  deleteCustomer,
  searchCustomers,
  getCustomersPaged,
  getCustomerById,
} from "../db";
import { entityApi } from "../api/entityApi";
import {
  canUseApi,
  getServerId,
  hasAccountingFieldChange,
  normalizeRemoteRecord,
  prepareRemoteRecordForLocalInsert,
  queueEntityDelete,
  queueEntityOperation,
  stripAccountingFields,
} from "./helpers/syncRepositoryHelpers";
import type { Customer } from "../types/entities";
import type { SyncMetadata } from "../types/sync";

export type { Customer };

type SyncableCustomer = Customer & SyncMetadata;

function normalizeRemoteCustomer(
  remote: unknown,
  fallback: Partial<SyncableCustomer>
): SyncableCustomer | null {
  const record = normalizeRemoteRecord<Customer>(
    remote,
    fallback,
    (candidate) => Boolean(candidate.name && candidate.mobile)
  );

  if (!record) return null;

  return {
    ...record,
    invoices: Number(record.invoices ?? 0),
    payable: Number(record.payable ?? 0),
    paid: Number(record.paid ?? 0),
    balance: Number(record.balance ?? 0),
  };
}


function getRemoteData(remoteRecord: unknown): Partial<SyncableCustomer> & {
  is_deleted?: boolean | number;
  deleted_at?: string | number | null;
} | null {
  if (!remoteRecord || typeof remoteRecord !== "object") return null;

  const maybeWrapped = remoteRecord as {
    success?: boolean;
    data?: unknown;
  };

  if ("data" in maybeWrapped && maybeWrapped.data && typeof maybeWrapped.data === "object") {
    return maybeWrapped.data as Partial<SyncableCustomer> & {
      is_deleted?: boolean | number;
      deleted_at?: string | number | null;
    };
  }

  return remoteRecord as Partial<SyncableCustomer> & {
    is_deleted?: boolean | number;
    deleted_at?: string | number | null;
  };
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
async function queueCustomerCreate(customer: SyncableCustomer) {
  await queueEntityOperation("customers", "create", stripAccountingFields(customer));
}

async function queueCustomerProfileUpdate(customer: SyncableCustomer) {
  await queueEntityOperation(
    "customers",
    "update",
    stripAccountingFields(customer)
  );
}

async function queueCustomerDelete(customer: Partial<SyncableCustomer>) {
  await queueEntityDelete("customers", customer);
}

export type CustomersRepository = {
  getAll: () => Promise<Customer[]>;
  getById: (id: number) => Promise<Customer | undefined>;
  getPaged: (
    page: number,
    pageSize: number,
    query?: string
  ) => Promise<{ total: number; data: Customer[] }>;
  search: (q: string) => Promise<Customer[]>;
  getDeleted: () => Promise<Customer[]>;
  create: (customer: Omit<Customer, "id">) => Promise<number>;
  update: (customer: Customer) => Promise<void>;
  remove: (id: number) => Promise<void>;
  restore: (id: number) => Promise<void>;
  permanentDelete: (id: number) => Promise<void>;
  mapProfileToBackend?: (id: number) => Promise<number | string>;
  applyRemoteMirror?: (
    localId: number | string,
    remoteRecord: unknown
  ) => Promise<void>;
};

export const customersRepository: CustomersRepository = {

  /** -----------------------------
   *  ACTIVE CUSTOMERS
   *  ----------------------------- */

  /** Get all non-deleted customers */
  getAll: async (): Promise<Customer[]> => {
    const all = await getAllCustomers();
    return all.filter(c => !c.isDeleted);
  },

  /** Get customer by ID */
  getById: async (id: number): Promise<Customer | undefined> => {
    return await getCustomerById(id);
  },

  /** Get paged customers (non-deleted by default) */
  getPaged: async (
    page: number,
    pageSize: number,
    query?: string
  ) => {
    const { total, data } =
      await getCustomersPaged(page, pageSize, query ?? null);

    const filtered = data.filter(c => !c.isDeleted);

    return {
      total: filtered.length,
      data: filtered,
    };
  },

  /** Search customers (non-deleted only) */
  search: async (q: string): Promise<Customer[]> => {
    const all = await searchCustomers(q);
    return all.filter(c => !c.isDeleted);
  },

  /** -----------------------------
   *  DELETED CUSTOMERS (NEW)
   *  ----------------------------- */

  /** Get ONLY deleted customers */
  getDeleted: async (): Promise<Customer[]> => {
    const all = await getAllCustomers();
    return all.filter(c => c.isDeleted === true);
  },

  /** -----------------------------
   *  CREATE / UPDATE
   *  ----------------------------- */

  /** Create customer */
  create: async (customer: Omit<Customer, "id">): Promise<number> => {
    const cust: Omit<Customer, "id"> = {
      ...customer,
      isDeleted: false,
      deletedAt: null,
    };

    if (await canUseApi()) {
      try {
        const remote = await entityApi.create<SyncableCustomer>("customers", stripAccountingFields(cust));
        const remoteCustomer = normalizeRemoteCustomer(remote, cust);

        if (remoteCustomer) {
          return await addCustomer(prepareRemoteRecordForLocalInsert(remoteCustomer) as Omit<Customer, "id">);
        }

        return await addCustomer(cust);
      } catch {
        // Fall through to local write + queue when the API is unavailable or rejects.
      }
    }

    const localId = await addCustomer(cust);
    const created = (await getCustomerById(localId)) as SyncableCustomer | undefined;

    await queueCustomerCreate(created ?? { ...cust, id: localId });
    return localId;
  },

  mapProfileToBackend: async (id: number): Promise<number | string> => {
    const customer = await getCustomerById(id) as SyncableCustomer | undefined;
    if (!customer) throw new Error("Customer not found");

    const existingServerId = getServerId(customer);
    if (existingServerId != null) return existingServerId;
    if (!(await canUseApi())) {
      throw new Error("Backend is unavailable for manual customer mapping.");
    }

    const remoteResponse = await entityApi.list<SyncableCustomer>("customers") as
      | SyncableCustomer[]
      | { data?: SyncableCustomer[] };
    const remoteRows = Array.isArray(remoteResponse)
      ? remoteResponse
      : Array.isArray(remoteResponse.data)
        ? remoteResponse.data
        : [];
    const exactClientMatches = remoteRows.filter(
      (row: SyncableCustomer & { client_id?: string | number | null }) =>
        String(row.client_id ?? "") === String(id)
    );

    if (exactClientMatches.length > 1) {
      throw new Error("Multiple backend customers use this local client id.");
    }

    const remote = exactClientMatches[0] ?? await entityApi.create<SyncableCustomer>(
      "customers",
      stripAccountingFields({ ...customer, localId: id })
    );
    await customersRepository.applyRemoteMirror?.(id, remote);

    const mapped = await getCustomerById(id) as SyncableCustomer | undefined;
    const serverId = mapped ? getServerId(mapped) : null;
    if (serverId == null) {
      throw new Error("Backend customer mapping did not return a server id.");
    }
    return serverId;
  },

  /** Update customer */
  update: async (customer: Customer): Promise<void> => {
    const existing = customer.id ? await getCustomerById(customer.id) : undefined;

    if (hasAccountingFieldChange(existing, customer)) {
      // Customer balance/payable/paid/invoice mutations are caused by POS,
      // payments, returns, or invoice deletion. They must later sync through
      // atomic transaction endpoints, not as isolated customer profile updates.
      await updateCustomer(customer);
      return;
    }

    const syncableCustomer = customer as SyncableCustomer;
    const serverId = getServerId(syncableCustomer);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.update<SyncableCustomer>(
          "customers",
          serverId,
          stripAccountingFields(syncableCustomer)
        );
        await updateCustomer(customer);
        return;
      } catch {
        // Fall through to local update + queue when the API write fails.
      }
    }

    await updateCustomer(customer);
    await queueCustomerProfileUpdate(syncableCustomer);
  },

  /** -----------------------------
   *  SOFT DELETE SYSTEM
   *  ----------------------------- */

  /** Soft delete */
  remove: async (id: number): Promise<void> => {
    const customer = await getCustomerById(id);
    if (!customer) throw new Error("Customer not found");

    const deletedCustomer: SyncableCustomer = {
      ...customer,
      isDeleted: true,
      deletedAt: Date.now(),
    } as SyncableCustomer;

    const serverId = getServerId(deletedCustomer);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.remove("customers", serverId);
        await updateCustomer(deletedCustomer);
        return;
      } catch {
        // Fall through to local soft delete + queue when the API write fails.
      }
    }

    await updateCustomer(deletedCustomer);
    await queueCustomerDelete(deletedCustomer);
  },

  /** Restore deleted */
  restore: async (id: number): Promise<void> => {
    const customer = await getCustomerById(id);
    if (!customer) throw new Error("Customer not found");

    const restoredCustomer: Customer = {
      ...customer,
      isDeleted: false,
      deletedAt: null,
    };

    const syncableCustomer = restoredCustomer as SyncableCustomer;
    const serverId = getServerId(syncableCustomer);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.restore("customers", serverId);
        await updateCustomer(restoredCustomer);
        return;
      } catch {
        // Fall through to local restore + queue when the API write fails.
      }
    }

    await updateCustomer(restoredCustomer);
    await queueEntityOperation("customers", "update", {
      ...stripAccountingFields(syncableCustomer),
      _syncAction: "restore",
    } as any);
  },

  /** Permanent delete */
  permanentDelete: async (id: number): Promise<void> => {
    const customer = await getCustomerById(id) as SyncableCustomer | undefined;
    const serverId = customer ? getServerId(customer) : null;

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.permanentRemove("customers", serverId);
        await deleteCustomer(id);
        return;
      } catch {
        // Fall through to local hard delete + queue when the API write fails.
      }
    }

    await deleteCustomer(id);
    await queueEntityOperation("customers", "delete", {
      ...(customer ?? { id }),
      _syncAction: "permanentDelete",
    } as any);
  },

  applyRemoteMirror: async (
    localId: number | string,
    remoteRecord: unknown
  ): Promise<void> => {
    const remoteCustomer = getRemoteData(remoteRecord);
    const serverId = remoteCustomer
      ? remoteCustomer.serverId ?? remoteCustomer.id ?? null
      : null;

    if (serverId == null) {
      console.warn("Customers sync mirror skipped: no serverId returned.", {
        localId,
        remoteRecord,
      });
      return;
    }

    const numericLocalId = Number(localId);
    const localCustomer = Number.isNaN(numericLocalId)
      ? undefined
      : await getCustomerById(numericLocalId);

    if (!localCustomer) {
      console.warn("Customers sync mirror skipped: local customer not found.", {
        localId,
        serverId,
      });
      return;
    }

    const mirroredCustomer: SyncableCustomer = {
      ...(localCustomer as SyncableCustomer),
      serverId,
    };

    if (typeof remoteCustomer?.name === "string") {
      mirroredCustomer.name = remoteCustomer.name;
    }

    if (typeof remoteCustomer?.mobile === "string") {
      mirroredCustomer.mobile = remoteCustomer.mobile;
    }

    if (typeof remoteCustomer?.cnic === "string") {
      mirroredCustomer.cnic = remoteCustomer.cnic;
    }

    if (typeof remoteCustomer?.address === "string") {
      mirroredCustomer.address = remoteCustomer.address;
    }

    if (typeof remoteCustomer?.isDeleted === "boolean") {
      mirroredCustomer.isDeleted = remoteCustomer.isDeleted;
    } else if (remoteCustomer?.is_deleted != null) {
      mirroredCustomer.isDeleted = Boolean(remoteCustomer.is_deleted);
    }

    mirroredCustomer.deletedAt = normalizeDeletedAt(
      remoteCustomer?.deletedAt ?? remoteCustomer?.deleted_at,
      mirroredCustomer.deletedAt ?? null
    );

    await updateCustomer(mirroredCustomer);
    console.info("Customers sync mirror applied.", {
      localId,
      serverId,
    });
  },
};
