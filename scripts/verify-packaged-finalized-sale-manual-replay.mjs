#!/usr/bin/env node

/*
 * Packaged-Laragon end-to-end verifier for explicit finalized Sale replay.
 *
 * This uses the copied frontend's real Settings "Sync Now" button and
 * live POSDatabase queue. It refuses to run while unrelated actionable queue
 * rows exist, creates only uniquely named rehearsal fixtures, avoids cylinders,
 * and removes its local/backend fixtures in finally blocks. The bearer token is
 * passed through environment/localStorage only and is never printed.
 */

import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import ts from "typescript";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const APP_URL =
  process.env.APP_URL || "http://localhost/jawad-bro-rehearsal/";
const API_BASE_URL = (
  process.env.API_BASE_URL || "http://localhost/jawad-bro-rehearsal/api"
).replace(/\/+$/, "");
const builderPath = resolve(
  root,
  "src/services/posTransactionPayloadBuilder.ts"
);
const runId = `packaged-sale-replay-${Date.now()}-${Math.random()
  .toString(36)
  .slice(2, 8)}`;
const marker = `Rehearsal Packaged Finalized Sale ${runId}`;
const readyClientTransactionId = `txn_rehearsal_packaged_sale_${runId}_ready`;
const unsafeClientTransactionId = `txn_rehearsal_packaged_sale_${runId}_unsafe`;
const token = randomBytes(32).toString("base64url");

let checks = 0;
let browser = null;
let context = null;
let page = null;
let backendFixture = null;
let localFixtureCreated = false;

function assert(condition, name, details = null) {
  if (!condition) {
    const suffix = details == null ? "" : `\n${JSON.stringify(details, null, 2)}`;
    throw new Error(`FAIL: ${name}${suffix}`);
  }
  checks += 1;
  console.log(`PASS: ${name}`);
}

function nearlyEqual(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) < 0.000001;
}

function findPhpBinary() {
  if (process.env.PHP_BIN) return process.env.PHP_BIN;

  const laragonPhpRoot = "C:\\laragon\\bin\\php";
  if (existsSync(laragonPhpRoot)) {
    const candidates = readdirSync(laragonPhpRoot)
      .map((entry) => resolve(laragonPhpRoot, entry, "php.exe"))
      .filter(existsSync)
      .sort()
      .reverse();
    if (candidates.length > 0) return candidates[0];
  }

  return "php";
}

function phpFixtureCode() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';
require_once getcwd() . '/api/lib/auth.php';

$pdo = get_pdo();
$action = getenv('PACKAGED_SALE_ACTION') ?: '';
$runId = getenv('PACKAGED_SALE_RUN_ID') ?: '';
$marker = getenv('PACKAGED_SALE_MARKER') ?: '';
$token = getenv('PACKAGED_SALE_TOKEN') ?: '';
$readyClientId = getenv('PACKAGED_SALE_READY_CLIENT_ID') ?: '';
$unsafeClientId = getenv('PACKAGED_SALE_UNSAFE_CLIENT_ID') ?: '';

