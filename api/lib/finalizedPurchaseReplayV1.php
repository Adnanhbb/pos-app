<?php

declare(strict_types=1);

require_once __DIR__ . '/transactionReplayProcessor.php';

/*
 * Narrow finalized-Purchase replay bridge.
 *
 * This adapter accepts only the hardened finalizedPurchaseReplay v1 contract,
 * validates its backend mappings, and builds an in-memory server-id-only
 * envelope for the existing transactional replay primitives. Local IndexedDB
 * ids remain diagnostic metadata and are never used as MySQL mutation ids.
 */

class FinalizedPurchaseReplayV1Exception extends RuntimeException
{
}

function replayStoredFinalizedPurchaseV1Authorized(PDO $pdo, int|string $syncTransactionId, array $authContext): array
{
    try {
        $auth = require_replay_auth_context($authContext);
    } catch (ApiAuthException $exception) {
        unset($exception);
        return [
            'success' => false,
            'reason' => 'unauthorized',
            'authorized' => false,
            'syncTransactionId' => (int) $syncTransactionId,
        ];
    }

    $workerId = replay_worker_id_from_auth_context($auth);
    setTransactionReplayAuditActor($auth);

    try {
        $result = replayStoredFinalizedPurchaseV1($pdo, $syncTransactionId, $workerId);
        $result['authorized'] = true;
        return $result;
    } finally {
        setTransactionReplayAuditActor(null);
    }
}

