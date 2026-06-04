<?php

declare(strict_types=1);

require_once __DIR__ . '/transactionReplayProcessor.php';

/*
 * Narrow finalized-Supplier-Return replay bridge.
 *
 * This adapter accepts only the hardened finalizedSupplierReturnReplay v1
 * contract, validates its backend mappings, and builds an in-memory
 * server-id-only envelope for the existing transactional replay primitives.
 * Local IndexedDB ids remain diagnostic metadata and are never used as MySQL
 * mutation ids.
 */

class FinalizedSupplierReturnReplayV1Exception extends RuntimeException
{
}

function replayStoredFinalizedSupplierReturnV1Authorized(PDO $pdo, int|string $syncTransactionId, array $authContext): array
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
        $result = replayStoredFinalizedSupplierReturnV1($pdo, $syncTransactionId, $workerId);
        $result['authorized'] = true;
        return $result;
    } finally {
        setTransactionReplayAuditActor(null);
    }
}

function replayStoredFinalizedSupplierReturnV1(PDO $pdo, int|string $syncTransactionId, string $workerId): array
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
        $normalizedPayload = normalizeStoredFinalizedSupplierReturnV1Payload($existingRow);
    } catch (FinalizedSupplierReturnReplayV1Exception $exception) {
        return [
            'success' => false,
            'reason' => 'invalid_finalized_supplier_return_contract',
            'syncTransactionId' => $id,
            'clientTransactionId' => (string) ($existingRow['client_transaction_id'] ?? ''),
            'error' => $exception->getMessage(),
        ];
    }

    $terminalResult = skipReplayTerminalStateIfNeeded($pdo, $id, $existingRow);
    if ($terminalResult !== null) {
        $terminalResult['supplierReturnReplayContract'] = 'finalizedSupplierReturnReplay';
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
            throw new FinalizedSupplierReturnReplayV1Exception('Stored transaction row was not found during finalized Supplier Return replay.');
        }

        $clientTransactionId = (string) ($row['client_transaction_id'] ?? '');
        $normalizedPayload = normalizeStoredFinalizedSupplierReturnV1Payload($row);

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'finalized_supplier_return_v1_validation_started',
            'processing',
            'processing',
            'Finalized Supplier Return v1 replay validation started before any business mutation.'
        );

        validateFinalizedSupplierReturnV1DatabaseMappings($pdo, $normalizedPayload);
        validateReplayBusinessReferences($pdo, $normalizedPayload['serverPayload']);
        validateReplayInventorySufficiency($pdo, $normalizedPayload['serverPayload']);
        validateFinalizedSupplierReturnV1InvoiceOwnership($pdo, $clientTransactionId, $normalizedPayload['contract']['invoiceNo']);
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
        alignFinalizedSupplierReturnV1PaymentSnapshot(
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
            'finalized_supplier_return_v1_replay_completed',
            'processing',
            'processing',
            'Finalized Supplier Return v1 replay business mutations completed atomically.'
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
            'supplierReturnReplayContract' => 'finalizedSupplierReturnReplay',
            'payloadVersion' => 1,
            'replayStatus' => 'committed',
            'alreadyCommitted' => false,
            'businessMutationsApplied' => true,
            'stockMutationsApplied' => (int) ($stockMutationResult['appliedCount'] ?? 0) > 0,
            'supplierReturnPersisted' => isset($salesPersistenceResult['saleId']),
            'accountingMutationsApplied' => (int) ($accountingMutationResult['appliedCount'] ?? 0) > 0,
            'paymentsPersisted' => (int) ($paymentPersistenceResult['insertedCount'] ?? 0) > 0,
            'batchMutationsApplied' => (int) ($batchMutationResult['appliedCount'] ?? 0) > 0,
            'cylinderMutationsApplied' => (int) ($cylinderMutationResult['appliedCount'] ?? 0) > 0,
            'supplierReturnId' => (int) $salesPersistenceResult['saleId'],
            'invoiceNo' => (string) $salesPersistenceResult['invoiceNo'],
            'saleItemsInserted' => (int) ($salesPersistenceResult['saleItemsInserted'] ?? 0),
            'sourceBatchesReduced' => count($batchMutationResult['consumed'] ?? []),
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
                'finalized_supplier_return_v1_replay_failed',
                'processing',
                'failed',
                'Finalized Supplier Return v1 replay failed. Any business mutations were rolled back.'
            );
        } catch (Throwable $auditException) {
            unset($auditException);
        }

        $release = releaseReplayLock($pdo, $id, $worker, 'failed', $exception->getMessage());

        return [
            'success' => false,
            'reason' => $exception instanceof FinalizedSupplierReturnReplayV1Exception
                ? 'invalid_finalized_supplier_return_contract'
                : 'finalized_supplier_return_replay_failed',
            'syncTransactionId' => $id,
            'clientTransactionId' => $clientTransactionId,
            'error' => $exception->getMessage(),
            'release' => $release,
        ];
    }
}

