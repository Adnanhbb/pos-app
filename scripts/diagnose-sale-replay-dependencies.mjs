#!/usr/bin/env node

/*
 * Read-only finalized Sale replay dependency diagnostic.
 *
 * Reads the selected browser profile's IndexedDB and reports only safe mapping
 * metadata. It does not replay, archive, update queue rows, or call backend APIs.
 */

import { resolve } from "node:path";
import { tmpdir } from "node:os";

const DB_NAME = "POSDatabase";
const APP_URL =
  process.env.APP_URL || "http://localhost/jawad-bro-rehearsal/";

function argValue(name) {
  const prefix = `--${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);

  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

function resolveProfile() {
  const selected = argValue("user-data-dir");
  const profileDirectory = argValue("profile-directory");

  if (selected) {
    return {
      userDataDir: resolve(selected),
      profileDirectory,
      source: "explicit",
      warning: null,
    };
  }

  return {
    userDataDir: resolve(tmpdir(), "jawad-bro-sync-tools-profile"),
    profileDirectory: null,
    source: "temporary-default",
    warning: "This may not be the live browser profile.",
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    throw new Error("Playwright is not installed.");
  }
}

async function diagnose() {
  const queueId = positiveInteger(argValue("queue-id"), 12);
  const profile = resolveProfile();
  const { chromium } = await loadPlaywright();
  const launchArgs = profile.profileDirectory
    ? [`--profile-directory=${profile.profileDirectory}`]
    : [];
  const context = await chromium.launchPersistentContext(profile.userDataDir, {
    args: launchArgs,
    headless: true,
  });

  try {
    const page = await context.newPage();
    await page.goto(argValue("app-url") || APP_URL, {
      waitUntil: "domcontentloaded",
      timeout: 20000,
    });

    const result = await page.evaluate(
      async ({ dbName, queueId }) => {
        function requestResult(request) {
          return new Promise((resolveRequest, rejectRequest) => {
            request.onsuccess = () => resolveRequest(request.result);
            request.onerror = () => rejectRequest(request.error);
          });
        }

        function transactionDone(transaction) {
          return new Promise((resolveTransaction, rejectTransaction) => {
            transaction.oncomplete = () => resolveTransaction();
            transaction.onerror = () => rejectTransaction(transaction.error);
            transaction.onabort = () => rejectTransaction(transaction.error);
          });
        }

        function openDb() {
          return new Promise((resolveDb, rejectDb) => {
            const request = indexedDB.open(dbName);
            request.onsuccess = () => resolveDb(request.result);
            request.onerror = () => rejectDb(request.error);
          });
        }

        function reasonCodes(readiness) {
          return Array.isArray(readiness?.reasons)
            ? readiness.reasons.map((reason) => reason?.code).filter(Boolean)
            : [];
        }

        function contractFrom(row) {
          return row?.payload?.payload?.finalizedSaleReplay ?? null;
        }

        function safeQueueSummary(row) {
          const payload = row?.payload?.payload ?? {};
          const saleContract = payload.finalizedSaleReplay;
          const purchaseContract = payload.finalizedPurchaseReplay;
          return {
            id: row?.id ?? null,
            entity: row?.entity ?? null,
            operation: row?.operation ?? null,
            status: row?.status ?? null,
            localId: row?.localId ?? null,
            serverId: row?.serverId ?? null,
            invoiceNo:
              saleContract?.invoiceNo ??
              purchaseContract?.invoiceNo ??
              payload?.sale?.invoiceNo ??
              null,
            transactionType:
              saleContract?.transactionType ??
              purchaseContract?.transactionType ??
              payload?.sale?.transactionType ??
              null,
            replayReadiness: row?.replayReadiness?.status ?? null,
            reasonCodes: reasonCodes(row?.replayReadiness),
            lastErrorSummary:
              typeof row?.lastError === "string" ? row.lastError : null,
          };
        }

        const db = await openDb();
        try {
          const requiredStores = [
            "sync_queue",
            "customers",
            "items",
            "item_batches",
            "sales",
            "sale_items",
          ];
          const availableStores = requiredStores.filter((store) =>
            Array.from(db.objectStoreNames).includes(store)
          );
          const transaction = db.transaction(availableStores, "readonly");
          const queueStore = transaction.objectStore("sync_queue");
          const queueRow = await requestResult(queueStore.get(queueId));

          if (!queueRow) {
            await transactionDone(transaction);
            return {
              found: false,
              queueId,
              databaseName: db.name,
              databaseVersion: db.version,
            };
          }

          const contract = contractFrom(queueRow);
          const customerLocalId = contract?.customer?.localId ?? null;
          const contractItems = Array.isArray(contract?.items)
            ? contract.items
            : [];
          const itemLocalIds = contractItems
            .map((item) => item?.localItemId)
            .filter((id) => id !== null && id !== undefined);
          const batchLocalIds = contractItems
            .map((item) => item?.resolvedBatch?.localBatchId)
            .filter((id) => id !== null && id !== undefined);

          const getRecord = async (storeName, id) => {
            if (
              id === null ||
              id === undefined ||
              !availableStores.includes(storeName)
            ) {
              return null;
            }
            return requestResult(transaction.objectStore(storeName).get(id));
          };

          const customer = await getRecord("customers", customerLocalId);
          const items = await Promise.all(
            itemLocalIds.map((id) => getRecord("items", id))
          );
          const batches = await Promise.all(
            batchLocalIds.map((id) => getRecord("item_batches", id))
          );
          const localSale = await getRecord("sales", contract?.localSaleId);
          const allQueueRows = await requestResult(queueStore.getAll());
          const allSales = availableStores.includes("sales")
            ? await requestResult(transaction.objectStore("sales").getAll())
            : [];

          let localSaleItems = [];
          if (
            contract?.localSaleId != null &&
            availableStores.includes("sale_items")
          ) {
            const saleItemStore = transaction.objectStore("sale_items");
            const index = saleItemStore.index("by-saleId");
            localSaleItems = await requestResult(
              index.getAll(contract.localSaleId)
            );
          }

          const relatedQueueRows = allQueueRows.filter((row) => {
            if (row?.id === queueId) return false;
            if (
              row?.entity === "customers" &&
              customerLocalId != null &&
              String(row?.localId) === String(customerLocalId)
            ) {
              return true;
            }
            if (
              row?.entity === "items" &&
              itemLocalIds.some((id) => String(id) === String(row?.localId))
            ) {
              return true;
            }
            if (
              row?.entity === "item_batches" &&
              batchLocalIds.some((id) => String(id) === String(row?.localId))
            ) {
              return true;
            }

            const purchase = row?.payload?.payload?.finalizedPurchaseReplay;
            if (!purchase) return false;
            return (purchase.items ?? []).some((item) => {
              const matchesItem = itemLocalIds.some(
                (id) => String(id) === String(item?.localItemId)
              );
              const matchesBatch = batchLocalIds.some(
                (id) =>
                  String(id) === String(item?.batchCreate?.localBatchId)
              );
              return matchesItem || matchesBatch;
            });
          });

          await transactionDone(transaction);

          return {
            found: true,
            databaseName: db.name,
            databaseVersion: db.version,
            queue: {
              ...safeQueueSummary(queueRow),
              clientTransactionId:
                queueRow?.payload?.clientTransactionId ?? null,
              contract: contract
                ? {
                    name: "finalizedSaleReplay",
                    payloadVersion: contract.payloadVersion ?? null,
                    localSaleId: contract.localSaleId ?? null,
                    invoiceNo: contract.invoiceNo ?? null,
                    replayReadiness:
                      contract.replayReadiness?.status ?? null,
                    reasonCodes: reasonCodes(contract.replayReadiness),
                  }
                : null,
            },
            customer: {
              localId: customerLocalId,
              foundLocally: Boolean(customer),
              name: customer?.name ?? contract?.customer?.nameSnapshot ?? null,
              localServerId: customer?.serverId ?? null,
              queuedServerId: contract?.customer?.serverId ?? null,
              invoices: customer?.invoices ?? null,
              payable: customer?.payable ?? null,
              paid: customer?.paid ?? null,
              balance: customer?.balance ?? null,
            },
            items: contractItems.map((contractItem, index) => {
              const local = items[index];
              return {
                localId: contractItem?.localItemId ?? null,
                foundLocally: Boolean(local),
                name: local?.name ?? contractItem?.nameSnapshot ?? null,
                localServerId: local?.serverId ?? null,
                queuedServerId: contractItem?.serverItemId ?? null,
                availableStock: local?.availableStock ?? null,
              };
            }),
            batches: contractItems
              .filter((item) => item?.resolvedBatch)
              .map((contractItem) => {
                const localBatchId =
                  contractItem.resolvedBatch.localBatchId ?? null;
                const local = batches.find(
                  (batch) =>
                    String(batch?.id) === String(localBatchId)
                );
                return {
                  localId: localBatchId,
                  foundLocally: Boolean(local),
                  itemLocalId: local?.itemId ?? contractItem.localItemId ?? null,
                  invoiceNo: local?.invoiceNo ?? null,
                  sourceSaleId: local?.sourceSaleId ?? null,
                  qtyPurchased: local?.qtyPurchased ?? null,
                  qtySold: local?.qtySold ?? null,
                  balance: local?.balance ?? null,
                  localServerId: local?.serverId ?? null,
                  queuedServerId:
                    contractItem.resolvedBatch.serverBatchId ?? null,
                };
              }),
            localSale: localSale
              ? {
                  id: localSale.id ?? null,
                  invoiceNo: localSale.invoiceNo ?? null,
                  transactionType: localSale.transactionType ?? null,
                  customerId: localSale.customerId ?? null,
                  subtotal: localSale.subtotal ?? null,
                  discount: localSale.discount ?? null,
                  tax: localSale.tax ?? null,
                  dues: localSale.dues ?? null,
                  grandTotal: localSale.grandTotal ?? null,
                  paid: localSale.paid ?? null,
                  arrears: localSale.arrears ?? null,
                }
              : null,
            relatedLocalSales: allSales
              .filter(
                (sale) =>
                  customerLocalId != null &&
                  String(sale?.customerId) === String(customerLocalId)
              )
              .map((sale) => ({
                id: sale?.id ?? null,
                invoiceNo: sale?.invoiceNo ?? null,
                transactionType: sale?.transactionType ?? null,
                grandTotal: sale?.grandTotal ?? null,
                paid: sale?.paid ?? null,
                arrears: sale?.arrears ?? null,
              })),
            localSaleItems: localSaleItems.map((item) => ({
              id: item?.id ?? null,
              saleId: item?.saleId ?? null,
              originalItemId: item?.originalItemId ?? null,
              name: item?.name ?? null,
              qty: item?.qty ?? null,
            })),
            prerequisiteQueueRows: relatedQueueRows.map(safeQueueSummary),
            dependentSaleRows: allQueueRows
              .filter((row) => {
                const sale = contractFrom(row);
                if (
                  sale?.transactionType === "Sale" &&
                  (sale.items ?? []).some((item) =>
                    batchLocalIds.some(
                      (id) =>
                        String(id) ===
                        String(item?.resolvedBatch?.localBatchId)
                    )
                  )
                ) {
                  return true;
                }
                const legacySale = row?.payload?.payload?.sale;
                const legacyItems = row?.payload?.payload?.saleItems;
                return (
                  legacySale?.transactionType === "Sale" &&
                  Array.isArray(legacyItems) &&
                  legacyItems.some((item) =>
                    itemLocalIds.some(
                      (id) => String(id) === String(item?.originalItemId)
                    )
                  )
                );
              })
              .map((row) => {
                const sale = contractFrom(row);
                const consumedQty = sale
                  ? (sale.items ?? []).reduce(
                      (total, item) =>
                        batchLocalIds.some(
                          (id) =>
                            String(id) ===
                            String(item?.resolvedBatch?.localBatchId)
                        )
                          ? total +
                            Number(item?.resolvedBatch?.consumedQty ?? 0)
                          : total,
                      0
                    )
                  : (row?.payload?.payload?.saleItems ?? []).reduce(
                      (total, item) =>
                        itemLocalIds.some(
                          (id) => String(id) === String(item?.originalItemId)
                        )
                          ? total + Number(item?.qty ?? 0)
                          : total,
                      0
                    );
                return {
                  ...safeQueueSummary(row),
                  consumedQty,
                };
              }),
            activeRole: localStorage.getItem("loggedInUserRole"),
            safety: {
              readOnly: true,
              payloadBodiesPrinted: false,
              replayTriggered: false,
              queueRowsMutated: false,
              mysqlMutated: false,
            },
          };
        } finally {
          db.close();
        }
      },
      { dbName: DB_NAME, queueId }
    );

    return {
      appUrl: argValue("app-url") || APP_URL,
      profile,
      ...result,
    };
  } finally {
    await context.close();
  }
}

diagnose()
  .then((result) => {
    console.log(
      JSON.stringify(
        {
          ...result,
          warnings: result.profile.warning ? [result.profile.warning] : [],
        },
        null,
        2
      )
    );
  })
  .catch((error) => {
    console.error(
      JSON.stringify(
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          replayTriggered: false,
          queueRowsMutated: false,
          mysqlMutated: false,
        },
        null,
        2
      )
    );
    process.exitCode = 1;
  });