try {
    if ($action === 'setup') {
        setup_fixture($pdo, $runId, $marker, $token);
    } elseif ($action === 'snapshot') {
        snapshot_fixture($pdo, $runId, $readyClientId, $unsafeClientId);
    } elseif ($action === 'cleanup') {
        cleanup_fixture($pdo, $runId, $token);
    } else {
        throw new RuntimeException('Unknown fixture action.');
    }
} catch (Throwable $exception) {
    echo json_encode([
        'ok' => false,
        'action' => $action,
        'error' => $exception->getMessage(),
    ], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit(1);
}

function setup_fixture(PDO $pdo, string $runId, string $marker, string $token): void {
    foreach (['api_auth_tokens', 'items', 'customers', 'item_batches', 'sync_transactions', 'transaction_idempotency', 'transaction_replay_audit', 'sales', 'sale_items', 'customer_payments'] as $table) {
        if (!table_exists($pdo, $table)) {
            throw new RuntimeException("Required rehearsal table is missing: $table");
        }
    }

    $pdo->beginTransaction();
    try {
        $statement = $pdo->prepare(
            "INSERT INTO api_auth_tokens
                (token_hash, actor_type, actor_id, role, label, is_active, expires_at)
             VALUES
                (:token_hash, 'replay_worker', :actor_id, 'replay', :label, 1, DATE_ADD(NOW(), INTERVAL 1 HOUR))"
        );
        $statement->execute([
            'token_hash' => hash_auth_token($token),
            'actor_id' => $runId . '-worker',
            'label' => $marker . ' token',
        ]);
        $tokenId = (int) $pdo->lastInsertId();

        $statement = $pdo->prepare(
            "INSERT INTO items
                (client_id, name, barcode, purchasePrice, retailPrice, discountPrice, wholesalePrice, availableStock, category, brand, minunit, maxunit, ConvQty, is_deleted)
             VALUES
                (:client_id, :name, :barcode, 10, 100, 0, 100, 10, 'Rehearsal Fixture', 'Rehearsal Fixture', 'piece', 'piece', 1, 0)"
        );
        $statement->execute([
            'client_id' => $runId . '-item',
            'name' => $marker . ' Item',
            'barcode' => $runId . '-barcode',
        ]);
        $itemId = (int) $pdo->lastInsertId();

        $statement = $pdo->prepare(
            "INSERT INTO customers
                (client_id, name, mobile, cnic, address, invoices, payable, paid, balance, is_deleted)
             VALUES
                (:client_id, :name, '03000000000', 'rehearsal', 'rehearsal fixture only', 1, 100, 20, 80, 0)"
        );
        $statement->execute([
            'client_id' => $runId . '-customer',
            'name' => $marker . ' Customer',
        ]);
        $customerId = (int) $pdo->lastInsertId();

        $statement = $pdo->prepare(
            "INSERT INTO item_batches
                (itemId, purchaseDate, qtyPurchased, qtySold, balance, costPrice, invoiceNo, isDeleted)
             VALUES
                (:item_id, '2026-06-02', 10, 0, 10, 10, :invoice_no, 0)"
        );
        $statement->execute([
            'item_id' => $itemId,
            'invoice_no' => $runId . '-opening-batch',
        ]);
        $batchId = (int) $pdo->lastInsertId();

        $pdo->commit();
        json_out([
            'ok' => true,
            'fixture' => [
                'tokenId' => $tokenId,
                'itemId' => $itemId,
                'customerId' => $customerId,
                'batchId' => $batchId,
                'itemName' => $marker . ' Item',
                'customerName' => $marker . ' Customer',
            ],
        ]);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }
}

function snapshot_fixture(PDO $pdo, string $runId, string $readyClientId, string $unsafeClientId): void {
    $itemId = (int) scalar($pdo, 'SELECT id FROM items WHERE client_id = :client_id LIMIT 1', ['client_id' => $runId . '-item']);
    $customerId = (int) scalar($pdo, 'SELECT id FROM customers WHERE client_id = :client_id LIMIT 1', ['client_id' => $runId . '-customer']);
    $batchId = (int) scalar($pdo, 'SELECT id FROM item_batches WHERE invoiceNo = :invoice_no LIMIT 1', ['invoice_no' => $runId . '-opening-batch']);
    $sync = row($pdo, 'SELECT id, replay_status, replay_attempts FROM sync_transactions WHERE client_transaction_id = :client_id LIMIT 1', ['client_id' => $readyClientId]);
    $syncId = (int) ($sync['id'] ?? 0);

    json_out([
        'ok' => true,
        'snapshot' => [
            'itemStock' => scalar($pdo, 'SELECT availableStock FROM items WHERE id = :id', ['id' => $itemId]),
            'batch' => row($pdo, 'SELECT qtySold, balance FROM item_batches WHERE id = :id', ['id' => $batchId]),
            'customer' => row($pdo, 'SELECT invoices, payable, paid, balance FROM customers WHERE id = :id', ['id' => $customerId]),
            'saleCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM sales WHERE client_transaction_id = :client_id', ['client_id' => $readyClientId]),
            'saleItemCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_transaction_id = :client_id)', ['client_id' => $readyClientId]),
            'paymentCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM customer_payments WHERE client_transaction_id = :client_id', ['client_id' => $readyClientId]),
            'payment' => row($pdo, 'SELECT amount, payableSnapshot, balanceSnapshot FROM customer_payments WHERE client_transaction_id = :client_id LIMIT 1', ['client_id' => $readyClientId]),
            'sync' => $sync,
            'unsafeStoredCount' => (int) scalar($pdo, 'SELECT COUNT(*) FROM sync_transactions WHERE client_transaction_id = :client_id', ['client_id' => $unsafeClientId]),
            'auditActorRows' => $syncId > 0
                ? rows($pdo, 'SELECT event_type, actor_type, actor_role FROM transaction_replay_audit WHERE sync_transaction_id = :id ORDER BY id', ['id' => $syncId])
                : [],
        ],
    ]);
}

