import {
  addTax,
  deleteTax,
  getAllTaxes,
  searchTaxes,
  updateTax,
} from "../db";
import { entityApi } from "../api/entityApi";
import {
  canUseApi,
  getServerId,
  normalizeRemoteRecord,
  queueEntityCreate,
  queueEntityDelete,
  queueEntityUpdate,
} from "./helpers/syncRepositoryHelpers";
import type { Tax } from "../types/entities";
import type { SyncMetadata } from "../types/sync";

type SyncableTax = Tax & SyncMetadata;

function normalizeRemoteTax(remote: unknown, fallback: Partial<SyncableTax>): SyncableTax | null {
  return normalizeRemoteRecord<Tax>(
    remote,
    fallback,
    (record) => Boolean(record.name && record.type && record.value != null)
  );
}

function getRemoteData(remoteRecord: unknown): Partial<SyncableTax> | null {
  if (!remoteRecord || typeof remoteRecord !== "object") return null;

  const maybeWrapped = remoteRecord as {
    success?: boolean;
    data?: unknown;
  };

  if ("data" in maybeWrapped && maybeWrapped.data && typeof maybeWrapped.data === "object") {
    return maybeWrapped.data as Partial<SyncableTax>;
  }

  return remoteRecord as Partial<SyncableTax>;
}

async function queueTaxCreate(tax: SyncableTax) {
  await queueEntityCreate("taxes", tax);
}

async function queueTaxUpdate(tax: SyncableTax) {
  await queueEntityUpdate("taxes", tax);
}

async function queueTaxDelete(tax: Partial<SyncableTax>) {
  await queueEntityDelete("taxes", tax);
}

export const taxRepository = {
  async getAll(): Promise<Tax[]> {
    return await getAllTaxes();
  },

  async search(q: string): Promise<Tax[]> {
    return await searchTaxes(q);
  },

  async create(tax: Omit<Tax, "id">): Promise<number> {
    if (await canUseApi()) {
      try {
        const remote = await entityApi.create<SyncableTax>("taxes", tax);
        const remoteTax = normalizeRemoteTax(remote, tax);

        if (remoteTax) {
          return await addTax(remoteTax as Omit<Tax, "id">);
        }

        return await addTax(tax);
      } catch {
        // Fall through to local write + queue when the API is unavailable or rejects.
      }
    }

    const localId = await addTax(tax);
    const localRecord: SyncableTax = {
      ...tax,
      id: localId,
    };

    await queueTaxCreate(localRecord);
    return localId;
  },

  async update(tax: Tax): Promise<void> {
    const syncableTax = tax as SyncableTax;
    const serverId = getServerId(syncableTax);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.update<SyncableTax>("taxes", serverId, syncableTax);
        await updateTax(tax);
        return;
      } catch {
        // Fall through to local update + queue when the API write fails.
      }
    }

    await updateTax(tax);
    await queueTaxUpdate(syncableTax);
  },

  async remove(id: number): Promise<void> {
    const tax = (await getAllTaxes()).find(t => t.id === id) as SyncableTax | undefined;
    const serverId = tax ? getServerId(tax) : null;

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.remove("taxes", serverId);
        await deleteTax(id);
        return;
      } catch {
        // Fall through to local delete + queue when the API write fails.
      }
    }

    await deleteTax(id);
    await queueTaxDelete(tax ?? { id });
  },

  async applyRemoteMirror(
    localId: number | string,
    remoteRecord: unknown
  ): Promise<void> {
    const remoteTax = getRemoteData(remoteRecord);
    const serverId = remoteTax
      ? remoteTax.serverId ?? remoteTax.id ?? null
      : null;

    if (serverId == null) {
      console.warn("Taxes sync mirror skipped: no serverId returned.", {
        localId,
        remoteRecord,
      });
      return;
    }

    const taxes = await getAllTaxes();
    const localTax = taxes.find((tax) => String(tax.id) === String(localId));

    if (!localTax) {
      console.warn("Taxes sync mirror skipped: local tax not found.", {
        localId,
        serverId,
      });
      return;
    }

    const mirroredTax: SyncableTax = {
      ...(localTax as SyncableTax),
      serverId,
    };

    if (typeof remoteTax?.name === "string") {
      mirroredTax.name = remoteTax.name;
    }

    if (remoteTax?.value != null) {
      mirroredTax.value = Number(remoteTax.value);
    }

    if (typeof remoteTax?.type === "string") {
      mirroredTax.type = remoteTax.type as Tax["type"];
    }

    await updateTax(mirroredTax);
    console.info("Taxes sync mirror applied.", {
      localId,
      serverId,
    });
  },
};