function normalizeStoredFinalizedSupplierReturnV1Payload(array $row): array
{
    $storedPayload = validateReplaySkeletonPayload($row);
    if (($storedPayload['transactionType'] ?? null) !== 'return') {
        throw new FinalizedSupplierReturnReplayV1Exception('Only outer transactionType return is supported for queued Supplier Returns.');
    }

    $transactionPayload = $storedPayload['payload'];
    if (($transactionPayload['returnMode'] ?? null) !== 'supplier') {
        throw new FinalizedSupplierReturnReplayV1Exception('Only supplier returnMode is supported.');
    }

    $topReadiness = $storedPayload['replayReadiness'] ?? null;
    validateFinalizedSupplierReturnV1Readiness($topReadiness, 'Stored transaction');

    $contract = $transactionPayload['finalizedSupplierReturnReplay'] ?? null;
    if (!is_array($contract) || array_is_list($contract)) {
        throw new FinalizedSupplierReturnReplayV1Exception('Stored transaction is missing finalizedSupplierReturnReplay v1 contract.');
    }

    if (($contract['payloadVersion'] ?? null) !== 1) {
        throw new FinalizedSupplierReturnReplayV1Exception('Only finalizedSupplierReturnReplay payloadVersion 1 is supported.');
    }
    if (($contract['transactionType'] ?? null) !== 'Return') {
        throw new FinalizedSupplierReturnReplayV1Exception('Only finalized Return transactions are supported.');
    }
    if (($contract['returnMode'] ?? null) !== 'supplier') {
        throw new FinalizedSupplierReturnReplayV1Exception('Only finalized Supplier Return contracts are supported.');
    }
    if (($contract['clientTransactionId'] ?? null) !== ($storedPayload['clientTransactionId'] ?? null)) {
        throw new FinalizedSupplierReturnReplayV1Exception('Finalized Supplier Return clientTransactionId does not match stored transaction.');
    }

    validateFinalizedSupplierReturnV1Readiness($contract['replayReadiness'] ?? null, 'Finalized Supplier Return contract');

    $legacySale = $transactionPayload['sale'] ?? null;
    if (!is_array($legacySale) || array_is_list($legacySale)) {
        throw new FinalizedSupplierReturnReplayV1Exception('Stored finalized Supplier Return is missing its sale header.');
    }
    if (($legacySale['transactionType'] ?? null) !== 'Return' || !empty($legacySale['isPostponed'])) {
        throw new FinalizedSupplierReturnReplayV1Exception('Only completed, non-postponed Supplier Return headers may replay.');
    }

    $localSaleId = finalizedSupplierReturnV1RequiredId($contract['localSaleId'] ?? null, 'localSaleId');
    $invoiceNo = finalizedSupplierReturnV1RequiredString($contract['invoiceNo'] ?? null, 'invoiceNo');
    if ($invoiceNo !== trim((string) ($legacySale['invoiceNo'] ?? ''))) {
        throw new FinalizedSupplierReturnReplayV1Exception('Finalized Supplier Return invoiceNo does not match stored sale header.');
    }

    $supplier = normalizeFinalizedSupplierReturnV1Supplier($contract['supplier'] ?? null);
    $items = normalizeFinalizedSupplierReturnV1Items($contract['items'] ?? null);
    $cylinders = normalizeFinalizedSupplierReturnV1Cylinders($contract['cylinders'] ?? null);
    $totals = normalizeFinalizedSupplierReturnV1Totals($contract['totals'] ?? null);
    $paidAmount = finalizedSupplierReturnV1Number($contract['payments']['paidAmount'] ?? null, 'payments.paidAmount', true, true);

    if (abs($paidAmount - $totals['paid']) > 0.000001) {
        throw new FinalizedSupplierReturnReplayV1Exception('Finalized Supplier Return paid amount does not match totals.');
    }

    validateFinalizedSupplierReturnV1ItemCylinderContract($items, $cylinders);

    $serverItems = [];
    foreach ($items as $item) {
        $serverItems[] = [
            'originalItemId' => $item['serverItemId'],
            'itemId' => $item['serverItemId'],
            'name' => $item['nameSnapshot'],
            'qty' => $item['qty'],
            'price' => $item['price'],
            'costPrice' => $item['costPrice'],
            'batchId' => $item['sourceBatch']['serverBatchId'],
            'convQty' => $item['convQty'],
        ];
    }

    $serverPayload = [
        'clientTransactionId' => (string) $storedPayload['clientTransactionId'],
        'transactionType' => 'return',
        'createdAt' => $storedPayload['createdAt'],
        'payload' => [
            'returnMode' => 'supplier',
            'sale' => [
                'invoiceNo' => $invoiceNo,
                'date' => trim((string) ($legacySale['date'] ?? '')),
                'transactionType' => 'Return',
                'customerId' => null,
                'supplierId' => $supplier['serverId'],
                'customerName' => '',
                'supplierName' => $supplier['nameSnapshot'],
                'subtotal' => $totals['subtotal'],
                'discount' => $totals['discount'],
                'tax' => $totals['tax'],
                'dues' => $totals['dues'],
                'grandTotal' => $totals['grandTotal'],
                'paid' => $totals['paid'],
                'arrears' => $totals['arrears'],
                'profit' => finalizedSupplierReturnV1FiniteNumber($legacySale['profit'] ?? 0, 'sale.profit'),
                'isPostponed' => false,
            ],
            'supplierId' => $supplier['serverId'],
            'supplierName' => $supplier['nameSnapshot'],
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

function validateFinalizedSupplierReturnV1Readiness($readiness, string $label): void
{
    if (!is_array($readiness) || array_is_list($readiness)) {
        throw new FinalizedSupplierReturnReplayV1Exception("$label replayReadiness is missing.");
    }
    if (($readiness['scope'] ?? null) !== 'finalized_supplier_return' || ($readiness['payloadVersion'] ?? null) !== 1) {
        throw new FinalizedSupplierReturnReplayV1Exception("$label replayReadiness contract is unsupported.");
    }
    if (($readiness['status'] ?? null) !== 'ready') {
        throw new FinalizedSupplierReturnReplayV1Exception("$label is not replay-ready.");
    }
    if (!isset($readiness['reasons']) || !is_array($readiness['reasons']) || $readiness['reasons'] !== []) {
        throw new FinalizedSupplierReturnReplayV1Exception("$label replayReadiness reasons must be empty.");
    }
}

function normalizeFinalizedSupplierReturnV1Supplier($supplier): array
{
    if (!is_array($supplier) || array_is_list($supplier)) {
        throw new FinalizedSupplierReturnReplayV1Exception('Finalized Supplier Return supplier mapping must be an object.');
    }

    return [
        'serverId' => finalizedSupplierReturnV1RequiredId($supplier['serverId'] ?? null, 'supplier.serverId'),
        'nameSnapshot' => finalizedSupplierReturnV1RequiredString($supplier['nameSnapshot'] ?? null, 'supplier.nameSnapshot'),
    ];
}

function normalizeFinalizedSupplierReturnV1Items($items): array
{
    if (!is_array($items) || !array_is_list($items) || $items === []) {
        throw new FinalizedSupplierReturnReplayV1Exception('Finalized Supplier Return must include mapped item rows.');
    }

    $normalized = [];
    foreach ($items as $index => $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new FinalizedSupplierReturnReplayV1Exception("Finalized Supplier Return item at index $index must be an object.");
        }

        $qty = finalizedSupplierReturnV1Number($item['qty'] ?? null, "items.$index.qty", false, false);
        $price = finalizedSupplierReturnV1Number($item['price'] ?? null, "items.$index.price", true, false);
        $costPrice = finalizedSupplierReturnV1Number($item['costPrice'] ?? null, "items.$index.costPrice", true, false);
        $conversion = is_array($item['conversion'] ?? null) ? $item['conversion'] : [];
        $convQty = finalizedSupplierReturnV1Number($conversion['convQty'] ?? 1, "items.$index.conversion.convQty", false, false);
        $sourceBatch = $item['sourceBatch'] ?? null;

        if (!is_array($sourceBatch) || array_is_list($sourceBatch)) {
            throw new FinalizedSupplierReturnReplayV1Exception("Finalized Supplier Return item sourceBatch at index $index must be an object.");
        }

        $returnedQty = finalizedSupplierReturnV1Number($sourceBatch['returnedQty'] ?? null, "items.$index.sourceBatch.returnedQty", false, false);
        if (abs($returnedQty - $qty) > 0.000001) {
            throw new FinalizedSupplierReturnReplayV1Exception("Finalized Supplier Return source batch returned quantity mismatch at index $index.");
        }

        $batch = [
            'localBatchId' => finalizedSupplierReturnV1RequiredId($sourceBatch['localBatchId'] ?? null, "items.$index.sourceBatch.localBatchId"),
            'serverBatchId' => finalizedSupplierReturnV1RequiredId($sourceBatch['serverBatchId'] ?? null, "items.$index.sourceBatch.serverBatchId"),
            'returnedQty' => $returnedQty,
            'qtyPurchasedBefore' => finalizedSupplierReturnV1NullableNumber($sourceBatch['qtyPurchasedBefore'] ?? null, "items.$index.sourceBatch.qtyPurchasedBefore"),
            'qtyPurchasedAfter' => finalizedSupplierReturnV1NullableNumber($sourceBatch['qtyPurchasedAfter'] ?? null, "items.$index.sourceBatch.qtyPurchasedAfter"),
            'balanceBefore' => finalizedSupplierReturnV1NullableNumber($sourceBatch['balanceBefore'] ?? null, "items.$index.sourceBatch.balanceBefore"),
            'balanceAfter' => finalizedSupplierReturnV1NullableNumber($sourceBatch['balanceAfter'] ?? null, "items.$index.sourceBatch.balanceAfter"),
        ];

        if ($batch['qtyPurchasedBefore'] !== null && $batch['qtyPurchasedAfter'] !== null && abs($batch['qtyPurchasedBefore'] - $returnedQty - $batch['qtyPurchasedAfter']) > 0.000001) {
            throw new FinalizedSupplierReturnReplayV1Exception("Finalized Supplier Return source batch purchased delta mismatch at index $index.");
        }
        if ($batch['balanceBefore'] !== null && $batch['balanceAfter'] !== null && abs($batch['balanceBefore'] - $returnedQty - $batch['balanceAfter']) > 0.000001) {
            throw new FinalizedSupplierReturnReplayV1Exception("Finalized Supplier Return source batch balance delta mismatch at index $index.");
        }

        $normalized[] = [
            'serverItemId' => finalizedSupplierReturnV1RequiredId($item['serverItemId'] ?? null, "items.$index.serverItemId"),
            'nameSnapshot' => finalizedSupplierReturnV1RequiredString($item['nameSnapshot'] ?? null, "items.$index.nameSnapshot"),
            'qty' => $qty,
            'price' => $price,
            'costPrice' => $costPrice,
            'requiresCylinderMutation' => ($item['requiresCylinderMutation'] ?? false) === true,
            'convQty' => $convQty,
            'sourceBatch' => $batch,
        ];
    }

    return $normalized;
}

function normalizeFinalizedSupplierReturnV1Cylinders($cylinders): array
{
    if (!is_array($cylinders) || !array_is_list($cylinders)) {
        throw new FinalizedSupplierReturnReplayV1Exception('Finalized Supplier Return cylinders must be an array.');
    }

    $normalized = [];
    foreach ($cylinders as $index => $cylinder) {
        if (!is_array($cylinder) || array_is_list($cylinder)) {
            throw new FinalizedSupplierReturnReplayV1Exception("Finalized Supplier Return cylinder at index $index must be an object.");
        }

        if (($cylinder['movement'] ?? null) !== 'filledDecrease') {
            throw new FinalizedSupplierReturnReplayV1Exception("Finalized Supplier Return cylinder movement is unsupported at index $index.");
        }

        $normalized[] = [
            'serverItemId' => finalizedSupplierReturnV1RequiredId($cylinder['serverItemId'] ?? null, "cylinders.$index.serverItemId"),
            'serverCylinderId' => finalizedSupplierReturnV1RequiredId($cylinder['serverCylinderId'] ?? null, "cylinders.$index.serverCylinderId"),
            'qtyReturned' => finalizedSupplierReturnV1Number($cylinder['qtyReturned'] ?? null, "cylinders.$index.qtyReturned", false, false),
            'filledCylindersBefore' => finalizedSupplierReturnV1NullableNumber($cylinder['filledCylindersBefore'] ?? null, "cylinders.$index.filledCylindersBefore"),
            'filledCylindersAfter' => finalizedSupplierReturnV1NullableNumber($cylinder['filledCylindersAfter'] ?? null, "cylinders.$index.filledCylindersAfter"),
            'qtyInStockBefore' => finalizedSupplierReturnV1NullableNumber($cylinder['qtyInStockBefore'] ?? null, "cylinders.$index.qtyInStockBefore"),
            'qtyInStockAfter' => finalizedSupplierReturnV1NullableNumber($cylinder['qtyInStockAfter'] ?? null, "cylinders.$index.qtyInStockAfter"),
        ];
    }

    return $normalized;
}

function validateFinalizedSupplierReturnV1ItemCylinderContract(array $items, array $cylinders): void
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
                throw new FinalizedSupplierReturnReplayV1Exception("Finalized Supplier Return item is missing cylinder mapping at index $index.");
            }
            $expectedQty = (int) floor($item['qty'] / $item['convQty']);
            if ($expectedQty <= 0 || abs($matches[0]['qtyReturned'] - $expectedQty) > 0.000001) {
                throw new FinalizedSupplierReturnReplayV1Exception("Finalized Supplier Return cylinder quantity is inconsistent at index $index.");
            }
        }
    }

    foreach ($cylinders as $index => $cylinder) {
        if (!isset($itemByServerId[$cylinder['serverItemId']])) {
            throw new FinalizedSupplierReturnReplayV1Exception("Finalized Supplier Return cylinder at index $index does not match a Supplier Return item.");
        }
    }
}