function replayStoredFinalizedPurchaseV1(PDO $pdo, int|string $syncTransactionId, string $workerId): array
{
    $id = (int) $syncTransactionId;
    $worker = trim($workerId);

    if ($id <= 0 || $worker === '') {
        return ['success' => false, 'reason' => 'invalid_arguments'];
    }

    $existingRow = getReplayProcessorTransactionRow($pdo, $id);
    if ($existingRow === null) {
        return ['success' => false, 'reason' => 'not_found'];
    }

    try {
        $normalizedPayload = normalizeStoredFinalizedPurchaseV1Payload($existingRow);
    } catch (FinalizedPurchaseReplayV1Exception $exception) {
        return [
            'success' => false,
            'reason' => 'invalid_finalized_purchase_contract',
            'syncTransactionId' => $id,
            'clientTransactionId' => (string) ($existingRow['client_transaction_id'] ?? ''),
            'error' => $exception->getMessage(),
        ];
    }

    $terminalResult = skipReplayTerminalStateIfNeeded($pdo, $id, $existingRow);
    if ($terminalResult !== null) {
        $terminalResult['purchaseReplayContract'] = 'finalizedPurchaseReplay';
        $terminalResult['payloadVersion'] = 1;
        return $terminalResult;
    }

    $lock = acquireReplayLock($pdo, $id, $worker);
    if (($lock['success'] ?? false) !== true) {
        return [
            'success' => false,
            'reason' => $lock['reason'] ?? 'lock_not_acquired',
            'syncTransactionId' => $id,
            'lock' => $lock,
        ];
    }

    $transactionStarted = false;
    $clientTransactionId = (string) ($existingRow['client_transaction_id'] ?? '');

    try {
        $pdo->beginTransaction();
        $transactionStarted = true;

        $row = getReplayProcessorTransactionRowForUpdate($pdo, $id);
        if ($row === null) {
            throw new FinalizedPurchaseReplayV1Exception('Stored transaction row was not found during finalized Purchase replay.');
        }

        $clientTransactionId = (string) ($row['client_transaction_id'] ?? '');
        $normalizedPayload = normalizeStoredFinalizedPurchaseV1Payload($row);

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'finalized_purchase_v1_validation_started',
            'processing',
            'processing',
            'Finalized Purchase v1 replay validation started before any business mutation.'
        );

        validateFinalizedPurchaseV1DatabaseMappings($pdo, $normalizedPayload);
        validateReplayBusinessReferences($pdo, $normalizedPayload['serverPayload']);
        validateReplayInventorySufficiency($pdo, $normalizedPayload['serverPayload']);
        validateFinalizedPurchaseV1InvoiceOwnership($pdo, $clientTransactionId, $normalizedPayload['contract']['invoiceNo']);
        $mutationPlan = buildReplayMutationPlan($normalizedPayload['serverPayload']);

        $stockMutationResult = applyReplayStockAdjustments($pdo, $mutationPlan['stockAdjustments']);
        $salesPersistenceResult = persistReplayFinalizedSale($pdo, $id, $clientTransactionId, $normalizedPayload['serverPayload']);
        $accountingMutationResult = applyReplayAccountingMutation($pdo, $normalizedPayload['serverPayload']);
        $paymentPersistenceResult = persistReplayPaymentRows(
            $pdo,
            $id,
            $clientTransactionId,
            $normalizedPayload['serverPayload'],
            $salesPersistenceResult,
            $accountingMutationResult
        );
        alignFinalizedPurchaseV1PaymentSnapshot(
            $pdo,
            $id,
            $normalizedPayload['contract']['totals']['grandTotal'],
            $paymentPersistenceResult
        );
        $batchMutationResult = applyReplayBatchMutations(
            $pdo,
            $id,
            $clientTransactionId,
            $normalizedPayload['serverPayload'],
            $salesPersistenceResult,
            $mutationPlan
        );
        $cylinderMutationResult = applyReplayCylinderMutations(
            $pdo,
            $id,
            $clientTransactionId,
            $normalizedPayload['serverPayload'],
            $mutationPlan
        );

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'finalized_purchase_v1_replay_completed',
            'processing',
            'processing',
            'Finalized Purchase v1 replay business mutations completed atomically.'
        );

        $pdo->commit();
        $transactionStarted = false;

        $release = releaseReplayLock($pdo, $id, $worker, 'committed', null);
        if (($release['success'] ?? false) !== true) {
            return [
                'success' => false,
                'reason' => 'release_failed_after_replay',
                'syncTransactionId' => $id,
                'clientTransactionId' => $clientTransactionId,
            ];
        }

        return [
            'success' => true,
            'syncTransactionId' => $id,
            'clientTransactionId' => $clientTransactionId,
            'purchaseReplayContract' => 'finalizedPurchaseReplay',
            'payloadVersion' => 1,
            'replayStatus' => 'committed',
            'alreadyCommitted' => false,
            'businessMutationsApplied' => true,
            'stockMutationsApplied' => (int) ($stockMutationResult['appliedCount'] ?? 0) > 0,
            'purchasePersisted' => isset($salesPersistenceResult['saleId']),
            'accountingMutationsApplied' => (int) ($accountingMutationResult['appliedCount'] ?? 0) > 0,
            'paymentsPersisted' => (int) ($paymentPersistenceResult['insertedCount'] ?? 0) > 0,
            'batchMutationsApplied' => (int) ($batchMutationResult['appliedCount'] ?? 0) > 0,
            'cylinderMutationsApplied' => (int) ($cylinderMutationResult['appliedCount'] ?? 0) > 0,
            'purchaseId' => (int) $salesPersistenceResult['saleId'],
            'invoiceNo' => (string) $salesPersistenceResult['invoiceNo'],
            'saleItemsInserted' => (int) ($salesPersistenceResult['saleItemsInserted'] ?? 0),
            'batchesCreated' => count($batchMutationResult['created'] ?? []),
            'batchMappings' => array_values(array_map(
                static fn(array $batch): array => [
                    'localBatchId' => isset($batch['localBatchId']) ? (int) $batch['localBatchId'] : null,
                    'serverBatchId' => (int) ($batch['batchId'] ?? 0),
                    'serverItemId' => (int) ($batch['itemId'] ?? 0),
                ],
                $batchMutationResult['created'] ?? []
            )),
        ];
    } catch (Throwable $exception) {
        if ($transactionStarted && $pdo->inTransaction()) {
            $pdo->rollBack();
        }

        try {
            insertTransactionReplayAuditEvent(
                $pdo,
                $id,
                $clientTransactionId,
                'finalized_purchase_v1_replay_failed',
                'processing',
                'failed',
                'Finalized Purchase v1 replay failed. Any business mutations were rolled back.'
            );
        } catch (Throwable $auditException) {
            unset($auditException);
        }

        $release = releaseReplayLock($pdo, $id, $worker, 'failed', $exception->getMessage());

        return [
            'success' => false,
            'reason' => $exception instanceof FinalizedPurchaseReplayV1Exception
                ? 'invalid_finalized_purchase_contract'
                : 'finalized_purchase_replay_failed',
            'syncTransactionId' => $id,
            'clientTransactionId' => $clientTransactionId,
            'error' => $exception->getMessage(),
            'release' => $release,
        ];
    }
}

