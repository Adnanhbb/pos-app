import { db } from "../db";
import type { DBHeld, DBHeldItem } from "../types/entities";
import type { SyncMetadata } from "../types/sync";
import { entityApi } from "../api/entityApi";
import {
  canUseApi,
  getServerId,
  queueEntityOperation,
} from "./helpers/syncRepositoryHelpers";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

type HeldHeader = Omit<DBHeld, "items">;
type NewHeldItem = Omit<DBHeldItem, "id" | "heldId">;
type SyncableHeldHeader = HeldHeader & SyncMetadata;

type HeldCartPayload = SyncableHeldHeader & {
  items: Array<NewHeldItem | DBHeldItem>;
};

type RemoteHeldResponse = Partial<SyncableHeldHeader> & {
  data?: unknown;
  held?: unknown;
  id?: number | string;
  client_id?: number | string | null;
  total?: number | string;
};

const HELD_MIRROR_FIELDS = [
  "invoiceNo",
  "date",
  "transactionType",
  "customerId",
  "supplierId",
  "customerName",
  "supplierName",
  "subtotal",
  "discount",
  "tax",
  "grandTotal",
  "paid",
  "discountMode",
  "discountValue",
  "taxMode",
  "taxValue",
  "returnMode",
] as const;

function getRemoteHeldData(remoteRecord: unknown): RemoteHeldResponse | null {
  if (!remoteRecord || typeof remoteRecord !== "object") return null;

  const response = remoteRecord as RemoteHeldResponse;
  if (response.data && typeof response.data === "object") {
    return response.data as RemoteHeldResponse;
  }

  if (response.held && typeof response.held === "object") {
    return response.held as RemoteHeldResponse;
  }

  return response;
}

function coerceHeldMirrorValue(field: string, value: unknown): unknown {
  if (value === undefined) return undefined;

  if ([
    "customerId",
    "supplierId",
    "subtotal",
    "discount",
    "tax",
    "grandTotal",
    "paid",
    "discountValue",
    "taxValue",
  ].includes(field)) {
    if (value === null && (field === "customerId" || field === "supplierId")) return null;
    const numeric = Number(value);
    return Number.isNaN(numeric) ? undefined : numeric;
  }

  return value;
}

function buildHeldPayload(
  held: Partial<SyncableHeldHeader>,
  items: Array<NewHeldItem | DBHeldItem>
): HeldCartPayload {
  return {
    ...held,
    items,
  } as HeldCartPayload;
}

function normalizeRemoteHeldPayload(
  remote: unknown,
  fallback: HeldCartPayload
): HeldCartPayload | null {
  if (!remote || typeof remote !== "object") return null;

  const record = remote as Partial<HeldCartPayload> & {
    held?: Partial<SyncableHeldHeader>;
  };
  const remoteHeader = record.held ?? record;
  const remoteItems = Array.isArray(record.items) ? record.items : fallback.items;

  if (!remoteHeader.invoiceNo || !remoteHeader.date) return null;

  return {
    ...fallback,
    ...remoteHeader,
    serverId:
      remoteHeader.serverId ??
      fallback.serverId ??
      remoteHeader.id ??
      null,
    items: remoteItems,
  } as HeldCartPayload;
}