function normalizeFinalizedSupplierReturnV1Totals($totals): array
{
    if (!is_array($totals) || array_is_list($totals)) {
        throw new FinalizedSupplierReturnReplayV1Exception('Finalized Supplier Return totals must be an object.');
    }

    $normalized = [];
    foreach (['subtotal', 'discount', 'tax', 'dues', 'grandTotal', 'arrears'] as $field) {
        $normalized[$field] = finalizedSupplierReturnV1Number($totals[$field] ?? null, "totals.$field", true, false);
    }
    $normalized['paid'] = finalizedSupplierReturnV1Number($totals['paid'] ?? null, 'totals.paid', true, true);

    $returnAmount = $normalized['subtotal'] - $normalized['discount'] + $normalized['tax'];
    if ($returnAmount < -0.000001) {
        throw new FinalizedSupplierReturnReplayV1Exception('Finalized Supplier Return amount cannot be negative.');
    }
    if (abs(($normalized['dues'] - $returnAmount) - $normalized['grandTotal']) > 0.000001) {
        throw new FinalizedSupplierReturnReplayV1Exception('Finalized Supplier Return total arithmetic is inconsistent.');
    }
    if (abs(($normalized['grandTotal'] - $normalized['paid']) - $normalized['arrears']) > 0.000001) {
        throw new FinalizedSupplierReturnReplayV1Exception('Finalized Supplier Return arrears arithmetic is inconsistent.');
    }

    return $normalized;
}

