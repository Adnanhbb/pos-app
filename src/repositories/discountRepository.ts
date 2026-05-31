import {
  addDiscount,
  deleteDiscount,
  getAllDiscounts,
  searchDiscounts,
  updateDiscount,
} from "../db";
import { entityApi } from "../api/entityApi";
import {
  canUseApi,
  getServerId,
  normalizeRemoteRecord,
  prepareRemoteRecordForLocalInsert,
  queueEntityCreate,
  queueEntityDelete,
  queueEntityUpdate,
} from "./helpers/syncRepositoryHelpers";
import type { Discount } from "../types/entities";
import type { SyncMetadata } from "../types/sync";

type SyncableDiscount = Discount & SyncMetadata;

function normalizeRemoteDiscount(
  remote: unknown,
  fallback: Partial<SyncableDiscount>
): SyncableDiscount | null {
  return normalizeRemoteRecord<Discount>(
    remote,
    fallback,
    (record) => Boolean(record.name && record.type && record.value != null)
  );
}

function getRemoteData(remoteRecord: unknown): Partial<SyncableDiscount> | null {
  if (!remoteRecord || typeof remoteRecord !== "object") return null;

  const maybeWrapped = remoteRecord as {
    success?: boolean;
    data?: unknown;
  };

  if ("data" in maybeWrapped && maybeWrapped.data && typeof maybeWrapped.data === "object") {
    return maybeWrapped.data as Partial<SyncableDiscount>;
  }

  return remoteRecord as Partial<SyncableDiscount>;
}

async function queueDiscountCreate(discount: SyncableDiscount) {
  await queueEntityCreate("discounts", discount);
}

async function queueDiscountUpdate(discount: SyncableDiscount) {
  await queueEntityUpdate("discounts", discount);
}

async function queueDiscountDelete(discount: Partial<SyncableDiscount>) {
  await queueEntityDelete("discounts", discount);
}

export const discountRepository = {
  async getAll(): Promise<Discount[]> {
    return await getAllDiscounts();
  },

  async search(q: string): Promise<Discount[]> {
    return await searchDiscounts(q);
  },

  async create(discount: Omit<Discount, "id">): Promise<number> {
    if (await canUseApi()) {
      try {
        const remote = await entityApi.create<SyncableDiscount>("discounts", discount);
        const remoteDiscount = normalizeRemoteDiscount(remote, discount);

        if (remoteDiscount) {
          return await addDiscount(prepareRemoteRecordForLocalInsert(remoteDiscount) as Omit<Discount, "id">);
        }

        return await addDiscount(discount);
      } catch {
        // Fall through to local write + queue when the API is unavailable or rejects.
      }
    }

    const localId = await addDiscount(discount);
    const localRecord: SyncableDiscount = {
      ...discount,
      id: localId,
    };

    await queueDiscountCreate(localRecord);
    return localId;
  },

  async update(discount: Discount): Promise<void> {
    const syncableDiscount = discount as SyncableDiscount;
    const serverId = getServerId(syncableDiscount);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.update<SyncableDiscount>("discounts", serverId, syncableDiscount);
        await updateDiscount(discount);
        return;
      } catch {
        // Fall through to local update + queue when the API write fails.
      }
    }

    await updateDiscount(discount);
    await queueDiscountUpdate(syncableDiscount);
  },

  async remove(id: number): Promise<void> {
    const discount = (await getAllDiscounts()).find(d => d.id === id) as SyncableDiscount | undefined;
    const serverId = discount ? getServerId(discount) : null;

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.remove("discounts", serverId);
        await deleteDiscount(id);
        return;
      } catch {
        // Fall through to local delete + queue when the API write fails.
      }
    }

    await deleteDiscount(id);
    await queueDiscountDelete(discount ?? { id });
  },

  async applyRemoteMirror(
    localId: number | string,
    remoteRecord: unknown
  ): Promise<void> {
    const remoteDiscount = getRemoteData(remoteRecord);
    const serverId = remoteDiscount
      ? remoteDiscount.serverId ?? remoteDiscount.id ?? null
      : null;

    if (serverId == null) {
      console.warn("Discounts sync mirror skipped: no serverId returned.", {
        localId,
        remoteRecord,
      });
      return;
    }

    const discounts = await getAllDiscounts();
    const localDiscount = discounts.find((discount) => String(discount.id) === String(localId));

    if (!localDiscount) {
      console.warn("Discounts sync mirror skipped: local discount not found.", {
        localId,
        serverId,
      });
      return;
    }

    const mirroredDiscount: SyncableDiscount = {
      ...(localDiscount as SyncableDiscount),
      serverId,
    };

    if (typeof remoteDiscount?.name === "string") {
      mirroredDiscount.name = remoteDiscount.name;
    }

    if (remoteDiscount?.value != null) {
      mirroredDiscount.value = Number(remoteDiscount.value);
    }

    if (typeof remoteDiscount?.type === "string") {
      mirroredDiscount.type = remoteDiscount.type as Discount["type"];
    }

    await updateDiscount(mirroredDiscount);
    console.info("Discounts sync mirror applied.", {
      localId,
      serverId,
    });
  },
};