function normalizeStoredFinalizedPurchaseV1Payload(array $row): array
{
    $storedPayload = validateReplaySkeletonPayload($row);
    if (($storedPayload['transactionType'] ?? null) !== 'sale') {
        throw new FinalizedPurchaseReplayV1Exception('Only outer transactionType sale is supported for queued POS Purchases.');
    }

    $topReadiness = $storedPayload['replayReadiness'] ?? null;
    validateFinalizedPurchaseV1Readiness($topReadiness, 'Stored transaction');

    $transactionPayload = $storedPayload['payload'];
    $contract = $transactionPayload['finalizedPurchaseReplay'] ?? null;
    if (!is_array($contract) || array_is_list($contract)) {
        throw new FinalizedPurchaseReplayV1Exception('Stored transaction is missing finalizedPurchaseReplay v1 contract.');
    }

    if (($contract['payloadVersion'] ?? null) !== 1) {
        throw new FinalizedPurchaseReplayV1Exception('Only finalizedPurchaseReplay payloadVersion 1 is supported.');
    }
    if (($contract['transactionType'] ?? null) !== 'Purchase') {
        throw new FinalizedPurchaseReplayV1Exception('Only finalized Purchase transactions are supported.');
    }
    if (($contract['clientTransactionId'] ?? null) !== ($storedPayload['clientTransactionId'] ?? null)) {
        throw new FinalizedPurchaseReplayV1Exception('Finalized Purchase clientTransactionId does not match stored transaction.');
    }

    validateFinalizedPurchaseV1Readiness($contract['replayReadiness'] ?? null, 'Finalized Purchase contract');

    $legacySale = $transactionPayload['sale'] ?? null;
    if (!is_array($legacySale) || array_is_list($legacySale)) {
        throw new FinalizedPurchaseReplayV1Exception('Stored finalized Purchase is missing its sale header.');
    }
    if (($legacySale['transactionType'] ?? null) !== 'Purchase' || !empty($legacySale['isPostponed'])) {
        throw new FinalizedPurchaseReplayV1Exception('Only completed, non-postponed Purchase headers may replay.');
    }

    $localSaleId = finalizedPurchaseV1RequiredId($contract['localSaleId'] ?? null, 'localSaleId');
    $invoiceNo = finalizedPurchaseV1RequiredString($contract['invoiceNo'] ?? null, 'invoiceNo');
    if ($invoiceNo !== trim((string) ($legacySale['invoiceNo'] ?? ''))) {
        throw new FinalizedPurchaseReplayV1Exception('Finalized Purchase invoiceNo does not match stored sale header.');
    }

    $supplier = normalizeFinalizedPurchaseV1Supplier($contract['supplier'] ?? null, $legacySale);
    $items = normalizeFinalizedPurchaseV1Items($contract['items'] ?? null, $localSaleId, $invoiceNo);
    $cylinders = normalizeFinalizedPurchaseV1Cylinders($contract['cylinders'] ?? null);
    $totals = normalizeFinalizedPurchaseV1Totals($contract['totals'] ?? null);
    $paidAmount = finalizedPurchaseV1Number($contract['payments']['paidAmount'] ?? null, 'payments.paidAmount', true);

    if (abs($paidAmount - $totals['paid']) > 0.000001) {
        throw new FinalizedPurchaseReplayV1Exception('Finalized Purchase paid amount does not match totals.');
    }

    validateFinalizedPurchaseV1ItemCylinderContract($items, $cylinders);

    $serverItems = [];
    foreach ($items as $item) {
        $serverItems[] = [
            'originalItemId' => $item['serverItemId'],
            'itemId' => $item['serverItemId'],
            'name' => $item['nameSnapshot'],
            'qty' => $item['qty'],
            'price' => $item['price'],
            'costPrice' => $item['costPrice'],
            'purchaseDate' => $item['batchCreate']['purchaseDate'],
            'batchLocalId' => $item['batchCreate']['localBatchId'],
            'localBatchSourceSaleId' => $item['batchCreate']['sourceSaleId'],
            'convQty' => $item['convQty'],
        ];
    }

    $serverSupplierId = $supplier['serverId'];
    $supplierName = $supplier['nameSnapshot'];

    $serverPayload = [
        'clientTransactionId' => (string) $storedPayload['clientTransactionId'],
        'transactionType' => 'sale',
        'createdAt' => $storedPayload['createdAt'],
        'payload' => [
            'sale' => [
                'invoiceNo' => $invoiceNo,
                'date' => trim((string) ($legacySale['date'] ?? '')),
                'transactionType' => 'Purchase',
                'customerId' => null,
                'supplierId' => $serverSupplierId,
                'customerName' => '',
                'supplierName' => $supplierName,
                'subtotal' => $totals['subtotal'],
                'discount' => $totals['discount'],
                'tax' => $totals['tax'],
                'dues' => $totals['dues'],
                'grandTotal' => $totals['grandTotal'],
                'paid' => $totals['paid'],
                'arrears' => $totals['arrears'],
                'profit' => 0,
                'isPostponed' => false,
            ],
            'supplierId' => $serverSupplierId,
            'supplierName' => $supplierName,
            'saleItems' => $serverItems,
        ],
    ];

    return [
        'contract' => [
            'localSaleId' => $localSaleId,
            'invoiceNo' => $invoiceNo,
            'supplier' => $supplier,
            'items' => $items,
            'cylinders' => $cylinders,
            'totals' => $totals,
            'paidAmount' => $paidAmount,
        ],
        'serverPayload' => $serverPayload,
    ];
}