function validateFinalizedSupplierReturnV1DatabaseMappings(PDO $pdo, array $normalized): void
{
    $contract = $normalized['contract'];

    if (!finalizedSupplierReturnV1ActiveRowExists($pdo, 'suppliers', $contract['supplier']['serverId'])) {
        throw new FinalizedSupplierReturnReplayV1Exception('Mapped backend supplier does not exist.');
    }

    if (!replayTableExists($pdo, 'item_batches')) {
        throw new FinalizedSupplierReturnReplayV1Exception('Batch table item_batches is unavailable.');
    }

    foreach ($contract['items'] as $index => $item) {
        if (!finalizedSupplierReturnV1ActiveRowExists($pdo, 'items', $item['serverItemId'])) {
            throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend item does not exist at index $index.");
        }

        $sourceBatch = finalizedSupplierReturnV1SourceBatchRow($pdo, $item);
        if ($sourceBatch === null) {
            throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend source batch is missing at index $index.");
        }
        if ((float) $sourceBatch['qtyPurchased'] + 0.000001 < $item['qty']) {
            throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend source batch qtyPurchased is insufficient at index $index.");
        }
        if ((float) $sourceBatch['balance'] + 0.000001 < $item['qty']) {
            throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend source batch balance is insufficient at index $index.");
        }
        if ($item['sourceBatch']['qtyPurchasedBefore'] !== null && abs((float) $sourceBatch['qtyPurchased'] - $item['sourceBatch']['qtyPurchasedBefore']) > 0.000001) {
            throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend source batch qtyPurchased no longer matches the Supplier Return contract at index $index.");
        }
        if ($item['sourceBatch']['balanceBefore'] !== null && abs((float) $sourceBatch['balance'] - $item['sourceBatch']['balanceBefore']) > 0.000001) {
            throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend source batch balance no longer matches the Supplier Return contract at index $index.");
        }

        $cylinder = finalizedSupplierReturnV1CylinderRowByItem($pdo, $item['serverItemId']);
        $mappedCylinders = array_values(array_filter(
            $contract['cylinders'],
            static fn(array $mapped): bool => $mapped['serverItemId'] === $item['serverItemId']
        ));
        if ($item['requiresCylinderMutation'] || $cylinder !== null) {
            if ($cylinder === null || count($mappedCylinders) !== 1 || $mappedCylinders[0]['serverCylinderId'] !== (int) $cylinder['id']) {
                throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend cylinder is missing or inconsistent at index $index.");
            }
            $expectedQty = (int) floor($item['qty'] / $item['convQty']);
            if ($expectedQty <= 0 || abs($mappedCylinders[0]['qtyReturned'] - $expectedQty) > 0.000001) {
                throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend cylinder quantity is inconsistent at index $index.");
            }
            if ((float) $cylinder['filledCylinders'] + 0.000001 < $expectedQty) {
                throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend filled cylinder count is insufficient at index $index.");
            }
            if ((float) $cylinder['qtyInStock'] + 0.000001 < $expectedQty) {
                throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend cylinder stock is insufficient at index $index.");
            }
            if ($mappedCylinders[0]['filledCylindersBefore'] !== null && abs((float) $cylinder['filledCylinders'] - $mappedCylinders[0]['filledCylindersBefore']) > 0.000001) {
                throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend filled cylinder count no longer matches the Supplier Return contract at index $index.");
            }
            if ($mappedCylinders[0]['qtyInStockBefore'] !== null && abs((float) $cylinder['qtyInStock'] - $mappedCylinders[0]['qtyInStockBefore']) > 0.000001) {
                throw new FinalizedSupplierReturnReplayV1Exception("Mapped backend cylinder stock no longer matches the Supplier Return contract at index $index.");
            }
        }
    }

    if (abs((float) $contract['paidAmount']) > 0.000001 && !replayTableExists($pdo, 'supplier_payments')) {
        throw new FinalizedSupplierReturnReplayV1Exception('Supplier payment ledger table is unavailable.');
    }
}

