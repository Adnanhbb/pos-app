import { apiClient } from "./client";
import type { OfflineTransactionPayload } from "../types/sync";

export const transactionApi = {
  postTransaction(payload: OfflineTransactionPayload): Promise<any> {
    /*
     * Backend requirements:
     * - Wrap all sale, item, stock, batch, accounting, payment, and cylinder
     *   writes in one MySQL/MariaDB transaction.
     * - Enforce clientTransactionId idempotency so retries never double-apply
     *   stock or balances.
     * - Roll back the whole transaction on any stock, accounting, cylinder, or
     *   payment error.
     */
    return apiClient.post("/transactions.php", payload);
  },

  replayFinalizedSale(clientTransactionId: string): Promise<any> {
    return apiClient.post("/replay/sale.php", { clientTransactionId });
  },

  replayFinalizedPurchase(clientTransactionId: string): Promise<any> {
    return apiClient.post("/replay/purchase.php", { clientTransactionId });
  },

  replayFinalizedCustomerReturn(clientTransactionId: string): Promise<any> {
    return apiClient.post("/replay/customer-return.php", { clientTransactionId });
  },

  replayFinalizedSupplierReturn(clientTransactionId: string): Promise<any> {
    return apiClient.post("/replay/supplier-return.php", { clientTransactionId });
  },
};