function cleanup_fixture(PDO $pdo, string $runId, string $token): void {
    $like = '%' . $runId . '%';
    $itemId = (int) scalar($pdo, 'SELECT id FROM items WHERE client_id = :client_id LIMIT 1', ['client_id' => $runId . '-item']);
    $customerId = (int) scalar($pdo, 'SELECT id FROM customers WHERE client_id = :client_id LIMIT 1', ['client_id' => $runId . '-customer']);

    $pdo->beginTransaction();
    try {
        $pdo->prepare('DELETE FROM transaction_replay_audit WHERE client_transaction_id LIKE :pattern')->execute(['pattern' => $like]);
        $pdo->prepare('DELETE FROM customer_payments WHERE client_transaction_id LIKE :pattern OR customerId = :customer_id')->execute(['pattern' => $like, 'customer_id' => $customerId]);
        $pdo->prepare('DELETE FROM sale_items WHERE sale_id IN (SELECT id FROM sales WHERE client_transaction_id LIKE :pattern)')->execute(['pattern' => $like]);
        $pdo->prepare('DELETE FROM sales WHERE client_transaction_id LIKE :pattern')->execute(['pattern' => $like]);
        $pdo->prepare('DELETE FROM transaction_idempotency WHERE client_transaction_id LIKE :pattern')->execute(['pattern' => $like]);
        $pdo->prepare('DELETE FROM sync_transactions WHERE client_transaction_id LIKE :pattern')->execute(['pattern' => $like]);
        $pdo->prepare('DELETE FROM item_batches WHERE invoiceNo LIKE :pattern OR itemId = :item_id')->execute(['pattern' => $like, 'item_id' => $itemId]);
        $pdo->prepare('DELETE FROM customers WHERE client_id = :client_id')->execute(['client_id' => $runId . '-customer']);
        $pdo->prepare('DELETE FROM items WHERE client_id = :client_id')->execute(['client_id' => $runId . '-item']);
        $pdo->prepare('DELETE FROM api_auth_tokens WHERE token_hash = :token_hash')->execute(['token_hash' => hash_auth_token($token)]);
        $pdo->commit();
        json_out(['ok' => true, 'cleaned' => true]);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }
}

function table_exists(PDO $pdo, string $table): bool {
    $statement = $pdo->prepare('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :table');
    $statement->execute(['table' => $table]);
    return (int) $statement->fetchColumn() > 0;
}

function scalar(PDO $pdo, string $sql, array $args) {
    $statement = $pdo->prepare($sql);
    $statement->execute($args);
    return $statement->fetchColumn();
}

function row(PDO $pdo, string $sql, array $args): array {
    $statement = $pdo->prepare($sql);
    $statement->execute($args);
    return $statement->fetch() ?: [];
}

function rows(PDO $pdo, string $sql, array $args): array {
    $statement = $pdo->prepare($sql);
    $statement->execute($args);
    return $statement->fetchAll();
}

function json_out(array $value): void {
    echo json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
}
`;
}

function runPhpFixture(action) {
  const result = spawnSync(findPhpBinary(), ["-r", phpFixtureCode()], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 10 * 1024 * 1024,
    env: {
      ...process.env,
      PACKAGED_SALE_ACTION: action,
      PACKAGED_SALE_RUN_ID: runId,
      PACKAGED_SALE_MARKER: marker,
      PACKAGED_SALE_TOKEN: token,
      PACKAGED_SALE_READY_CLIENT_ID: readyClientTransactionId,
      PACKAGED_SALE_UNSAFE_CLIENT_ID: unsafeClientTransactionId,
    },
  });

  let body = null;
  try {
    body = JSON.parse((result.stdout || "").trim());
  } catch {
    body = {
      ok: false,
      error: "PHP fixture output was not valid JSON.",
      stdoutPreview: (result.stdout || "").slice(-500),
      stderrPreview: (result.stderr || "").slice(-500),
    };
  }

  if (result.error) throw result.error;
  if (result.status !== 0 || body?.ok !== true) {
    throw new Error(
      `PHP fixture ${action} failed: ${JSON.stringify(body, null, 2)}`
    );
  }
  return body;
}

async function importTypescriptModule(path) {
  const source = readFileSync(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: path,
  }).outputText;
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(
    transpiled
  ).toString("base64")}`;
  return await import(moduleUrl);
}