function validateFinalizedSupplierReturnV1InvoiceOwnership(PDO $pdo, string $clientTransactionId, string $invoiceNo): void
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
        throw new FinalizedSupplierReturnReplayV1Exception('Invoice number already belongs to a different backend Supplier Return.');
    }
}

function alignFinalizedSupplierReturnV1PaymentSnapshot(PDO $pdo, int $syncTransactionId, float $invoicePayable, array $paymentResult): void
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
        $check = $pdo->prepare(
            'SELECT COUNT(*) AS `row_count`
             FROM `supplier_payments`
             WHERE `sync_transaction_id` = :sync_transaction_id
               AND `payableSnapshot` = :payableSnapshot'
        );
        $check->execute([
            'payableSnapshot' => $invoicePayable,
            'sync_transaction_id' => $syncTransactionId,
        ]);

        if ((int) (($check->fetch()['row_count'] ?? 0)) !== 1) {
            throw new FinalizedSupplierReturnReplayV1Exception('Supplier Return payment snapshot alignment failed.');
        }
    }
}

function finalizedSupplierReturnV1ActiveRowExists(PDO $pdo, string $table, int $id): bool
{
    if (!in_array($table, ['suppliers', 'items'], true)) {
        throw new FinalizedSupplierReturnReplayV1Exception('Unsupported finalized Supplier Return mapping table.');
    }
    $statement = $pdo->prepare("SELECT `id` FROM `$table` WHERE `id` = :id AND `is_deleted` = 0 LIMIT 1 FOR UPDATE");
    $statement->execute(['id' => $id]);
    return (bool) $statement->fetch();
}

