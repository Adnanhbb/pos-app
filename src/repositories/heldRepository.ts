import { db } from "../db";
import type { DBHeld, DBHeldItem } from "../db";

function promisify<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const heldRepository = {

  /* ----------------------------------
     SAVE HELD TRANSACTION
  -----------------------------------*/
  async addHeld(
    held: Omit<DBHeld, "items">,                 // ⚡ Remove items from held
    items: Omit<DBHeldItem, "id" | "heldId">[]   // items passed separately
  ): Promise<number> {
    const conn = await db.open();
    const tx = conn.transaction(
      ["held", "held_items"],
      "readwrite"
    );

    const heldStore = tx.objectStore("held");
    const itemsStore = tx.objectStore("held_items");

    // Add held header
    const key = await promisify(heldStore.add(held));
    const heldId = key as number;

    // Add items
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

  async deleteHeld(heldId: number): Promise<void> {
    const conn = await db.open();
    const tx = conn.transaction(
      ["held", "held_items"],
      "readwrite"
    );

    const heldStore = tx.objectStore("held");
    const itemsStore = tx.objectStore("held_items");
    const index = itemsStore.index("by-heldId");

    // delete items
    const items = await new Promise<DBHeldItem[]>((resolve, reject) => {
      const req = index.getAll(heldId);
      req.onsuccess = () => resolve(req.result as DBHeldItem[]);
      req.onerror = () => reject(req.error);
    });

    for (const item of items) {
      if (item.id) itemsStore.delete(item.id);
    }

    // delete header
    heldStore.delete(heldId);

    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
};