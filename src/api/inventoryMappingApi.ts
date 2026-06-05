import { apiClient } from "./client";

export type ManualItemOpeningStockMappingRequest = {
  mappingVersion: 1;
  localItemId: number;
  item: {
    name: string;
    barcode?: string | null;
    description?: string | null;
    purchasePrice: number;
    retailPrice: number;
    discountPrice: number;
    wholesalePrice: number;
    category?: string | null;
    brand?: string | null;
    minunit?: string | null;
    maxunit?: string | null;
    ConvQty: number;
  };
  openingBatch: {
    localBatchId: number;
    purchaseDate: string;
    qtyPurchased: number;
    qtySold: number;
    balance: number;
    backendOpeningQuantity: number;
    archivedConsumptionExcluded: number;
    costPrice: number;
    sourceSaleId: 0;
    invoiceNo: "Opening Stock";
  };
};

export type ManualItemOpeningStockMappingResponse = {
  mappingContract: "manualItemOpeningStockMapping";
  mappingVersion: 1;
  localItemId: number;
  serverItemId: number;
  localBatchId: number;
  serverBatchId: number;
  alreadyMapped: boolean;
  backendOpeningQuantity: number;
};

export const inventoryMappingApi = {
  async mapItemOpeningStock(
    payload: ManualItemOpeningStockMappingRequest
  ): Promise<ManualItemOpeningStockMappingResponse> {
    const response = await apiClient.post<
      ManualItemOpeningStockMappingResponse | {
        data?: ManualItemOpeningStockMappingResponse;
      }
    >(
      "/replay/item-opening-stock.php",
      payload
    );
    return (
      "data" in response && response.data ? response.data : response
    ) as ManualItemOpeningStockMappingResponse;
  },
};