function validateFinalizedPurchaseV1Readiness($readiness, string $label): void
{
    if (!is_array($readiness) || array_is_list($readiness)) {
        throw new FinalizedPurchaseReplayV1Exception("$label replayReadiness is missing.");
    }
    if (($readiness['scope'] ?? null) !== 'finalized_purchase' || ($readiness['payloadVersion'] ?? null) !== 1) {
        throw new FinalizedPurchaseReplayV1Exception("$label replayReadiness contract is unsupported.");
    }
    if (($readiness['status'] ?? null) !== 'ready') {
        throw new FinalizedPurchaseReplayV1Exception("$label is not replay-ready.");
    }
    if (!isset($readiness['reasons']) || !is_array($readiness['reasons']) || $readiness['reasons'] !== []) {
        throw new FinalizedPurchaseReplayV1Exception("$label replayReadiness reasons must be empty.");
    }
}

function normalizeFinalizedPurchaseV1Supplier($supplier, array $legacySale): array
{
    if (!is_array($supplier) || array_is_list($supplier)) {
        throw new FinalizedPurchaseReplayV1Exception('Finalized Purchase supplier mapping must be an object.');
    }

    $directPurchase = ($supplier['directPurchase'] ?? false) === true;
    $legacySupplierId = $legacySale['supplierId'] ?? null;

    if ($directPurchase) {
        if ($legacySupplierId !== null && $legacySupplierId !== '') {
            throw new FinalizedPurchaseReplayV1Exception('Direct Purchase contract conflicts with selected supplier header.');
        }
        if (($supplier['serverId'] ?? null) !== null && ($supplier['serverId'] ?? '') !== '') {
            throw new FinalizedPurchaseReplayV1Exception('Direct Purchase must not carry a supplier server id.');
        }
        return [
            'serverId' => null,
            'nameSnapshot' => finalizedPurchaseV1OptionalString($supplier['nameSnapshot'] ?? null) ?? 'Direct Purchase',
            'directPurchase' => true,
        ];
    }

    return [
        'serverId' => finalizedPurchaseV1RequiredId($supplier['serverId'] ?? null, 'supplier.serverId'),
        'nameSnapshot' => finalizedPurchaseV1RequiredString($supplier['nameSnapshot'] ?? null, 'supplier.nameSnapshot'),
        'directPurchase' => false,
    ];
}

