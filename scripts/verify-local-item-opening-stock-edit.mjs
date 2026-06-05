import { chromium } from "playwright";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";

const port = 43179;
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);
const server = await createServer({
  root,
  configFile: false,
  optimizeDeps: {
    noDiscovery: true,
  },
  server: {
    host: "127.0.0.1",
    port,
    strictPort: true,
  },
});

let browser;
const results = [];

function check(name, ok, detail = null) {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}

function findPhpBinary() {
  if (process.env.PHP_BIN) return process.env.PHP_BIN;
  const laragonPhpRoot = "C:\\laragon\\bin\\php";
  if (existsSync(laragonPhpRoot)) {
    const candidates = readdirSync(laragonPhpRoot)
      .map((entry) => path.resolve(laragonPhpRoot, entry, "php.exe"))
      .filter(existsSync)
      .sort()
      .reverse();
    if (candidates.length > 0) return candidates[0];
  }
  return "php";
}

try {
  await server.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${port}/`, {
    waitUntil: "domcontentloaded",
  });

  const outcome = await page.evaluate(async () => {
    const runId = Date.now();
    const module = await import(`/src/db.ts?opening-stock-test=${runId}`);
    const itemsModule = await import(
      `/src/repositories/itemsRepository.ts?opening-stock-test=${runId}`
    );
    const batchesModule = await import(
      `/src/repositories/batchRepository.ts?opening-stock-test=${runId}`
    );
    const itemsRepository = itemsModule.itemsRepository;
    const batchRepository = batchesModule.batchRepository;
    const database = await module.initDB();
    await Promise.all([
      database.clear("items"),
      database.clear("item_batches"),
    ]);

    const baseItem = (name, availableStock, category = "General") => ({
      name,
      barcode: `TEST-${name}`,
      brand: "Test",
      category,
      minunit: "piece",
      maxunit: "piece",
      ConvQty: 1,
      purchasePrice: 10,
      retailPrice: 15,
      discountPrice: 14,
      wholesalePrice: 12,
      description: "Opening Stock edit verifier",
      availableStock,
      isDeleted: false,
      deletedAt: null,
    });

    const itemId = await itemsRepository.create(
      baseItem("Opening Stock Fixture", 10)
    );
    let item = await database.get("items", itemId);
    let batches = await batchRepository.getBatchesByItem(itemId);
    const created = {
      item,
      batches,
    };

    await itemsRepository.update({
      ...item,
      availableStock: 20,
    });
    const afterTwenty = {
      item: await database.get("items", itemId),
      reportBatches: await batchRepository.getBatchesByItem(itemId),
    };

    item = afterTwenty.item;
    batches = afterTwenty.reportBatches;
    const opening = batches[0];
    await database.put("item_batches", {
      ...opening,
      qtySold: 2,
      balance: 18,
    });
    await database.put("items", { ...item, availableStock: 18 });

    item = await database.get("items", itemId);
    await itemsRepository.update({
      ...item,
      availableStock: 15,
    });
    const afterIncrease = {
      item: await database.get("items", itemId),
      reportBatches: await batchRepository.getBatchesByItem(itemId),
    };

    item = afterIncrease.item;
    await itemsRepository.update({
      ...item,
      availableStock: 11,
    });
    const afterDecrease = {
      item: await database.get("items", itemId),
      reportBatches: await batchRepository.getBatchesByItem(itemId),
    };

    let belowSoldError = null;
    try {
      await itemsRepository.update({
        ...afterDecrease.item,
        availableStock: 1,
      });
    } catch (error) {
      belowSoldError = error instanceof Error ? error.message : String(error);
    }
    const afterRejectedDecrease = {
      item: await database.get("items", itemId),
      batches: await database.getAllFromIndex(
        "item_batches",
        "by-item",
        itemId
      ),
    };
    const finalization = await import(
      `/src/services/localPOSFinalizationService.ts?opening-stock-test=${Date.now()}`
    );
    const saleItem = afterRejectedDecrease.item;
    const saleBatch = afterRejectedDecrease.batches[0];
    await finalization.finalizeLocalPOSTransaction({
      sale: {
        invoiceNo: "SAL-OPENING-STOCK-TEST",
        date: new Date().toISOString(),
        transactionType: "Sale",
        customerId: 0,
        supplierId: null,
        customerName: "",
        supplierName: "",
        subtotal: 15,
        discount: 0,
        tax: 0,
        dues: 0,
        grandTotal: 15,
        paid: 15,
        arrears: 0,
        profit: 5,
        isPostponed: false,
      },
      saleItems: [
        {
          originalItemId: itemId,
          name: saleItem.name,
          qty: 1,
          price: 15,
          priceCategory: "Retail",
          discountType: "flat",
          discountValue: 0,
          taxType: "flat",
          taxValue: 0,
        },
      ],
      itemUpdates: [{ ...saleItem, availableStock: 8 }],
      batchUpdates: [
        {
          ...saleBatch,
          qtySold: 3,
          balance: 8,
        },
      ],
      batchCreates: [],
      cylinderUpdates: [],
      cylinderCustomerUpdates: [],
    });
    const afterSaleDeduction = {
      item: await database.get("items", itemId),
      batch: await database.get("item_batches", saleBatch.id),
      saleCount: (await database.getAll("sales")).length,
    };

    const purchaseItemId = await itemsRepository.create(
      baseItem("Purchase Batch Fixture", 10)
    );
    const purchaseItem = await database.get("items", purchaseItemId);
    const purchaseOpening = (
      await database.getAllFromIndex(
        "item_batches",
        "by-item",
        purchaseItemId
      )
    )[0];
    const purchaseBatchId = await database.add("item_batches", {
      itemId: purchaseItemId,
      purchaseDate: new Date().toISOString(),
      qtyPurchased: 5,
      qtySold: 0,
      balance: 5,
      costPrice: 9,
      sourceSaleId: 77,
      invoiceNo: "PUR-TEST-001",
      isDeleted: false,
      deletedAt: null,
    });
    await database.put("items", {
      ...purchaseItem,
      availableStock: 15,
    });
    await itemsRepository.update({
      ...(await database.get("items", purchaseItemId)),
      availableStock: 12,
    });
    const afterPurchasePreservation = {
      item: await database.get("items", purchaseItemId),
      opening: await database.get("item_batches", purchaseOpening.id),
      purchase: await database.get("item_batches", purchaseBatchId),
    };

    const noOpeningItemId = await itemsRepository.create(
      baseItem("No Opening Fixture", 0)
    );
    let noOpeningError = null;
    try {
      await itemsRepository.update({
        ...(await database.get("items", noOpeningItemId)),
        availableStock: 5,
      });
    } catch (error) {
      noOpeningError = error instanceof Error ? error.message : String(error);
    }

    const ambiguousItemId = await itemsRepository.create(
      baseItem("Ambiguous Opening Fixture", 10)
    );
    await database.add("item_batches", {
      itemId: ambiguousItemId,
      purchaseDate: new Date().toISOString(),
      qtyPurchased: 2,
      qtySold: 0,
      balance: 2,
      costPrice: 10,
      sourceSaleId: 0,
      invoiceNo: "Opening Stock",
      isDeleted: false,
      deletedAt: null,
    });
    let ambiguousError = null;
    try {
      await itemsRepository.update({
        ...(await database.get("items", ambiguousItemId)),
        availableStock: 12,
      });
    } catch (error) {
      ambiguousError = error instanceof Error ? error.message : String(error);
    }

    const mappedItemId = await itemsRepository.create(
      baseItem("Mapped Fixture", 10)
    );
    const mappedItem = await database.get("items", mappedItemId);
    const mappedBatch = (
      await database.getAllFromIndex(
        "item_batches",
        "by-item",
        mappedItemId
      )
    )[0];
    await database.put("items", { ...mappedItem, serverId: 901 });
    await database.put("item_batches", { ...mappedBatch, serverId: 902 });
    let mappedError = null;
    try {
      await itemsRepository.update({
        ...(await database.get("items", mappedItemId)),
        availableStock: 12,
      });
    } catch (error) {
      mappedError = error instanceof Error ? error.message : String(error);
    }
    const mappedAfter = {
      item: await database.get("items", mappedItemId),
      batch: await database.get("item_batches", mappedBatch.id),
    };

    const cylinderItemId = await itemsRepository.create(
      baseItem("Cylinder Fixture", 10, "Gas")
    );
    let cylinderError = null;
    try {
      await itemsRepository.update({
        ...(await database.get("items", cylinderItemId)),
        availableStock: 12,
      });
    } catch (error) {
      cylinderError = error instanceof Error ? error.message : String(error);
    }

    return {
      created,
      afterTwenty,
      afterIncrease,
      afterDecrease,
      belowSoldError,
      afterRejectedDecrease,
      afterSaleDeduction,
      afterPurchasePreservation,
      noOpeningError,
      ambiguousError,
      mappedError,
      mappedAfter,
      cylinderError,
    };
  });

  check(
    "item creation atomically creates one Opening Stock batch",
    outcome.created.batches.length === 1 &&
      outcome.created.batches[0].invoiceNo === "Opening Stock" &&
      outcome.created.batches[0].sourceSaleId === 0 &&
      outcome.created.batches[0].qtyPurchased === 10 &&
      outcome.created.batches[0].balance === 10
  );
  check(
    "Items repository edit 10 to 20 is visible through PurReport batch path",
    outcome.afterTwenty.item.availableStock === 20 &&
      outcome.afterTwenty.reportBatches.length === 1 &&
      outcome.afterTwenty.reportBatches[0].qtyPurchased === 20 &&
      outcome.afterTwenty.reportBatches[0].qtySold === 0 &&
      outcome.afterTwenty.reportBatches[0].balance === 20
  );
  check(
    "upward edit preserves sold quantity and raises batch balance",
    outcome.afterIncrease.reportBatches[0].qtyPurchased === 15 &&
      outcome.afterIncrease.reportBatches[0].qtySold === 2 &&
      outcome.afterIncrease.reportBatches[0].balance === 13 &&
      outcome.afterIncrease.item.availableStock === 13
  );
  check(
    "downward edit remains above sold quantity and updates safely",
    outcome.afterDecrease.reportBatches[0].qtyPurchased === 11 &&
      outcome.afterDecrease.reportBatches[0].qtySold === 2 &&
      outcome.afterDecrease.reportBatches[0].balance === 9 &&
      outcome.afterDecrease.item.availableStock === 9
  );
  check(
    "edit below sold quantity rejects before either row changes",
    outcome.belowSoldError?.includes("already sold quantity") &&
      outcome.afterRejectedDecrease.item.availableStock === 9 &&
      outcome.afterRejectedDecrease.batches[0].qtyPurchased === 11 &&
      outcome.afterRejectedDecrease.batches[0].balance === 9
  );
  check(
    "purchase-created batch remains unchanged while total stock follows Opening Stock delta",
    outcome.afterPurchasePreservation.opening.qtyPurchased === 12 &&
      outcome.afterPurchasePreservation.opening.balance === 12 &&
      outcome.afterPurchasePreservation.purchase.invoiceNo === "PUR-TEST-001" &&
      outcome.afterPurchasePreservation.purchase.qtyPurchased === 5 &&
      outcome.afterPurchasePreservation.purchase.balance === 5 &&
      outcome.afterPurchasePreservation.item.availableStock === 17
  );
  check(
    "normal Sale deduction still commits after Opening Stock edit",
    outcome.afterSaleDeduction.saleCount === 1 &&
      outcome.afterSaleDeduction.item.availableStock === 8 &&
      outcome.afterSaleDeduction.batch.qtyPurchased === 11 &&
      outcome.afterSaleDeduction.batch.qtySold === 3 &&
      outcome.afterSaleDeduction.batch.balance === 8
  );
  check(
    "missing Opening Stock batch rejects stock edits",
    outcome.noOpeningError?.includes("no active Opening Stock batch")
  );
  check(
    "multiple active Opening Stock batches reject ambiguous edits",
    outcome.ambiguousError?.includes("multiple active Opening Stock batches")
  );
  check(
    "mapped Opening Stock does not mutate locally when backend adjustment fails",
    Boolean(outcome.mappedError) &&
      outcome.mappedAfter.item.availableStock === 10 &&
      outcome.mappedAfter.batch.qtyPurchased === 10 &&
      outcome.mappedAfter.batch.balance === 10
  );
  check(
    "cylinder Opening Stock rejects generic item adjustment",
    outcome.cylinderError?.includes("cylinder workflow")
  );
} finally {
  if (browser) await browser.close();
  await server.close();
}

const backendRunId = `opening-stock-edit-${Date.now()}`;
const backendHarness = String.raw`
require getcwd() . '/api/config/database.php';
require getcwd() . '/api/lib/mappedOpeningStockAdjustment.php';
$pdo = get_pdo();
$runId = getenv('OPENING_STOCK_EDIT_RUN_ID');
$localItemId = (int) substr((string) abs(crc32($runId)), 0, 8);
$clientId = (string) $localItemId;
$itemId = 0;
$batchId = 0;
try {
    $item = $pdo->prepare(
        'INSERT INTO items
         (client_id, name, barcode, purchasePrice, retailPrice, wholesalePrice,
          availableStock, category, ConvQty, is_deleted)
         VALUES (:client_id, :name, :barcode, 10, 15, 12, 10, :category, 1, 0)'
    );
    $item->execute([
        'client_id' => $clientId,
        'name' => 'Opening Stock Edit Fixture ' . $runId,
        'barcode' => 'OSE-' . $runId,
        'category' => 'Rehearsal',
    ]);
    $itemId = (int) $pdo->lastInsertId();
    $batch = $pdo->prepare(
        'INSERT INTO item_batches
         (itemId, purchaseDate, qtyPurchased, qtySold, balance, costPrice,
          sourceSaleId, invoiceNo, isDeleted, deletedAt)
         VALUES (:itemId, :purchaseDate, 10, 0, 10, 10, 0, :invoiceNo, 0, NULL)'
    );
    $batch->execute([
        'itemId' => $itemId,
        'purchaseDate' => '2026-06-05T00:00:00.000Z',
        'invoiceNo' => 'Opening Stock',
    ]);
    $batchId = (int) $pdo->lastInsertId();

    $payload = [
        'adjustmentVersion' => 1,
        'localItemId' => $localItemId,
        'serverItemId' => $itemId,
        'localBatchId' => 1,
        'serverBatchId' => $batchId,
        'expected' => [
            'itemAvailableStock' => 10,
            'qtyPurchased' => 10,
            'qtySold' => 0,
            'balance' => 10,
        ],
        'requestedOpeningStock' => 20,
    ];
    $adjusted = adjustMappedOpeningStock($pdo, $payload);
    $itemRow = $pdo->query(
        'SELECT availableStock FROM items WHERE id = ' . $itemId
    )->fetch();
    $batchRow = $pdo->query(
        'SELECT qtyPurchased, qtySold, balance FROM item_batches WHERE id = ' . $batchId
    )->fetch();

    $staleRejected = false;
    try {
        adjustMappedOpeningStock($pdo, $payload);
    } catch (MappedOpeningStockAdjustmentException $exception) {
        $staleRejected = str_contains($exception->getMessage(), 'changed');
    }

    echo json_encode([
        'ok' => true,
        'adjusted' => $adjusted,
        'item' => $itemRow,
        'batch' => $batchRow,
        'staleRejected' => $staleRejected,
    ], JSON_UNESCAPED_SLASHES);
} finally {
    if ($batchId > 0) {
        $pdo->prepare('DELETE FROM item_batches WHERE id = :id')->execute(['id' => $batchId]);
    }
    if ($itemId > 0) {
        $pdo->prepare('DELETE FROM items WHERE id = :id')->execute(['id' => $itemId]);
    }
}
`;
const php = spawnSync(findPhpBinary(), ["-r", backendHarness], {
  cwd: root,
  encoding: "utf8",
  env: { ...process.env, OPENING_STOCK_EDIT_RUN_ID: backendRunId },
});
let backend = null;
try {
  backend = JSON.parse(php.stdout.trim());
} catch {
  backend = { stdout: php.stdout, stderr: php.stderr, status: php.status };
}
check(
  "mapped backend adjustment updates item and Opening Stock batch atomically",
  php.status === 0 &&
    backend?.ok === true &&
    Number(backend.item?.availableStock) === 20 &&
    Number(backend.batch?.qtyPurchased) === 20 &&
    Number(backend.batch?.qtySold) === 0 &&
    Number(backend.batch?.balance) === 20,
  backend
);
check(
  "mapped backend adjustment rejects stale expected quantities",
  backend?.staleRejected === true,
  backend
);

const failed = results.filter((result) => !result.ok);
console.log(`Summary: ${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length > 0) process.exitCode = 1;
