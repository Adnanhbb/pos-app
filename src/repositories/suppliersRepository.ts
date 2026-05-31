// src/supplierRepository.ts
import type { Supplier, SupplierPayment } from "../types/entities";
import {
  addSupplier,
  updateSupplier,
  deleteSupplier,
  getAllSuppliers,
  getSuppliersPaged,
  getSupplierById,
  searchSuppliers,
  addSupplierPayment,
  getAllSupplierPayments,
  deleteSupplierPayment,
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
import type { SyncMetadata } from "../types/sync";

// Export types
export type { Supplier, SupplierPayment };

type SyncableSupplier = Supplier & SyncMetadata;

function normalizeRemoteSupplier(
  remote: unknown,
  fallback: Partial<SyncableSupplier>
): SyncableSupplier | null {
  const record = normalizeRemoteRecord<Supplier>(
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


function getRemoteData(remoteRecord: unknown): Partial<SyncableSupplier> & {
  is_deleted?: boolean | number;
  deleted_at?: string | number | null;
} | null {
  if (!remoteRecord || typeof remoteRecord !== "object") return null;

  const maybeWrapped = remoteRecord as {
    success?: boolean;
    data?: unknown;
  };

  if ("data" in maybeWrapped && maybeWrapped.data && typeof maybeWrapped.data === "object") {
    return maybeWrapped.data as Partial<SyncableSupplier> & {
      is_deleted?: boolean | number;
      deleted_at?: string | number | null;
    };
  }

  return remoteRecord as Partial<SyncableSupplier> & {
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
async function queueSupplierCreate(supplier: SyncableSupplier) {
  await queueEntityOperation("suppliers", "create", stripAccountingFields(supplier));
}

async function queueSupplierProfileUpdate(supplier: SyncableSupplier) {
  await queueEntityOperation(
    "suppliers",
    "update",
    stripAccountingFields(supplier)
  );
}

async function queueSupplierDelete(supplier: Partial<SyncableSupplier>) {
  await queueEntityDelete("suppliers", supplier);
}

// ------------------------
// Repository type
// ------------------------
export type SuppliersRepository = {
  // Suppliers
  getAll: () => Promise<Supplier[]>;
  getById: (id: number) => Promise<Supplier | undefined>;
  getPaged: (
    page: number,
    pageSize: number,
    query?: string,
    includeDeleted?: boolean
  ) => Promise<{ data: Supplier[]; total: number }>;
  search: (q: string) => Promise<Supplier[]>;
  create: (supplier: Omit<Supplier, "id">) => Promise<number>;
  update: (supplier: Supplier) => Promise<void>;
  remove: (id: number) => Promise<void>;
  applyRemoteMirror?: (localId: number | string, remoteRecord: unknown) => Promise<void>;
  restore?: (id: number) => Promise<void>;
  permanentDelete?: (id: number) => Promise<void>;
  getDeleted?: () => Promise<Supplier[]>;

  // Payments
  addPayment?: (payment: Omit<SupplierPayment, "id">) => Promise<void>;
  getPaymentsBySupplier?: (supplierId: number) => Promise<SupplierPayment[]>;
  deletePayment?: (id: number) => Promise<void>;
};

// ------------------------
// Runtime repository
// ------------------------
export const suppliersRepository: SuppliersRepository = {
  // ---------------- Suppliers ----------------
  getAll: async (): Promise<Supplier[]> => {
    const all = await getAllSuppliers();
    return all.filter(s => !s.isDeleted);
  },

  getById: async (id: number): Promise<Supplier | undefined> => {
    return await getSupplierById(id);
  },

  getPaged: async (
    page: number,
    pageSize: number,
    query?: string,
    includeDeleted: boolean = false
  ) => {
    const { total, data } = await getSuppliersPaged(page, pageSize, query ?? null);
    const filtered = includeDeleted ? data : data.filter(s => !s.isDeleted);
    return { total: filtered.length, data: filtered };
  },

  search: async (q: string): Promise<Supplier[]> => {
    const all = await searchSuppliers(q);
    return all.filter(s => !s.isDeleted);
  },

  create: async (supplier: Omit<Supplier, "id">): Promise<number> => {
    const sup: Omit<Supplier, "id"> = {
      ...supplier,
      isDeleted: supplier.isDeleted ?? false,
      deletedAt: supplier.deletedAt ?? null,
    };

    if (await canUseApi()) {
      try {
        const remote = await entityApi.create<SyncableSupplier>("suppliers", stripAccountingFields(sup));
        const remoteSupplier = normalizeRemoteSupplier(remote, sup);

        if (remoteSupplier) {
          return await addSupplier(prepareRemoteRecordForLocalInsert(remoteSupplier) as Omit<Supplier, "id">);
        }

        return await addSupplier(sup);
      } catch {
        // Fall through to local write + queue when the API is unavailable or rejects.
      }
    }

    const localId = await addSupplier(sup);
    const created = (await getSupplierById(localId)) as SyncableSupplier | undefined;

    await queueSupplierCreate(created ?? { ...sup, id: localId });
    return localId;
  },

  update: async (supplier: Supplier): Promise<void> => {
    const existing = supplier.id ? await getSupplierById(supplier.id) : undefined;

    if (hasAccountingFieldChange(existing, supplier)) {
      // Supplier balance/payable/paid/invoice mutations are caused by purchases,
      // supplier payments, returns, invoice deletion, or stock/accounting flows.
      // They must later sync through atomic transaction endpoints, not as
      // isolated supplier profile updates.
      await updateSupplier(supplier);
      return;
    }

    const syncableSupplier = supplier as SyncableSupplier;
    const serverId = getServerId(syncableSupplier);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.update<SyncableSupplier>(
          "suppliers",
          serverId,
          stripAccountingFields(syncableSupplier)
        );
        await updateSupplier(supplier);
        return;
      } catch {
        // Fall through to local update + queue when the API write fails.
      }
    }

    await updateSupplier(supplier);
    await queueSupplierProfileUpdate(syncableSupplier);
  },

  remove: async (id: number): Promise<void> => {
    const supplier = await getSupplierById(id);
    if (!supplier) throw new Error("Supplier not found");

    const deletedSupplier: SyncableSupplier = {
      ...supplier,
      isDeleted: true,
      deletedAt: Date.now(),
    } as SyncableSupplier;

    const serverId = getServerId(deletedSupplier);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.remove("suppliers", serverId);
        await updateSupplier(deletedSupplier);
        return;
      } catch {
        // Fall through to local soft delete + queue when the API write fails.
      }
    }

    await updateSupplier(deletedSupplier);
    await queueSupplierDelete(deletedSupplier);
  },

  applyRemoteMirror: async (
    localId: number | string,
    remoteRecord: unknown
  ): Promise<void> => {
    const remoteSupplier = getRemoteData(remoteRecord);
    const serverId = remoteSupplier
      ? remoteSupplier.serverId ?? remoteSupplier.id ?? null
      : null;

    if (serverId == null) {
      console.warn("Suppliers sync mirror skipped: no serverId returned.", {
        localId,
        remoteRecord,
      });
      return;
    }

    const numericLocalId = Number(localId);
    const localSupplier = Number.isNaN(numericLocalId)
      ? undefined
      : await getSupplierById(numericLocalId);

    if (!localSupplier) {
      console.warn("Suppliers sync mirror skipped: local supplier not found.", {
        localId,
        serverId,
      });
      return;
    }

    const mirroredSupplier: SyncableSupplier = {
      ...(localSupplier as SyncableSupplier),
      serverId,
    };

    if (typeof remoteSupplier?.name === "string") {
      mirroredSupplier.name = remoteSupplier.name;
    }

    if (typeof remoteSupplier?.mobile === "string") {
      mirroredSupplier.mobile = remoteSupplier.mobile;
    }

    if (typeof remoteSupplier?.cnic === "string") {
      mirroredSupplier.cnic = remoteSupplier.cnic;
    }

    if (typeof remoteSupplier?.address === "string") {
      mirroredSupplier.address = remoteSupplier.address;
    }

    if (typeof remoteSupplier?.isDeleted === "boolean") {
      mirroredSupplier.isDeleted = remoteSupplier.isDeleted;
    } else if (remoteSupplier?.is_deleted != null) {
      mirroredSupplier.isDeleted = Boolean(remoteSupplier.is_deleted);
    }

    mirroredSupplier.deletedAt = normalizeDeletedAt(
      remoteSupplier?.deletedAt ?? remoteSupplier?.deleted_at,
      mirroredSupplier.deletedAt ?? null
    );

    await updateSupplier(mirroredSupplier);
    console.info("Suppliers sync mirror applied.", {
      localId,
      serverId,
    });
  },

  restore: async (id: number): Promise<void> => {
    const supplier = await getSupplierById(id);
    if (!supplier) throw new Error("Supplier not found");

    await suppliersRepository.update({
      ...supplier,
      isDeleted: false,
      deletedAt: null,
    });
  },

  permanentDelete: async (id: number): Promise<void> => {
    const supplier = await getSupplierById(id) as SyncableSupplier | undefined;
    const serverId = supplier ? getServerId(supplier) : null;

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.remove("suppliers", serverId);
        await deleteSupplier(id);

        // Delete related supplier payments locally, preserving existing behavior.
        const allPayments = await getAllSupplierPayments();
        for (const p of allPayments.filter(p => p.supplierId === id)) {
          await deleteSupplierPayment(p.id!);
        }
        return;
      } catch {
        // Fall through to local hard delete + queue when the API write fails.
      }
    }

    await deleteSupplier(id);

    // Delete related supplier payments
    const allPayments = await getAllSupplierPayments();
    for (const p of allPayments.filter(p => p.supplierId === id)) {
      await deleteSupplierPayment(p.id!);
    }

    await queueSupplierDelete(supplier ?? { id });
  },

  getDeleted: async (): Promise<Supplier[]> => {
    const all = await getAllSuppliers();
    return all.filter(s => s.isDeleted);
  },

  // ---------------- Payments ----------------
  addPayment: async (payment: Omit<SupplierPayment, "id">): Promise<void> => {
    // Supplier payment/accounting changes must later sync through an atomic
    // transaction endpoint, not as isolated supplier CRUD.
    await addSupplierPayment(
      payment.supplierId,
      payment.amount,
      payment.paymentDate,
      payment.remarks,
      payment.payableSnapshot,
      payment.balanceSnapshot
    );
  },

  getPaymentsBySupplier: async (supplierId: number): Promise<SupplierPayment[]> => {
    const all = await getAllSupplierPayments();
    return all.filter(p => p.supplierId === supplierId);
  },

  deletePayment: async (id: number): Promise<void> => {
    // Supplier payment/accounting changes must later sync through an atomic
    // transaction endpoint, not as isolated supplier CRUD.
    await deleteSupplierPayment(id);
  },
};