function normalizeFinalizedPurchaseV1Items($items, int $localSaleId, string $invoiceNo): array
{
    if (!is_array($items) || !array_is_list($items) || $items === []) {
        throw new FinalizedPurchaseReplayV1Exception('Finalized Purchase must include mapped item rows.');
    }

    $normalized = [];
    foreach ($items as $index => $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new FinalizedPurchaseReplayV1Exception("Finalized Purchase item at index $index must be an object.");
        }

        $qty = finalizedPurchaseV1Number($item['qty'] ?? null, "items.$index.qty", false);
        $price = finalizedPurchaseV1Number($item['price'] ?? null, "items.$index.price", true);
        $costPrice = finalizedPurchaseV1Number($item['costPrice'] ?? null, "items.$index.costPrice", true);
        $conversion = is_array($item['conversion'] ?? null) ? $item['conversion'] : [];
        $convQty = finalizedPurchaseV1Number($conversion['convQty'] ?? 1, "items.$index.conversion.convQty", false);
        $batchCreate = $item['batchCreate'] ?? null;

        if (!is_array($batchCreate) || array_is_list($batchCreate)) {
            throw new FinalizedPurchaseReplayV1Exception("Finalized Purchase item batchCreate at index $index must be an object.");
        }

        $batch = [
            'localBatchId' => finalizedPurchaseV1RequiredId($batchCreate['localBatchId'] ?? null, "items.$index.batchCreate.localBatchId"),
            'sourceSaleId' => finalizedPurchaseV1RequiredId($batchCreate['sourceSaleId'] ?? null, "items.$index.batchCreate.sourceSaleId"),
            'purchaseDate' => finalizedPurchaseV1RequiredString($batchCreate['purchaseDate'] ?? null, "items.$index.batchCreate.purchaseDate"),
            'qtyPurchased' => finalizedPurchaseV1Number($batchCreate['qtyPurchased'] ?? null, "items.$index.batchCreate.qtyPurchased", false),
            'balance' => finalizedPurchaseV1Number($batchCreate['balance'] ?? null, "items.$index.batchCreate.balance", false),
            'costPrice' => finalizedPurchaseV1Number($batchCreate['costPrice'] ?? null, "items.$index.batchCreate.costPrice", true),
            'invoiceNo' => finalizedPurchaseV1RequiredString($batchCreate['invoiceNo'] ?? null, "items.$index.batchCreate.invoiceNo"),
        ];

        if ($batch['sourceSaleId'] !== $localSaleId) {
            throw new FinalizedPurchaseReplayV1Exception("Finalized Purchase batch sourceSaleId mismatch at index $index.");
        }
        if ($batch['invoiceNo'] !== $invoiceNo) {
            throw new FinalizedPurchaseReplayV1Exception("Finalized Purchase batch invoiceNo mismatch at index $index.");
        }
        if (abs($batch['qtyPurchased'] - $qty) > 0.000001 || abs($batch['balance'] - $qty) > 0.000001) {
            throw new FinalizedPurchaseReplayV1Exception("Finalized Purchase batch quantity mismatch at index $index.");
        }
        if (abs($batch['costPrice'] - $costPrice) > 0.000001) {
            throw new FinalizedPurchaseReplayV1Exception("Finalized Purchase batch costPrice mismatch at index $index.");
        }

        $normalized[] = [
            'serverItemId' => finalizedPurchaseV1RequiredId($item['serverItemId'] ?? null, "items.$index.serverItemId"),
            'nameSnapshot' => finalizedPurchaseV1RequiredString($item['nameSnapshot'] ?? null, "items.$index.nameSnapshot"),
            'qty' => $qty,
            'price' => $price,
            'costPrice' => $costPrice,
            'requiresCylinderMutation' => ($item['requiresCylinderMutation'] ?? false) === true,
            'convQty' => $convQty,
            'batchCreate' => $batch,
        ];
    }

    return $normalized;
}

function normalizeFinalizedPurchaseV1Cylinders($cylinders): array
{
    if (!is_array($cylinders) || !array_is_list($cylinders)) {
        throw new FinalizedPurchaseReplayV1Exception('Finalized Purchase cylinders must be an array.');
    }

    $normalized = [];
    foreach ($cylinders as $index => $cylinder) {
        if (!is_array($cylinder) || array_is_list($cylinder)) {
            throw new FinalizedPurchaseReplayV1Exception("Finalized Purchase cylinder at index $index must be an object.");
        }

        $filledIncrease = finalizedPurchaseV1Number($cylinder['qtyFilledIncrease'] ?? null, "cylinders.$index.qtyFilledIncrease", false);
        $stockIncrease = finalizedPurchaseV1Number($cylinder['qtyStockIncrease'] ?? null, "cylinders.$index.qtyStockIncrease", false);
        if (abs($filledIncrease - $stockIncrease) > 0.000001) {
            throw new FinalizedPurchaseReplayV1Exception("Finalized Purchase cylinder quantity mismatch at index $index.");
        }

        $normalized[] = [
            'serverItemId' => finalizedPurchaseV1RequiredId($cylinder['serverItemId'] ?? null, "cylinders.$index.serverItemId"),
            'serverCylinderId' => finalizedPurchaseV1RequiredId($cylinder['serverCylinderId'] ?? null, "cylinders.$index.serverCylinderId"),
            'qtyFilledIncrease' => $filledIncrease,
            'qtyStockIncrease' => $stockIncrease,
        ];
    }

    return $normalized;
}