async function addHeldLocal(
  held: HeldHeader,
  items: NewHeldItem[]
): Promise<number> {
  const conn = await db.open();
  const tx = conn.transaction(
    ["held", "held_items"],
    "readwrite"
  );

  const heldStore = tx.objectStore("held");
  const itemsStore = tx.objectStore("held_items");

  const key = await promisify(heldStore.add(held));
  const heldId = key as number;

  for (const item of items) {
    itemsStore.add({
      ...item,
      heldId,
    });
  }

  return new Promise<number>((resolve, reject) => {
    tx.oncomplete = () => resolve(heldId);
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteHeldLocal(heldId: number): Promise<void> {
  const conn = await db.open();
  const tx = conn.transaction(
    ["held", "held_items"],
    "readwrite"
  );

  const heldStore = tx.objectStore("held");
  const itemsStore = tx.objectStore("held_items");
  const index = itemsStore.index("by-heldId");

  const items = await new Promise<DBHeldItem[]>((resolve, reject) => {
    const req = index.getAll(heldId);
    req.onsuccess = () => resolve(req.result as DBHeldItem[]);
    req.onerror = () => reject(req.error);
  });

  for (const item of items) {
    if (item.id) itemsStore.delete(item.id);
  }

  heldStore.delete(heldId);

  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function queueHeldOperation(
  operation: "create" | "update" | "delete",
  payload: Partial<HeldCartPayload>
) {
  // Held headers and held_items are one logical held-cart unit. Do not sync
  // held_items independently, or a resumed held cart could become partial.
  await queueEntityOperation("held", operation, payload);
}

export const heldRepository = {

  /* ----------------------------------
     SAVE HELD TRANSACTION
  -----------------------------------*/
  async addHeld(
    held: Omit<DBHeld, "items">,
    items: Omit<DBHeldItem, "id" | "heldId">[]
  ): Promise<number> {
    const payload = buildHeldPayload(held as SyncableHeldHeader, items);

    if (await canUseApi()) {
      try {
        const remote = await entityApi.create<HeldCartPayload>("held", payload);
        const remotePayload = normalizeRemoteHeldPayload(remote, payload);

        if (remotePayload) {
          const { items: remoteItems, ...remoteHeld } = remotePayload;
          return await addHeldLocal(
            remoteHeld as HeldHeader,
            remoteItems as NewHeldItem[]
          );
        }

        return await addHeldLocal(held, items);
      } catch {
        // Fall through to local save + queue when the API is unavailable or rejects.
      }
    }

    const localId = await addHeldLocal(held, items);
    await queueHeldOperation(
      getServerId(payload) ? "update" : "create",
      buildHeldPayload({ ...held, id: localId } as SyncableHeldHeader, items)
    );

    return localId;
  },

  /* ----------------------------------
     GET ALL HELD
  -----------------------------------*/
  async getAll(): Promise<DBHeld[]> {
    const conn = await db.open();
    const tx = conn.transaction("held", "readonly");
    return promisify(tx.objectStore("held").getAll());
  },

  /* ----------------------------------
     GET HELD ITEMS
  -----------------------------------*/
  async getItems(heldId: number): Promise<DBHeldItem[]> {
    const conn = await db.open();
    const tx = conn.transaction("held_items", "readonly");

    const all = await promisify<DBHeldItem[]>(
      tx.objectStore("held_items").getAll()
    );

    return all.filter(i => i.heldId === heldId);
  },

  async getAllHeld(): Promise<DBHeld[]> {
    const conn = await db.open();
    const tx = conn.transaction("held", "readonly");
    const store = tx.objectStore("held");

    const request = store.getAll();

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as DBHeld[]);
      request.onerror = () => reject(request.error);
    });
  },

  async getItemsByHeldId(heldId: number): Promise<DBHeldItem[]> {
    const conn = await db.open();
    const tx = conn.transaction("held_items", "readonly");
    const store = tx.objectStore("held_items");
    const index = store.index("by-heldId");

    const request = index.getAll(heldId);

    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result as DBHeldItem[]);
      request.onerror = () => reject(request.error);
    });
  },
  async applyRemoteMirror(
    localId: number | string,
    remoteRecord: unknown
  ): Promise<void> {
    const remoteHeld = getRemoteHeldData(remoteRecord);
    const serverId = remoteHeld
      ? remoteHeld.serverId ?? remoteHeld.id ?? null
      : null;

    if (serverId == null) {
      console.warn("Held sync mirror skipped: no serverId returned.", {
        localId,
        remoteRecord,
      });
      return;
    }

    const numericLocalId = Number(localId);
    const conn = await db.open();
    const localHeld = Number.isNaN(numericLocalId)
      ? undefined
      : await promisify(conn.transaction("held", "readonly").objectStore("held").get(numericLocalId));

    if (!localHeld) {
      console.warn("Held sync mirror skipped: local held row not found.", {
        localId,
        serverId,
      });
      return;
    }

    const mirroredHeld: SyncableHeldHeader = {
      ...(localHeld as SyncableHeldHeader),
      serverId,
    };

    for (const field of HELD_MIRROR_FIELDS) {
      const value = coerceHeldMirrorValue(field, remoteHeld?.[field]);
      if (value !== undefined) {
        (mirroredHeld as unknown as Record<string, unknown>)[field] = value;
      }
    }

    await promisify(conn.transaction("held", "readwrite").objectStore("held").put(mirroredHeld));
    console.info("Held sync mirror applied.", {
      localId,
      serverId,
    });
  },

  async deleteHeld(heldId: number): Promise<void> {
    const held = (await heldRepository.getAllHeld())
      .find((h) => h.id === heldId) as SyncableHeldHeader | undefined;
    const items = await heldRepository.getItemsByHeldId(heldId);
    const serverId = held ? getServerId(held) : null;
    const payload = held
      ? buildHeldPayload(held, items)
      : ({ id: heldId, items } as Partial<HeldCartPayload>);

    if (serverId != null && await canUseApi()) {
      try {
        await entityApi.remove("held", serverId);
        await deleteHeldLocal(heldId);
        return;
      } catch {
        // Fall through to local delete + queue when the API write fails.
      }
    }

    await deleteHeldLocal(heldId);
    await queueHeldOperation("delete", payload);
  }
};