async function installSessionFixture(targetPage) {
  await targetPage.route("**/api/session.php", async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        data: {
          authenticated: true,
          actor: {
            id: 900002,
            serverId: 900002,
            Username: "packaged-replay-fixture",
            Name: "Packaged Replay Fixture",
            Role: "Dev",
            actorType: "user",
            actorId: "900002",
            actorRole: "Dev",
            sessionId: "packaged-sale-replay-session-fixture",
          },
        },
      }),
    });
  });
}

async function openLiveDatabase() {
  return await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("POSDatabase", 20);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return true;
  });
}

async function getActionableQueueSummary() {
  return await page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("POSDatabase", 20);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const rows = await new Promise((resolve, reject) => {
        const request = database
          .transaction("sync_queue", "readonly")
          .objectStore("sync_queue")
          .getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const actionable = rows.filter(
        (row) => row.status === "pending" || row.status === "processing"
      );
      return {
        totalRows: rows.length,
        actionableRows: actionable.length,
        statuses: actionable.reduce((summary, row) => {
          summary[row.status] = (summary[row.status] || 0) + 1;
          return summary;
        }, {}),
      };
    } finally {
      database.close();
    }
  });
}

async function createLocalSaleFixture(payloadBuilder, fixture) {
  const local = await page.evaluate(
    async ({ marker, runId, backend }) => {
      function requestResult(request) {
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      function transactionDone(transaction) {
        return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve(undefined);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      }
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("POSDatabase", 20);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      try {
        const seed = database.transaction(
          ["items", "customers", "item_batches"],
          "readwrite"
        );
        const itemId = await requestResult(
          seed.objectStore("items").add({
            serverId: backend.itemId,
            name: `${marker} Item`,
            barcode: `${runId}-barcode`,
            brand: "Rehearsal Fixture",
            category: "Rehearsal Fixture",
            minunit: "piece",
            maxunit: "piece",
            ConvQty: 1,
            purchasePrice: 10,
            retailPrice: 100,
            discountPrice: 0,
            wholesalePrice: 100,
            availableStock: 10,
            isDeleted: false,
            deletedAt: null,
          })
        );
        const customerId = await requestResult(
          seed.objectStore("customers").add({
            serverId: backend.customerId,
            name: `${marker} Customer`,
            mobile: "03000000000",
            cnic: "rehearsal",
            address: "rehearsal fixture only",
            invoices: 1,
            payable: 100,
            paid: 20,
            balance: 80,
            isDeleted: false,
            deletedAt: null,
          })
        );
        const batchId = await requestResult(
          seed.objectStore("item_batches").add({
            serverId: backend.batchId,
            itemId,
            purchaseDate: "2026-06-02",
            qtyPurchased: 10,
            qtySold: 0,
            balance: 10,
            costPrice: 10,
            invoiceNo: `${runId}-opening-batch`,
            isDeleted: false,
            deletedAt: null,
          })
        );
        await transactionDone(seed);

        const sale = {
          invoiceNo: `SAL-REHEARSAL-${runId}`,
          date: new Date().toISOString(),
          transactionType: "Sale",
          customerId,
          supplierId: null,
          customerName: `${marker} Customer`,
          supplierName: "",
          subtotal: 200,
          discount: 0,
          tax: 0,
          dues: 0,
          grandTotal: 200,
          paid: 50,
          arrears: 150,
          profit: 80,
          isPostponed: false,
        };
        const saleItem = {
          originalItemId: itemId,
          name: `${marker} Item`,
          qty: 2,
          price: 100,
          priceCategory: "Retail",
          discountType: "%",
          discountValue: 0,
          taxType: "%",
          taxValue: 0,
        };

        const finalize = database.transaction(
          [
            "sales",
            "sale_items",
            "items",
            "customers",
            "customer_payments",
            "item_batches",
          ],
          "readwrite"
        );
        const saleId = await requestResult(
          finalize.objectStore("sales").add(sale)
        );
        await requestResult(
          finalize.objectStore("sale_items").add({ ...saleItem, saleId })
        );
        await requestResult(
          finalize.objectStore("items").put({
            id: itemId,
            serverId: backend.itemId,
            name: `${marker} Item`,
            barcode: `${runId}-barcode`,
            brand: "Rehearsal Fixture",
            category: "Rehearsal Fixture",
            minunit: "piece",
            maxunit: "piece",
            ConvQty: 1,
            purchasePrice: 10,
            retailPrice: 100,
            discountPrice: 0,
            wholesalePrice: 100,
            availableStock: 8,
            isDeleted: false,
            deletedAt: null,
          })
        );
        await requestResult(
          finalize.objectStore("customers").put({
            id: customerId,
            serverId: backend.customerId,
            name: `${marker} Customer`,
            mobile: "03000000000",
            cnic: "rehearsal",
            address: "rehearsal fixture only",
            invoices: 2,
            payable: 300,
            paid: 70,
            balance: 230,
            isDeleted: false,
            deletedAt: null,
          })
        );
        await requestResult(
          finalize.objectStore("item_batches").put({
            id: batchId,
            serverId: backend.batchId,
            itemId,
            purchaseDate: "2026-06-02",
            qtyPurchased: 10,
            qtySold: 2,
            balance: 8,
            costPrice: 10,
            invoiceNo: `${runId}-opening-batch`,
            isDeleted: false,
            deletedAt: null,
          })
        );
        const paymentId = await requestResult(
          finalize.objectStore("customer_payments").add({
            customerId,
            customerName: `${marker} Customer`,
            invoiceNo: sale.invoiceNo,
            amount: 50,
            paymentDate: sale.date,
            remarks: sale.invoiceNo,
            payableSnapshot: 200,
            balanceSnapshot: 230,
          })
        );
        await transactionDone(finalize);

        return { itemId, customerId, batchId, saleId, paymentId, sale, saleItem };
      } finally {
        database.close();
      }
    },
    { marker, runId, backend: fixture }
  );

  const payload = payloadBuilder({
    clientTransactionId: readyClientTransactionId,
    createdAt: Date.now(),
    sale: local.sale,
    saleId: local.saleId,
    saleItems: [local.saleItem],
    finalizedSaleReplay: {
      localSaleId: local.saleId,
      invoiceNo: local.sale.invoiceNo,
      customer: {
        localId: local.customerId,
        serverId: fixture.customerId,
        nameSnapshot: `${marker} Customer`,
      },
      items: [
        {
          localItemId: local.itemId,
          serverItemId: fixture.itemId,
          originalItemId: local.itemId,
          nameSnapshot: `${marker} Item`,
          qty: 2,
          price: 100,
          quantityUnit: "min",
          selectedUnit: "min",
          conversion: {
            minUnit: "piece",
            maxUnit: "piece",
            convQty: 1,
            quantityInMinUnit: 2,
          },
          resolvedBatch: {
            localBatchId: local.batchId,
            serverBatchId: fixture.batchId,
            consumedQty: 2,
          },
          requiresCylinderMutation: false,
        },
      ],
      payments: {
        paidAmount: 50,
        source: "pos-finalization",
        method: null,
      },
      cylinders: [],
      totals: {
        subtotal: 200,
        discount: 0,
        tax: 0,
        dues: 0,
        grandTotal: 200,
        paid: 50,
        arrears: 150,
      },
    },
  });

  const queueId = await addQueuePayload(payload);
  return { ...local, payload, queueId };
}

async function addQueuePayload(payload) {
  return await page.evaluate(
    async ({ payload, localId }) => {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("POSDatabase", 20);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const now = Date.now();
          const request = database
            .transaction("sync_queue", "readwrite")
            .objectStore("sync_queue")
            .add({
              entity: "transactions",
              operation: "transaction",
              localId,
              payload,
              replayReadiness: payload.replayReadiness,
              createdAt: now,
              updatedAt: now,
              retryCount: 0,
              status: "pending",
            });
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      } finally {
        database.close();
      }
    },
    { payload, localId: payload.clientTransactionId }
  );
}