function validateFinalizedPurchaseV1ItemCylinderContract(array $items, array $cylinders): void
{
    $itemByServerId = [];
    foreach ($items as $item) {
        $itemByServerId[$item['serverItemId']] = $item;
    }

    foreach ($items as $index => $item) {
        $matches = array_values(array_filter(
            $cylinders,
            static fn(array $cylinder): bool => $cylinder['serverItemId'] === $item['serverItemId']
        ));
        if ($item['requiresCylinderMutation']) {
            if (count($matches) !== 1) {
                throw new FinalizedPurchaseReplayV1Exception("Finalized Purchase item is missing cylinder mapping at index $index.");
            }
            $expectedQty = (int) floor($item['qty'] / $item['convQty']);
            if ($expectedQty <= 0 || abs($matches[0]['qtyFilledIncrease'] - $expectedQty) > 0.000001) {
                throw new FinalizedPurchaseReplayV1Exception("Finalized Purchase cylinder quantity is inconsistent at index $index.");
            }
        }
    }

    foreach ($cylinders as $index => $cylinder) {
        if (!isset($itemByServerId[$cylinder['serverItemId']])) {
            throw new FinalizedPurchaseReplayV1Exception("Finalized Purchase cylinder at index $index does not match a Purchase item.");
        }
    }
}

function normalizeFinalizedPurchaseV1Totals($totals): array
{
    if (!is_array($totals) || array_is_list($totals)) {
        throw new FinalizedPurchaseReplayV1Exception('Finalized Purchase totals must be an object.');
    }

    $normalized = [];
    foreach (['subtotal', 'discount', 'tax', 'dues', 'grandTotal', 'paid', 'arrears'] as $field) {
        $normalized[$field] = finalizedPurchaseV1Number($totals[$field] ?? null, "totals.$field", true);
    }

    $invoiceAmount = $normalized['subtotal'] - $normalized['discount'] + $normalized['tax'];
    if (abs(($normalized['dues'] + $invoiceAmount) - $normalized['grandTotal']) > 0.000001) {
        throw new FinalizedPurchaseReplayV1Exception('Finalized Purchase total arithmetic is inconsistent.');
    }
    if (abs(($normalized['grandTotal'] - $normalized['paid']) - $normalized['arrears']) > 0.000001) {
        throw new FinalizedPurchaseReplayV1Exception('Finalized Purchase arrears arithmetic is inconsistent.');
    }

    return $normalized;
}

function validateFinalizedPurchaseV1DatabaseMappings(PDO $pdo, array $normalized): void
{
    $contract = $normalized['contract'];

    if ($contract['supplier']['serverId'] !== null && !finalizedPurchaseV1ActiveRowExists($pdo, 'suppliers', $contract['supplier']['serverId'])) {
        throw new FinalizedPurchaseReplayV1Exception('Mapped backend supplier does not exist.');
    }

    if (!replayTableExists($pdo, 'item_batches')) {
        throw new FinalizedPurchaseReplayV1Exception('Batch table item_batches is unavailable.');
    }

    foreach ($contract['items'] as $index => $item) {
        if (!finalizedPurchaseV1ActiveRowExists($pdo, 'items', $item['serverItemId'])) {
            throw new FinalizedPurchaseReplayV1Exception("Mapped backend item does not exist at index $index.");
        }

        $cylinder = finalizedPurchaseV1CylinderRowByItem($pdo, $item['serverItemId']);
        $mappedCylinders = array_values(array_filter(
            $contract['cylinders'],
            static fn(array $mapped): bool => $mapped['serverItemId'] === $item['serverItemId']
        ));
        if ($item['requiresCylinderMutation'] || $cylinder !== null) {
            if ($cylinder === null || count($mappedCylinders) !== 1 || $mappedCylinders[0]['serverCylinderId'] !== (int) $cylinder['id']) {
                throw new FinalizedPurchaseReplayV1Exception("Mapped backend cylinder is missing or inconsistent at index $index.");
            }
            $expectedQty = (int) floor($item['qty'] / $item['convQty']);
            if ($expectedQty <= 0 || abs($mappedCylinders[0]['qtyFilledIncrease'] - $expectedQty) > 0.000001) {
                throw new FinalizedPurchaseReplayV1Exception("Mapped backend cylinder quantity is inconsistent at index $index.");
            }
        }
    }

    if ($contract['supplier']['serverId'] !== null && abs((float) $contract['paidAmount']) > 0.000001 && !replayTableExists($pdo, 'supplier_payments')) {
        throw new FinalizedPurchaseReplayV1Exception('Supplier payment ledger table is unavailable.');
    }
}

