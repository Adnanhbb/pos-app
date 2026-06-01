import { initDB } from "../db";
import type {
  Customer,
  CustomerPayment,
  Cylinder,
  CylinderCustomer,
  DBSale,
  DBSaleItem,
  Item,
  ItemBatch,
  Supplier,
  SupplierPayment,
} from "../types/entities";

export type PendingItemBatch = Omit<ItemBatch, "id" | "sourceSaleId">;

export type LocalPOSFinalizationInput = {
  sale: Omit<DBSale, "id">;
  saleItems: Omit<DBSaleItem, "id" | "saleId">[];
  itemUpdates: Item[];
  batchUpdates: ItemBatch[];
  batchCreates: PendingItemBatch[];
  cylinderUpdates: Cylinder[];
  cylinderCustomerUpdates: Array<
    CylinderCustomer | Omit<CylinderCustomer, "id">
  >;
  customerUpdate?: Customer;
  supplierUpdate?: Supplier;
  customerPayment?: Omit<CustomerPayment, "id">;
  supplierPayment?: Omit<SupplierPayment, "id">;
};

export async function finalizeLocalPOSTransaction(
  input: LocalPOSFinalizationInput
): Promise<number> {
  const db = await initDB();
  const tx = db.transaction(
    [
      "sales",
      "sale_items",
      "items",
      "item_batches",
      "cylinders",
      "cylinder_customers",
      "customers",
      "suppliers",
      "customer_payments",
      "supplier_payments",
    ],
    "readwrite"
  );

  try {
    const saleId = await tx.objectStore("sales").add(input.sale as DBSale);
    const saleItemsStore = tx.objectStore("sale_items");

    for (const saleItem of input.saleItems) {
      await saleItemsStore.add({ ...saleItem, saleId } as DBSaleItem);
    }

    const itemsStore = tx.objectStore("items");
    for (const item of input.itemUpdates) {
      await itemsStore.put(item);
    }

    const batchesStore = tx.objectStore("item_batches");
    for (const batch of input.batchUpdates) {
      await batchesStore.put(batch);
    }
    for (const batch of input.batchCreates) {
      await batchesStore.add({ ...batch, sourceSaleId: saleId });
    }

    const cylindersStore = tx.objectStore("cylinders");
    for (const cylinder of input.cylinderUpdates) {
      await cylindersStore.put(cylinder);
    }

    const cylinderCustomersStore = tx.objectStore("cylinder_customers");
    for (const holding of input.cylinderCustomerUpdates) {
      if (!("id" in holding) || holding.id == null) {
        await cylinderCustomersStore.add(holding as CylinderCustomer);
      } else {
        await cylinderCustomersStore.put(holding);
      }
    }

    if (input.customerUpdate) {
      await tx.objectStore("customers").put(input.customerUpdate);
    }
    if (input.supplierUpdate) {
      await tx.objectStore("suppliers").put(input.supplierUpdate);
    }
    if (input.customerPayment) {
      await tx.objectStore("customer_payments").add(input.customerPayment);
    }
    if (input.supplierPayment) {
      await tx.objectStore("supplier_payments").add(input.supplierPayment);
    }

    await tx.done;
    return saleId;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // IndexedDB may already have aborted after a failed request.
    }

    throw error;
  }
}
