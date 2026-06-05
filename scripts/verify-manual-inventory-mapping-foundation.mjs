#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const runId = `manual-inventory-map-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
let passed = 0;
let failed = 0;

function assert(condition, name, details) {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
    return;
  }
  failed += 1;
  console.error(`FAIL ${name}`);
  if (details !== undefined) console.error(JSON.stringify(details, null, 2));
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

async function importTypescriptModule(path) {
  const source = readFileSync(path, "utf8");
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
    fileName: path,
  }).outputText;
  return import(
    `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
  );
}

function phpHarness() {
  return String.raw`
require_once getcwd() . '/api/config/database.php';
require_once getcwd() . '/api/lib/manualItemOpeningStockMapping.php';

$pdo = get_pdo();
$runId = getenv('MANUAL_INVENTORY_MAPPING_RUN_ID');
$localItemId = (int) substr((string) abs(crc32($runId)), 0, 8);
$localBatchId = $localItemId + 1;
$mappingKey = "opening-stock-map-v1:item:$localItemId:batch:$localBatchId";
$payload = [
    'mappingVersion' => 1,
    'localItemId' => $localItemId,
    'item' => [
        'name' => 'Rehearsal Mapping Item ' . $runId,
        'barcode' => 'MAP-' . $runId,
        'description' => 'Clearly isolated mapping verifier fixture',
        'purchasePrice' => 10,
        'retailPrice' => 15,
        'discountPrice' => 14,
        'wholesalePrice' => 12,
        'category' => 'Rehearsal',
        'brand' => 'Rehearsal',
        'minunit' => 'piece',
        'maxunit' => 'piece',
        'ConvQty' => 1,
    ],
    'openingBatch' => [
        'localBatchId' => $localBatchId,
        'purchaseDate' => '2026-06-05T00:00:00.000Z',
        'qtyPurchased' => 5,
        'qtySold' => 1,
        'balance' => 4,
        'backendOpeningQuantity' => 4,
        'archivedConsumptionExcluded' => 1,
        'costPrice' => 10,
        'sourceSaleId' => 0,
        'invoiceNo' => 'Opening Stock',
    ],
];

try {
    $first = mapManualItemOpeningStock($pdo, $payload);
    $second = mapManualItemOpeningStock($pdo, $payload);
    $item = $pdo->prepare('SELECT id, client_id, availableStock FROM items WHERE id = :id');
    $item->execute(['id' => $first['serverItemId']]);
    $itemRow = $item->fetch();
    $batch = $pdo->prepare('SELECT id, itemId, qtyPurchased, qtySold, balance, sourceSaleId, invoiceNo, client_transaction_id FROM item_batches WHERE id = :id');
    $batch->execute(['id' => $first['serverBatchId']]);
    $batchRow = $batch->fetch();

    $unsafeRejected = false;
    $unsafe = $payload;
    $unsafe['localItemId'] = $localItemId + 100000000;
    $unsafe['openingBatch']['localBatchId'] = $localBatchId + 100000000;
    $unsafe['openingBatch']['balance'] = 3;
    try {
        mapManualItemOpeningStock($pdo, $unsafe);
    } catch (ManualItemOpeningStockMappingException $exception) {
        $unsafeRejected = true;
    }

    echo json_encode([
        'ok' => true,
        'first' => $first,
        'second' => $second,
        'item' => $itemRow,
        'batch' => $batchRow,
        'unsafeRejected' => $unsafeRejected,
    ], JSON_UNESCAPED_SLASHES);
} finally {
    $deleteBatch = $pdo->prepare('DELETE FROM item_batches WHERE client_transaction_id = :mapping_key');
    $deleteBatch->execute(['mapping_key' => $mappingKey]);
    $deleteItem = $pdo->prepare('DELETE FROM items WHERE client_id = :client_id');
    $deleteItem->execute(['client_id' => (string) $localItemId]);
}
`;
}

const builder = await importTypescriptModule(
  resolve(root, "src/services/posTransactionPayloadBuilder.ts")
);

const unsafe = builder.buildFinalizedSaleReplayContract({
  clientTransactionId: `${runId}-unsafe`,
  createdAt: Date.now(),
  localSaleId: 4,
  invoiceNo: "SAL-MAPPING-UNSAFE",
  customer: { localId: 1, serverId: null, nameSnapshot: "Fixture Customer" },
  items: [{
    localItemId: 2,
    serverItemId: null,
    originalItemId: 2,
    nameSnapshot: "Fixture Item",
    qty: 1,
    price: 15,
    selectedUnit: "min",
    conversion: {
      minUnit: "piece",
      maxUnit: "piece",
      convQty: 1,
      quantityInMinUnit: 1,
    },
    resolvedBatch: {
      localBatchId: 1,
      serverBatchId: null,
      consumedQty: 1,
    },
    requiresCylinderMutation: false,
  }],
  payments: { paidAmount: 15, source: "pos-finalization", method: null },
  cylinders: [],
  totals: {
    subtotal: 15,
    discount: 0,
    tax: 0,
    dues: 0,
    grandTotal: 15,
    paid: 15,
    arrears: 0,
  },
});

const ready = builder.buildFinalizedSaleReplayContract({
  ...unsafe,
  clientTransactionId: `${runId}-ready`,
  customer: { ...unsafe.customer, serverId: 71001 },
  items: unsafe.items.map((item) => ({
    ...item,
    serverItemId: 72001,
    resolvedBatch: { ...item.resolvedBatch, serverBatchId: 73001 },
  })),
});

const unsafeCodes = unsafe.replayReadiness.reasons.map((reason) => reason.code);
assert(
  unsafe.replayReadiness.status === "unsafe" &&
    unsafeCodes.includes("missing_customer_server_id") &&
    unsafeCodes.includes("missing_server_item_id") &&
    unsafeCodes.includes("missing_server_batch_id"),
  "unmapped Sale dependencies remain replay-unsafe",
  unsafe.replayReadiness
);
assert(
  ready.replayReadiness.status === "ready" &&
    ready.replayReadiness.reasons.length === 0,
  "verified customer/item/batch mappings make the Sale contract replay-ready",
  ready.replayReadiness
);

const php = spawnSync(findPhpBinary(), ["-r", phpHarness()], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, MANUAL_INVENTORY_MAPPING_RUN_ID: runId },
});

let backend = null;
try {
  backend = JSON.parse(php.stdout.trim());
} catch {
  backend = { parseError: php.stdout, stderr: php.stderr, status: php.status };
}

assert(php.status === 0 && backend?.ok === true, "manual mapping PHP harness completed", backend);
assert(
  backend?.first?.serverItemId > 0 &&
    backend?.first?.serverBatchId > 0 &&
    backend?.first?.alreadyMapped === false,
  "atomic mapping returns exact backend item and batch ids",
  backend
);
assert(
  backend?.second?.serverItemId === backend?.first?.serverItemId &&
    backend?.second?.serverBatchId === backend?.first?.serverBatchId &&
    backend?.second?.alreadyMapped === true,
  "manual mapping is idempotent",
  backend
);
assert(
    Number(backend?.item?.availableStock) === 4 &&
    Number(backend?.batch?.qtyPurchased) === 4 &&
    Number(backend?.batch?.qtySold) === 0 &&
    Number(backend?.batch?.balance) === 4 &&
    Number(backend?.batch?.sourceSaleId) === 0,
  "backend Opening Stock baseline excludes archived test consumption",
  backend
);
assert(backend?.unsafeRejected === true, "inconsistent local batch history is rejected", backend);

const purchaseEndpoint = readFileSync(resolve(root, "api/replay/purchase.php"), "utf8");
const purchaseAdapter = readFileSync(resolve(root, "api/lib/finalizedPurchaseReplayV1.php"), "utf8");
const syncEngine = readFileSync(resolve(root, "src/services/syncEngine.ts"), "utf8");
const mappingService = readFileSync(
  resolve(root, "src/services/manualInventoryMappingService.ts"),
  "utf8"
);
const customerRepository = readFileSync(
  resolve(root, "src/repositories/customerRepository.ts"),
  "utf8"
);
const readinessRefreshService = readFileSync(
  resolve(root, "src/services/saleReplayReadinessRefreshService.ts"),
  "utf8"
);
assert(
  purchaseEndpoint.includes("'batchMappings'") &&
    purchaseAdapter.includes("'localBatchId'") &&
    purchaseAdapter.includes("'serverBatchId'"),
  "Purchase replay returns exact local-to-backend batch mappings"
);
assert(
  syncEngine.includes("applyPurchaseBatchMappings") &&
    syncEngine.includes("batchRepository.applyServerIdMapping"),
  "successful Purchase replay writes exact backend batch ids locally"
);
assert(
  mappingService.includes("exactly one active local batch") &&
    mappingService.includes("Archived and recoverable finalized Sales do not fully explain") &&
    mappingService.includes('db.transaction(["items", "item_batches"], "readwrite")'),
  "manual Opening Stock service validates history and writes both mappings atomically"
);
assert(
  customerRepository.includes("mapProfileToBackend") &&
    customerRepository.includes("client_id") &&
    !customerRepository.includes("mapProfileToBackendByName"),
  "manual customer profile mapping uses exact client_id rather than a name guess"
);
assert(
  readinessRefreshService.includes("buildFinalizedSaleReplayContract") &&
    readinessRefreshService.includes('queueRow.status !== "failed"') &&
    readinessRefreshService.includes('readiness.status !== "ready"') &&
    readinessRefreshService.includes('status: "pending"'),
  "failed Sale readiness is refreshed strictly and requeued only after explicit ready validation"
);

console.log(`Summary: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