function finalizedSupplierReturnV1SourceBatchRow(PDO $pdo, array $item): ?array
{
    $statement = $pdo->prepare(
        'SELECT `id`, `itemId`, `qtyPurchased`, `qtySold`, `balance`
         FROM `item_batches`
         WHERE `id` = :id
           AND `itemId` = :itemId
           AND `isDeleted` = 0
         LIMIT 1
         FOR UPDATE'
    );
    $statement->execute([
        'id' => $item['sourceBatch']['serverBatchId'],
        'itemId' => $item['serverItemId'],
    ]);
    $row = $statement->fetch();
    return $row ?: null;
}

function finalizedSupplierReturnV1CylinderRowByItem(PDO $pdo, int $itemId): ?array
{
    $statement = $pdo->prepare(
        'SELECT `id`, `itemId`, `qtyInStock`, `filledCylinders`
         FROM `cylinders`
         WHERE `itemId` = :itemId AND `isDeleted` = 0
         LIMIT 1
         FOR UPDATE'
    );
    $statement->execute(['itemId' => $itemId]);
    $row = $statement->fetch();
    return $row ?: null;
}

function finalizedSupplierReturnV1RequiredId($value, string $field): int
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new FinalizedSupplierReturnReplayV1Exception("Required backend mapping $field is missing.");
    }
    $id = (int) $value;
    if ($id <= 0 || (string) $id !== trim((string) $value)) {
        throw new FinalizedSupplierReturnReplayV1Exception("Required backend mapping $field is invalid.");
    }
    return $id;
}

