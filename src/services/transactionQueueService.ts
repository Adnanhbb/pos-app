import { syncQueueRepository } from "../repositories/syncQueueRepository";
import type { OfflineTransactionPayload } from "../types/sync";

export async function queueOfflineTransaction(
  payload: OfflineTransactionPayload
): Promise<void> {
  /*
   * POS wiring should call this only after the local transaction commit
   * succeeds. If this throws, the caller should decide whether to warn the
   * user, retry, or block follow-up actions.
   */
  await syncQueueRepository.add({
    entity: "transactions",
    operation: "transaction",
    localId: payload.clientTransactionId,
    payload,
  });
}
