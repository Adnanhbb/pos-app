import { initDB } from "../db";
import {
  inventoryMappingApi,
  type ManualItemOpeningStockMappingRequest,
} from "../api/inventoryMappingApi";
import { batchRepository } from "../repositories/batchRepository";
import { itemsRepository } from "../repositories/itemsRepository";

function nearlyEqual(left: number, right: number) {
  return Math.abs(left - right) <= 0.000001;
}

function isCylinderCategory(category: string | undefined) {
  const normalized = (category ?? "").toLowerCase();
  return normalized.includes("gas") || normalized.includes("cylinder");
}

export const manualInventoryMappingService = {
  async inspectOpeningStock(localItemId: number, localBatchId: number) {
    const [item, batches] = await Promise.all([
      itemsRepository.getById(localItemId),
      batchRepository.getAllBatchesByItem(localItemId),
    ]);
    if (!item) throw new Error("Local item was not found.");
    if (item.serverId != null) {
      throw new Error("Local item already has a backend mapping.");
    }
    if (isCylinderCategory(item.category)) {
      throw new Error("Cylinder items require a separate cylinder-aware mapping.");
    }

    const activeBatches = batches.filter((batch) => !batch.isDeleted);
    if (activeBatches.length !== 1 || activeBatches[0].id !== localBatchId) {
      throw new Error(
        "Manual Opening Stock mapping requires exactly one active local batch."
      );
    }

    const batch = activeBatches[0];
    if (
      batch.sourceSaleId !== 0 ||
      batch.invoiceNo !== "Opening Stock" ||
      batch.id == null ||
      batch.serverId != null
    ) {
      throw new Error("Selected batch is not an unmapped Opening Stock batch.");
    }
    if (
      batch.qtyPurchased <= 0 ||
      batch.qtySold < 0 ||
      batch.balance < 0 ||
      !nearlyEqual(batch.qtyPurchased, batch.qtySold + batch.balance) ||
      !nearlyEqual(Number(item.availableStock ?? 0), batch.balance)
    ) {
      throw new Error("Local Opening Stock quantity history is inconsistent.");
    }

    const db = await initDB();
    const queueRows = await db.getAll("sync_queue");
    const dependentSales = queueRows.filter((row) => {
      const contract = row.payload?.payload?.finalizedSaleReplay;
      const legacyItems = row.payload?.payload?.saleItems;
      return (
        row.entity === "transactions" &&
        row.operation === "transaction" &&
        (
          (
            contract?.transactionType === "Sale" &&
            Array.isArray(contract.items) &&
            contract.items.some(
              (entry: any) =>
                entry?.resolvedBatch?.localBatchId === localBatchId
            )
          ) ||
          (
            row.payload?.payload?.sale?.transactionType === "Sale" &&
            Array.isArray(legacyItems) &&
            legacyItems.some(
              (entry: any) => Number(entry?.originalItemId) === localItemId
            )
          )
        )
      );
    });
    const consumptionFor = (row: any) => {
      const contract = row.payload?.payload?.finalizedSaleReplay;
      if (Array.isArray(contract?.items)) {
        return contract.items.reduce(
          (itemTotal: number, entry: any) =>
            entry?.resolvedBatch?.localBatchId === localBatchId
              ? itemTotal + Number(entry.resolvedBatch.consumedQty ?? 0)
              : itemTotal,
          0
        );
      }
      const legacyItems = row.payload?.payload?.saleItems;
      return Array.isArray(legacyItems)
        ? legacyItems.reduce(
            (itemTotal: number, entry: any) =>
              Number(entry?.originalItemId) === localItemId
                ? itemTotal + Number(entry?.qty ?? 0)
                : itemTotal,
            0
          )
        : 0;
    };
    const archivedConsumption = dependentSales
      .filter((row) => row.status === "archived")
      .reduce((total, row) => total + consumptionFor(row), 0);
    const replayConsumption = dependentSales
      .filter((row) => row.status === "failed" || row.status === "pending")
      .reduce((total, row) => total + consumptionFor(row), 0);

    if (!nearlyEqual(archivedConsumption + replayConsumption, batch.qtySold)) {
      throw new Error(
        "Archived and recoverable finalized Sales do not fully explain Opening Stock consumption."
      );
    }
    if (replayConsumption <= 0) {
      throw new Error("No recoverable finalized Sale consumes this Opening Stock batch.");
    }
    const backendOpeningQuantity = batch.balance + replayConsumption;

    const request: ManualItemOpeningStockMappingRequest = {
      mappingVersion: 1,
      localItemId,
      item: {
        name: item.name,
        barcode: item.barcode,
        description: item.description,
        purchasePrice: Number(item.purchasePrice ?? 0),
        retailPrice: Number(item.retailPrice ?? 0),
        discountPrice: Number(item.discountPrice ?? 0),
        wholesalePrice: Number(item.wholesalePrice ?? 0),
        category: item.category,
        brand: item.brand,
        minunit: item.minunit,
        maxunit: item.maxunit,
        ConvQty: Number(item.ConvQty ?? 1),
      },
      openingBatch: {
        localBatchId,
        purchaseDate: batch.purchaseDate,
        qtyPurchased: batch.qtyPurchased,
        qtySold: batch.qtySold,
        balance: batch.balance,
        backendOpeningQuantity,
        archivedConsumptionExcluded: archivedConsumption,
        costPrice: batch.costPrice,
        sourceSaleId: 0,
        invoiceNo: "Opening Stock",
      },
    };

    return {
      item,
      batch,
      dependentQueueIds: dependentSales
        .filter((row) => row.status === "failed" || row.status === "pending")
        .map((row) => row.id)
        .filter((id): id is number => id != null),
      archivedQueueIds: dependentSales
        .filter((row) => row.status === "archived")
        .map((row) => row.id)
        .filter((id): id is number => id != null),
      request,
    };
  },

  async applyOpeningStock(localItemId: number, localBatchId: number) {
    const inspection = await manualInventoryMappingService.inspectOpeningStock(
      localItemId,
      localBatchId
    );
    const response = await inventoryMappingApi.mapItemOpeningStock(
      inspection.request
    );
    if (
      response.localItemId !== localItemId ||
      response.localBatchId !== localBatchId ||
      response.serverItemId <= 0 ||
      response.serverBatchId <= 0
    ) {
      throw new Error("Backend returned an inconsistent inventory mapping.");
    }

    const db = await initDB();
    const tx = db.transaction(["items", "item_batches"], "readwrite");
    const currentItem = await tx.objectStore("items").get(localItemId);
    const currentBatch = await tx.objectStore("item_batches").get(localBatchId);
    if (!currentItem || !currentBatch) {
      tx.abort();
      throw new Error("Local inventory changed before mapping writeback.");
    }
    if (
      currentItem.serverId != null &&
      String(currentItem.serverId) !== String(response.serverItemId)
    ) {
      tx.abort();
      throw new Error("Local item already has a conflicting backend mapping.");
    }
    if (
      currentBatch.serverId != null &&
      String(currentBatch.serverId) !== String(response.serverBatchId)
    ) {
      tx.abort();
      throw new Error("Local batch already has a conflicting backend mapping.");
    }

    await tx.objectStore("items").put({
      ...currentItem,
      serverId: response.serverItemId,
    });
    await tx.objectStore("item_batches").put({
      ...currentBatch,
      serverId: response.serverBatchId,
    });
    await tx.done;

    return {
      localItemId,
      serverItemId: response.serverItemId,
      localBatchId,
      serverBatchId: response.serverBatchId,
      dependentQueueIds: inspection.dependentQueueIds,
      alreadyMapped: response.alreadyMapped,
    };
  },
};