function finalizedSupplierReturnV1RequiredString($value, string $field): string
{
    $string = trim((string) ($value ?? ''));
    if ($string === '') {
        throw new FinalizedSupplierReturnReplayV1Exception("Required finalized Supplier Return field $field is missing.");
    }
    return $string;
}

function finalizedSupplierReturnV1NullableNumber($value, string $field): ?float
{
    if ($value === null || $value === '') {
        return null;
    }
    if (!is_numeric($value)) {
        throw new FinalizedSupplierReturnReplayV1Exception("Optional finalized Supplier Return field $field must be numeric.");
    }
    $number = (float) $value;
    if (!is_finite($number) || $number < 0) {
        throw new FinalizedSupplierReturnReplayV1Exception("Optional finalized Supplier Return field $field is invalid.");
    }
    return $number;
}

function finalizedSupplierReturnV1Number($value, string $field, bool $allowZero, bool $allowNegative): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new FinalizedSupplierReturnReplayV1Exception("Required finalized Supplier Return field $field must be numeric.");
    }
    $number = (float) $value;
    if (!is_finite($number)) {
        throw new FinalizedSupplierReturnReplayV1Exception("Required finalized Supplier Return field $field is invalid.");
    }
    if (!$allowNegative && ($allowZero ? $number < 0 : $number <= 0)) {
        throw new FinalizedSupplierReturnReplayV1Exception("Required finalized Supplier Return field $field is invalid.");
    }
    if ($allowNegative && !$allowZero && abs($number) <= 0.000001) {
        throw new FinalizedSupplierReturnReplayV1Exception("Required finalized Supplier Return field $field is invalid.");
    }
    return $number;
}

function finalizedSupplierReturnV1FiniteNumber($value, string $field): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new FinalizedSupplierReturnReplayV1Exception("Required finalized Supplier Return field $field must be numeric.");
    }
    $number = (float) $value;
    if (!is_finite($number)) {
        throw new FinalizedSupplierReturnReplayV1Exception("Required finalized Supplier Return field $field is invalid.");
    }
    return $number;
}