async function readQueueRow(id) {
  return await page.evaluate(async (queueId) => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("POSDatabase", 20);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const request = database
          .transaction("sync_queue", "readonly")
          .objectStore("sync_queue")
          .get(queueId);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  }, id);
}

async function waitForQueueStatus(id, status) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const row = await readQueueRow(id);
    if (row?.status === status) return row;
    await page.waitForTimeout(150);
  }
  return await readQueueRow(id);
}

async function clickSettingsMenu() {
  await page.locator("aside > ul > li").nth(11).click();
  await page.waitForTimeout(250);
  const syncStatusTab = page
    .locator("main")
    .getByRole("button", { name: "Sync Status", exact: true });
  await syncStatusTab.waitFor({ state: "visible", timeout: 10000 });
  await syncStatusTab.click();
  const button = page
    .locator("main")
    .getByRole("button", { name: "Sync Now", exact: true });
  await button.waitFor({ state: "visible", timeout: 10000 });
  return button;
}

async function cleanupLocalFixtures() {
  if (!page) return;
  await page.evaluate(
    async ({ marker, runId }) => {
      function requestResult(request) {
        return new Promise((resolve, reject) => {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      function transactionDone(transaction) {
        return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve(undefined);
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      }
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open("POSDatabase", 20);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const stores = [
          "sync_queue",
          "customer_payments",
          "sale_items",
          "sales",
          "item_batches",
          "customers",
          "items",
        ];
        const tx = database.transaction(stores, "readwrite");
        const sales = await requestResult(tx.objectStore("sales").getAll());
        const fixtureSaleIds = new Set(
          sales
            .filter((row) => String(row.invoiceNo || "").includes(runId))
            .map((row) => row.id)
        );
        const predicates = {
          sync_queue: (row) =>
            String(row.localId || "").includes(`txn_rehearsal_packaged_sale_${runId}`),
          customer_payments: (row) =>
            String(row.invoiceNo || "").includes(runId) ||
            String(row.customerName || "").includes(marker),
          sale_items: (row) =>
            fixtureSaleIds.has(row.saleId) || String(row.name || "").includes(marker),
          sales: (row) => String(row.invoiceNo || "").includes(runId),
          item_batches: (row) => String(row.invoiceNo || "").includes(runId),
          customers: (row) => String(row.name || "").includes(marker),
          items: (row) => String(row.name || "").includes(marker),
        };

        for (const storeName of stores) {
          const store = tx.objectStore(storeName);
          const rows = await requestResult(store.getAll());
          for (const row of rows) {
            if (predicates[storeName](row)) {
              await requestResult(store.delete(row.id));
            }
          }
        }
        await transactionDone(tx);
      } finally {
        database.close();
      }
    },
    { marker, runId }
  );
}

function businessSnapshot(snapshot) {
  return {
    itemStock: Number(snapshot.itemStock),
    batch: {
      qtySold: Number(snapshot.batch?.qtySold),
      balance: Number(snapshot.batch?.balance),
    },
    customer: {
      invoices: Number(snapshot.customer?.invoices),
      payable: Number(snapshot.customer?.payable),
      paid: Number(snapshot.customer?.paid),
      balance: Number(snapshot.customer?.balance),
    },
    saleCount: Number(snapshot.saleCount),
    saleItemCount: Number(snapshot.saleItemCount),
    paymentCount: Number(snapshot.paymentCount),
    payment: {
      amount: Number(snapshot.payment?.amount),
      payableSnapshot: Number(snapshot.payment?.payableSnapshot),
      balanceSnapshot: Number(snapshot.payment?.balanceSnapshot),
    },
  };
}

const observedRequests = [];
try {
  const { buildSaleTransactionPayload } = await importTypescriptModule(
    builderPath
  );

  backendFixture = runPhpFixture("setup").fixture;
  assert(
    backendFixture.itemId > 0 &&
      backendFixture.customerId > 0 &&
      backendFixture.batchId > 0,
    "mapped backend fixture item, customer, and exact batch are created"
  );

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addInitScript((fixtureToken) => {
    localStorage.setItem("loggedInUserId", "DEV");
    localStorage.setItem("loggedInUserName", "Developer");
    localStorage.setItem("loggedInUserRole", "Dev");
    localStorage.setItem("jawadBro.authToken", fixtureToken);
  }, token);
  page = await context.newPage();
  await installSessionFixture(page);
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      request.method() === "POST" &&
      (url.pathname.endsWith("/api/transactions.php") ||
        url.pathname.endsWith("/api/replay/sale.php"))
    ) {
      observedRequests.push({ method: request.method(), endpoint: url.pathname });
    }
  });

  const response = await page.goto(APP_URL, {
    waitUntil: "networkidle",
    timeout: 20000,
  });
  assert(response?.ok(), "packaged Laragon frontend opens");
  await page.locator("aside").waitFor({ state: "visible", timeout: 10000 });
  await openLiveDatabase();

  const preexistingQueue = await getActionableQueueSummary();
  assert(
    preexistingQueue.actionableRows === 0,
    "live local queue has no pre-existing pending or processing rows",
    preexistingQueue
  );

  const localFixture = await createLocalSaleFixture(
    buildSaleTransactionPayload,
    backendFixture
  );
  localFixtureCreated = true;
  const pendingQueue = await readQueueRow(localFixture.queueId);
  const contract = pendingQueue?.payload?.payload?.finalizedSaleReplay;
  assert(
    pendingQueue?.status === "pending",
    "finalized Sale queue row remains pending before explicit manual replay"
  );
  assert(
    contract?.payloadVersion === 1 &&
      contract?.transactionType === "Sale" &&
      pendingQueue?.replayReadiness?.status === "ready" &&
      pendingQueue.replayReadiness.reasons.length === 0,
    "queued Sale carries replay-ready finalizedSaleReplay v1 contract"
  );
  assert(
    contract?.items?.[0]?.serverItemId === backendFixture.itemId &&
      contract?.items?.[0]?.resolvedBatch?.serverBatchId ===
        backendFixture.batchId &&
      contract?.customer?.serverId === backendFixture.customerId &&
      contract?.cylinders?.length === 0,
    "payload uses mapped backend item, exact batch, and customer without cylinder mutation"
  );

  const before = runPhpFixture("snapshot").snapshot;
  assert(
    Number(before.saleCount) === 0 &&
      Number(before.saleItemCount) === 0 &&
      nearlyEqual(before.itemStock, 10) &&
      nearlyEqual(before.batch?.balance, 10),
    "MySQL has no Sale mutation before manual replay"
  );

  const replayButton = await clickSettingsMenu();
  await Promise.all([
    page.waitForResponse(
      (value) =>
        value.request().method() === "POST" &&
        new URL(value.url()).pathname.endsWith("/api/transactions.php") &&
        value.status() === 201,
      { timeout: 10000 }
    ),
    page.waitForResponse(
      (value) =>
        value.request().method() === "POST" &&
        new URL(value.url()).pathname.endsWith("/api/replay/sale.php") &&
        value.ok(),
      { timeout: 10000 }
    ),
    replayButton.click(),
  ]);
  const doneQueue = await waitForQueueStatus(localFixture.queueId, "done");
  assert(
    doneQueue?.status === "done",
    "explicit Settings replay marks the replay-ready Sale queue row done"
  );

  const afterFirst = runPhpFixture("snapshot").snapshot;
  assert(
    Number(afterFirst.saleCount) === 1 &&
      Number(afterFirst.saleItemCount) === 1,
    "MySQL receives exactly one Sale row and one sale_items row"
  );
  assert(
    nearlyEqual(afterFirst.itemStock, 8) &&
      nearlyEqual(afterFirst.batch?.qtySold, 2) &&
      nearlyEqual(afterFirst.batch?.balance, 8),
    "MySQL stock and exact batch decrease match the local Sale"
  );
  assert(
    Number(afterFirst.customer?.invoices) === 2 &&
      nearlyEqual(afterFirst.customer?.payable, 300) &&
      nearlyEqual(afterFirst.customer?.paid, 70) &&
      nearlyEqual(afterFirst.customer?.balance, 230) &&
      Number(afterFirst.paymentCount) === 1 &&
      nearlyEqual(afterFirst.payment?.amount, 50) &&
      nearlyEqual(afterFirst.payment?.payableSnapshot, 200) &&
      nearlyEqual(afterFirst.payment?.balanceSnapshot, 230),
    "MySQL customer accounting and payment ledger match the local Sale"
  );
  assert(
    afterFirst.sync?.replay_status === "committed" &&
      Number(afterFirst.sync?.replay_attempts) === 1 &&
      afterFirst.auditActorRows.some(
        (row) =>
          row.event_type === "finalized_sale_v1_replay_completed" &&
          row.actor_type === "replay_worker" &&
          row.actor_role === "replay"
      ),
    "backend replay commits once with safe replay-worker audit attribution"
  );

  const postsAfterFirst = observedRequests.length;
  await replayButton.click();
  await page.waitForTimeout(700);
  const afterSecond = runPhpFixture("snapshot").snapshot;
  assert(
    observedRequests.length === postsAfterFirst,
    "second explicit Settings replay does not POST a completed queue row again"
  );
  assert(
    JSON.stringify(businessSnapshot(afterFirst)) ===
      JSON.stringify(businessSnapshot(afterSecond)) &&
      Number(afterSecond.sync?.replay_attempts) === 1,
    "second explicit Settings replay creates no duplicate Sale or business mutation"
  );

  const unsafePayload = buildSaleTransactionPayload({
    clientTransactionId: unsafeClientTransactionId,
    createdAt: Date.now(),
    sale: localFixture.sale,
    saleId: localFixture.saleId,
    saleItems: [localFixture.saleItem],
    finalizedSaleReplay: {
      localSaleId: localFixture.saleId,
      invoiceNo: localFixture.sale.invoiceNo,
      customer: {
        localId: localFixture.customerId,
        serverId: backendFixture.customerId,
        nameSnapshot: `${marker} Customer`,
      },
      items: [
        {
          localItemId: localFixture.itemId,
          serverItemId: null,
          originalItemId: localFixture.itemId,
          nameSnapshot: `${marker} Item`,
          qty: 2,
          price: 100,
          quantityUnit: "min",
          selectedUnit: "min",
          conversion: {
            minUnit: "piece",
            maxUnit: "piece",
            convQty: 1,
            quantityInMinUnit: 2,
          },
          resolvedBatch: {
            localBatchId: localFixture.batchId,
            serverBatchId: backendFixture.batchId,
            consumedQty: 2,
          },
          requiresCylinderMutation: false,
        },
      ],
      payments: {
        paidAmount: 50,
        source: "pos-finalization",
        method: null,
      },
      cylinders: [],
      totals: {
        subtotal: 200,
        discount: 0,
        tax: 0,
        dues: 0,
        grandTotal: 200,
        paid: 50,
        arrears: 150,
      },
    },
  });
  const unsafeQueueId = await addQueuePayload(unsafePayload);
  const postsBeforeUnsafe = observedRequests.length;
  await replayButton.click();
  const failedUnsafe = await waitForQueueStatus(unsafeQueueId, "failed");
  const afterUnsafe = runPhpFixture("snapshot").snapshot;
  assert(
    failedUnsafe?.status === "failed" &&
      failedUnsafe?.retryCount === 1 &&
      unsafePayload.replayReadiness?.status === "unsafe" &&
      unsafePayload.replayReadiness.reasons.some(
        (reason) => reason.code === "missing_server_item_id"
      ),
    "unsafe Sale fixture is blocked locally with safe readiness reason"
  );
  assert(
    observedRequests.length === postsBeforeUnsafe &&
      Number(afterUnsafe.unsafeStoredCount) === 0,
    "unsafe Sale is not stored or sent to backend replay"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        checks,
        fixturePath: "packaged Laragon frontend live POSDatabase with targeted rehearsal cleanup",
        appUrl: APP_URL,
        apiBaseUrl: API_BASE_URL,
        fixture: {
          marker,
          backendItemId: backendFixture.itemId,
          backendCustomerId: backendFixture.customerId,
          backendBatchId: backendFixture.batchId,
          cylindersUsed: false,
        },
        replayReadiness: "ready",
        readyQueueFinalStatus: doneQueue.status,
        mysql: {
          salesRows: Number(afterFirst.saleCount),
          saleItemsRows: Number(afterFirst.saleItemCount),
          itemStockBefore: Number(before.itemStock),
          itemStockAfter: Number(afterFirst.itemStock),
          batchBalanceBefore: Number(before.batch.balance),
          batchBalanceAfter: Number(afterFirst.batch.balance),
          customerBalanceBefore: Number(before.customer.balance),
          customerBalanceAfter: Number(afterFirst.customer.balance),
          paymentRows: Number(afterFirst.paymentCount),
        },
        idempotency: {
          secondManualReplayPosts: observedRequests.length - postsAfterFirst,
          mysqlStateChangedAfterSecondClick: false,
          duplicateSalesRows: Number(afterSecond.saleCount) - 1,
        },
        unsafeFixture: {
          status: failedUnsafe.status,
          reasonCodes: unsafePayload.replayReadiness.reasons.map(
            (reason) => reason.code
          ),
          backendRequests: observedRequests.length - postsBeforeUnsafe,
        },
        tokenPrinted: false,
        autoSyncEnabled: false,
        backgroundReplayAdded: false,
      },
      null,
      2
    )
  );
} finally {
  if (localFixtureCreated && page) {
    await cleanupLocalFixtures().catch((error) => {
      console.error(`Local fixture cleanup failed: ${String(error)}`);
    });
  }
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (backendFixture) {
    runPhpFixture("cleanup");
  } else {
    try {
      runPhpFixture("cleanup");
    } catch {
      // Setup may fail before fixture rows exist.
    }
  }
}