function validateFinalizedPurchaseV1InvoiceOwnership(PDO $pdo, string $clientTransactionId, string $invoiceNo): void
{
    $statement = $pdo->prepare(
        'SELECT `client_transaction_id`
         FROM `sales`
         WHERE `invoiceNo` = :invoiceNo
         LIMIT 1
         FOR UPDATE'
    );
    $statement->execute(['invoiceNo' => $invoiceNo]);
    $row = $statement->fetch();

    if ($row && (string) ($row['client_transaction_id'] ?? '') !== $clientTransactionId) {
        throw new FinalizedPurchaseReplayV1Exception('Invoice number already belongs to a different backend Purchase.');
    }
}

function alignFinalizedPurchaseV1PaymentSnapshot(PDO $pdo, int $syncTransactionId, float $invoicePayable, array $paymentResult): void
{
    if ((int) ($paymentResult['insertedCount'] ?? 0) === 0) {
        return;
    }

    $statement = $pdo->prepare(
        'UPDATE `supplier_payments`
         SET `payableSnapshot` = :payableSnapshot
         WHERE `sync_transaction_id` = :sync_transaction_id'
    );
    $statement->execute([
        'payableSnapshot' => $invoicePayable,
        'sync_transaction_id' => $syncTransactionId,
    ]);

    if ($statement->rowCount() !== 1) {
        throw new FinalizedPurchaseReplayV1Exception('Supplier payment snapshot alignment failed.');
    }
}

function finalizedPurchaseV1ActiveRowExists(PDO $pdo, string $table, int $id): bool
{
    if (!in_array($table, ['suppliers', 'items'], true)) {
        throw new FinalizedPurchaseReplayV1Exception('Unsupported finalized Purchase mapping table.');
    }
    $statement = $pdo->prepare("SELECT `id` FROM `$table` WHERE `id` = :id AND `is_deleted` = 0 LIMIT 1 FOR UPDATE");
    $statement->execute(['id' => $id]);
    return (bool) $statement->fetch();
}

function finalizedPurchaseV1CylinderRowByItem(PDO $pdo, int $itemId): ?array
{
    $statement = $pdo->prepare(
        'SELECT `id`, `itemId`
         FROM `cylinders`
         WHERE `itemId` = :itemId AND `isDeleted` = 0
         LIMIT 1
         FOR UPDATE'
    );
    $statement->execute(['itemId' => $itemId]);
    $row = $statement->fetch();
    return $row ?: null;
}

function finalizedPurchaseV1RequiredId($value, string $field): int
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new FinalizedPurchaseReplayV1Exception("Required backend mapping $field is missing.");
    }
    $id = (int) $value;
    if ($id <= 0 || (string) $id !== trim((string) $value)) {
        throw new FinalizedPurchaseReplayV1Exception("Required backend mapping $field is invalid.");
    }
    return $id;
}

function finalizedPurchaseV1RequiredString($value, string $field): string
{
    $string = finalizedPurchaseV1OptionalString($value);
    if ($string === null) {
        throw new FinalizedPurchaseReplayV1Exception("Required finalized Purchase field $field is missing.");
    }
    return $string;
}

function finalizedPurchaseV1OptionalString($value): ?string
{
    if ($value === null) {
        return null;
    }
    $string = trim((string) $value);
    return $string === '' ? null : $string;
}

function finalizedPurchaseV1Number($value, string $field, bool $allowZero): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new FinalizedPurchaseReplayV1Exception("Required finalized Purchase field $field must be numeric.");
    }
    $number = (float) $value;
    if (!is_finite($number) || ($allowZero ? $number < 0 : $number <= 0)) {
        throw new FinalizedPurchaseReplayV1Exception("Required finalized Purchase field $field is invalid.");
    }
    return $number;
}
