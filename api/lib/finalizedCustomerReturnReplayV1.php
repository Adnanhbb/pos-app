<?php

declare(strict_types=1);

require_once __DIR__ . '/transactionReplayProcessor.php';

/*
 * Narrow finalized-Customer-Return replay bridge.
 *
 * This adapter accepts only the hardened finalizedCustomerReturnReplay v1
 * contract, validates its backend mappings, and builds an in-memory
 * server-id-only envelope for the existing transactional replay primitives.
 * Local IndexedDB ids remain diagnostic metadata and are never used as MySQL
 * mutation ids.
 */

class FinalizedCustomerReturnReplayV1Exception extends RuntimeException
{
}

function replayStoredFinalizedCustomerReturnV1Authorized(PDO $pdo, int|string $syncTransactionId, array $authContext): array
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
        $result = replayStoredFinalizedCustomerReturnV1($pdo, $syncTransactionId, $workerId);
        $result['authorized'] = true;
        return $result;
    } finally {
        setTransactionReplayAuditActor(null);
    }
}

function replayStoredFinalizedCustomerReturnV1(PDO $pdo, int|string $syncTransactionId, string $workerId): array
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
        $normalizedPayload = normalizeStoredFinalizedCustomerReturnV1Payload($existingRow);
    } catch (FinalizedCustomerReturnReplayV1Exception $exception) {
        return [
            'success' => false,
            'reason' => 'invalid_finalized_customer_return_contract',
            'syncTransactionId' => $id,
            'clientTransactionId' => (string) ($existingRow['client_transaction_id'] ?? ''),
            'error' => $exception->getMessage(),
        ];
    }

    $terminalResult = skipReplayTerminalStateIfNeeded($pdo, $id, $existingRow);
    if ($terminalResult !== null) {
        $terminalResult['customerReturnReplayContract'] = 'finalizedCustomerReturnReplay';
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
            throw new FinalizedCustomerReturnReplayV1Exception('Stored transaction row was not found during finalized Customer Return replay.');
        }

        $clientTransactionId = (string) ($row['client_transaction_id'] ?? '');
        $normalizedPayload = normalizeStoredFinalizedCustomerReturnV1Payload($row);

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'finalized_customer_return_v1_validation_started',
            'processing',
            'processing',
            'Finalized Customer Return v1 replay validation started before any business mutation.'
        );

        validateFinalizedCustomerReturnV1DatabaseMappings($pdo, $normalizedPayload);
        validateReplayBusinessReferences($pdo, $normalizedPayload['serverPayload']);
        validateReplayInventorySufficiency($pdo, $normalizedPayload['serverPayload']);
        validateFinalizedCustomerReturnV1InvoiceOwnership($pdo, $clientTransactionId, $normalizedPayload['contract']['invoiceNo']);
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
        alignFinalizedCustomerReturnV1PaymentSnapshot(
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
            'finalized_customer_return_v1_replay_completed',
            'processing',
            'processing',
            'Finalized Customer Return v1 replay business mutations completed atomically.'
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
            'customerReturnReplayContract' => 'finalizedCustomerReturnReplay',
            'payloadVersion' => 1,
            'replayStatus' => 'committed',
            'alreadyCommitted' => false,
            'businessMutationsApplied' => true,
            'stockMutationsApplied' => (int) ($stockMutationResult['appliedCount'] ?? 0) > 0,
            'customerReturnPersisted' => isset($salesPersistenceResult['saleId']),
            'accountingMutationsApplied' => (int) ($accountingMutationResult['appliedCount'] ?? 0) > 0,
            'paymentsPersisted' => (int) ($paymentPersistenceResult['insertedCount'] ?? 0) > 0,
            'batchMutationsApplied' => (int) ($batchMutationResult['appliedCount'] ?? 0) > 0,
            'cylinderMutationsApplied' => (int) ($cylinderMutationResult['appliedCount'] ?? 0) > 0,
            'customerReturnId' => (int) $salesPersistenceResult['saleId'],
            'invoiceNo' => (string) $salesPersistenceResult['invoiceNo'],
            'saleItemsInserted' => (int) ($salesPersistenceResult['saleItemsInserted'] ?? 0),
            'returnBatchesCreated' => count($batchMutationResult['created'] ?? []),
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
                'finalized_customer_return_v1_replay_failed',
                'processing',
                'failed',
                'Finalized Customer Return v1 replay failed. Any business mutations were rolled back.'
            );
        } catch (Throwable $auditException) {
            unset($auditException);
        }

        $release = releaseReplayLock($pdo, $id, $worker, 'failed', $exception->getMessage());

        return [
            'success' => false,
            'reason' => $exception instanceof FinalizedCustomerReturnReplayV1Exception
                ? 'invalid_finalized_customer_return_contract'
                : 'finalized_customer_return_replay_failed',
            'syncTransactionId' => $id,
            'clientTransactionId' => $clientTransactionId,
            'error' => $exception->getMessage(),
            'release' => $release,
        ];
    }
}

function normalizeStoredFinalizedCustomerReturnV1Payload(array $row): array
{
    $storedPayload = validateReplaySkeletonPayload($row);
    if (($storedPayload['transactionType'] ?? null) !== 'return') {
        throw new FinalizedCustomerReturnReplayV1Exception('Only outer transactionType return is supported for queued Customer Returns.');
    }

    $transactionPayload = $storedPayload['payload'];
    if (($transactionPayload['returnMode'] ?? null) !== 'customer') {
        throw new FinalizedCustomerReturnReplayV1Exception('Only customer returnMode is supported.');
    }

    $topReadiness = $storedPayload['replayReadiness'] ?? null;
    validateFinalizedCustomerReturnV1Readiness($topReadiness, 'Stored transaction');

    $contract = $transactionPayload['finalizedCustomerReturnReplay'] ?? null;
    if (!is_array($contract) || array_is_list($contract)) {
        throw new FinalizedCustomerReturnReplayV1Exception('Stored transaction is missing finalizedCustomerReturnReplay v1 contract.');
    }

    if (($contract['payloadVersion'] ?? null) !== 1) {
        throw new FinalizedCustomerReturnReplayV1Exception('Only finalizedCustomerReturnReplay payloadVersion 1 is supported.');
    }
    if (($contract['transactionType'] ?? null) !== 'Return') {
        throw new FinalizedCustomerReturnReplayV1Exception('Only finalized Return transactions are supported.');
    }
    if (($contract['returnMode'] ?? null) !== 'customer') {
        throw new FinalizedCustomerReturnReplayV1Exception('Only finalized Customer Return contracts are supported.');
    }
    if (($contract['clientTransactionId'] ?? null) !== ($storedPayload['clientTransactionId'] ?? null)) {
        throw new FinalizedCustomerReturnReplayV1Exception('Finalized Customer Return clientTransactionId does not match stored transaction.');
    }

    validateFinalizedCustomerReturnV1Readiness($contract['replayReadiness'] ?? null, 'Finalized Customer Return contract');

    $legacySale = $transactionPayload['sale'] ?? null;
    if (!is_array($legacySale) || array_is_list($legacySale)) {
        throw new FinalizedCustomerReturnReplayV1Exception('Stored finalized Customer Return is missing its sale header.');
    }
    if (($legacySale['transactionType'] ?? null) !== 'Return' || !empty($legacySale['isPostponed'])) {
        throw new FinalizedCustomerReturnReplayV1Exception('Only completed, non-postponed Customer Return headers may replay.');
    }

    $localSaleId = finalizedCustomerReturnV1RequiredId($contract['localSaleId'] ?? null, 'localSaleId');
    $invoiceNo = finalizedCustomerReturnV1RequiredString($contract['invoiceNo'] ?? null, 'invoiceNo');
    if ($invoiceNo !== trim((string) ($legacySale['invoiceNo'] ?? ''))) {
        throw new FinalizedCustomerReturnReplayV1Exception('Finalized Customer Return invoiceNo does not match stored sale header.');
    }

    $customer = normalizeFinalizedCustomerReturnV1Customer($contract['customer'] ?? null);
    $items = normalizeFinalizedCustomerReturnV1Items($contract['items'] ?? null, $localSaleId, $invoiceNo);
    $cylinders = normalizeFinalizedCustomerReturnV1Cylinders($contract['cylinders'] ?? null);
    $totals = normalizeFinalizedCustomerReturnV1Totals($contract['totals'] ?? null);
    $paidAmount = finalizedCustomerReturnV1Number($contract['payments']['paidAmount'] ?? null, 'payments.paidAmount', true, true);

    if (abs($paidAmount - $totals['paid']) > 0.000001) {
        throw new FinalizedCustomerReturnReplayV1Exception('Finalized Customer Return paid amount does not match totals.');
    }

    validateFinalizedCustomerReturnV1ItemCylinderContract($items, $cylinders);

    $serverItems = [];
    foreach ($items as $item) {
        $serverItems[] = [
            'originalItemId' => $item['serverItemId'],
            'itemId' => $item['serverItemId'],
            'name' => $item['nameSnapshot'],
            'qty' => $item['qty'],
            'price' => $item['price'],
            'costPrice' => $item['costPrice'],
            'purchaseDate' => $item['returnBatchCreate']['purchaseDate'],
            'batchLocalId' => $item['returnBatchCreate']['localBatchId'],
            'localBatchSourceSaleId' => $item['returnBatchCreate']['sourceSaleId'],
            'convQty' => $item['convQty'],
        ];
    }

    $serverPayload = [
        'clientTransactionId' => (string) $storedPayload['clientTransactionId'],
        'transactionType' => 'return',
        'createdAt' => $storedPayload['createdAt'],
        'payload' => [
            'returnMode' => 'customer',
            'sale' => [
                'invoiceNo' => $invoiceNo,
                'date' => trim((string) ($legacySale['date'] ?? '')),
                'transactionType' => 'Return',
                'customerId' => $customer['serverId'],
                'supplierId' => null,
                'customerName' => $customer['nameSnapshot'],
                'supplierName' => '',
                'subtotal' => $totals['subtotal'],
                'discount' => $totals['discount'],
                'tax' => $totals['tax'],
                'dues' => $totals['dues'],
                'grandTotal' => $totals['grandTotal'],
                'paid' => $totals['paid'],
                'arrears' => $totals['arrears'],
                'profit' => finalizedCustomerReturnV1FiniteNumber($legacySale['profit'] ?? 0, 'sale.profit'),
                'isPostponed' => false,
            ],
            'customerId' => $customer['serverId'],
            'customerName' => $customer['nameSnapshot'],
            'saleItems' => $serverItems,
        ],
    ];

    return [
        'contract' => [
            'localSaleId' => $localSaleId,
            'invoiceNo' => $invoiceNo,
            'customer' => $customer,
            'items' => $items,
            'cylinders' => $cylinders,
            'totals' => $totals,
            'paidAmount' => $paidAmount,
        ],
        'serverPayload' => $serverPayload,
    ];
}

function validateFinalizedCustomerReturnV1Readiness($readiness, string $label): void
{
    if (!is_array($readiness) || array_is_list($readiness)) {
        throw new FinalizedCustomerReturnReplayV1Exception("$label replayReadiness is missing.");
    }
    if (($readiness['scope'] ?? null) !== 'finalized_customer_return' || ($readiness['payloadVersion'] ?? null) !== 1) {
        throw new FinalizedCustomerReturnReplayV1Exception("$label replayReadiness contract is unsupported.");
    }
    if (($readiness['status'] ?? null) !== 'ready') {
        throw new FinalizedCustomerReturnReplayV1Exception("$label is not replay-ready.");
    }
    if (!isset($readiness['reasons']) || !is_array($readiness['reasons']) || $readiness['reasons'] !== []) {
        throw new FinalizedCustomerReturnReplayV1Exception("$label replayReadiness reasons must be empty.");
    }
}

function normalizeFinalizedCustomerReturnV1Customer($customer): array
{
    if (!is_array($customer) || array_is_list($customer)) {
        throw new FinalizedCustomerReturnReplayV1Exception('Finalized Customer Return customer mapping must be an object.');
    }

    return [
        'serverId' => finalizedCustomerReturnV1RequiredId($customer['serverId'] ?? null, 'customer.serverId'),
        'nameSnapshot' => finalizedCustomerReturnV1RequiredString($customer['nameSnapshot'] ?? null, 'customer.nameSnapshot'),
    ];
}

function normalizeFinalizedCustomerReturnV1Items($items, int $localSaleId, string $invoiceNo): array
{
    if (!is_array($items) || !array_is_list($items) || $items === []) {
        throw new FinalizedCustomerReturnReplayV1Exception('Finalized Customer Return must include mapped item rows.');
    }

    $normalized = [];
    foreach ($items as $index => $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return item at index $index must be an object.");
        }

        $qty = finalizedCustomerReturnV1Number($item['qty'] ?? null, "items.$index.qty", false, false);
        $price = finalizedCustomerReturnV1Number($item['price'] ?? null, "items.$index.price", true, false);
        $costPrice = finalizedCustomerReturnV1Number($item['costPrice'] ?? null, "items.$index.costPrice", true, false);
        $conversion = is_array($item['conversion'] ?? null) ? $item['conversion'] : [];
        $convQty = finalizedCustomerReturnV1Number($conversion['convQty'] ?? 1, "items.$index.conversion.convQty", false, false);
        $returnBatch = $item['returnBatchCreate'] ?? null;

        if (!is_array($returnBatch) || array_is_list($returnBatch)) {
            throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return item returnBatchCreate at index $index must be an object.");
        }

        $batch = [
            'localBatchId' => finalizedCustomerReturnV1RequiredId($returnBatch['localBatchId'] ?? null, "items.$index.returnBatchCreate.localBatchId"),
            'sourceSaleId' => finalizedCustomerReturnV1RequiredId($returnBatch['sourceSaleId'] ?? null, "items.$index.returnBatchCreate.sourceSaleId"),
            'purchaseDate' => finalizedCustomerReturnV1RequiredString($returnBatch['purchaseDate'] ?? null, "items.$index.returnBatchCreate.purchaseDate"),
            'qtyReturned' => finalizedCustomerReturnV1Number($returnBatch['qtyReturned'] ?? null, "items.$index.returnBatchCreate.qtyReturned", false, false),
            'balance' => finalizedCustomerReturnV1Number($returnBatch['balance'] ?? null, "items.$index.returnBatchCreate.balance", false, false),
            'costPrice' => finalizedCustomerReturnV1Number($returnBatch['costPrice'] ?? null, "items.$index.returnBatchCreate.costPrice", true, false),
            'invoiceNo' => finalizedCustomerReturnV1RequiredString($returnBatch['invoiceNo'] ?? null, "items.$index.returnBatchCreate.invoiceNo"),
        ];

        if ($batch['sourceSaleId'] !== $localSaleId) {
            throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return batch sourceSaleId mismatch at index $index.");
        }
        if ($batch['invoiceNo'] !== $invoiceNo) {
            throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return batch invoiceNo mismatch at index $index.");
        }
        if (abs($batch['qtyReturned'] - $qty) > 0.000001 || abs($batch['balance'] - $qty) > 0.000001) {
            throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return batch quantity mismatch at index $index.");
        }
        if (abs($batch['costPrice'] - $costPrice) > 0.000001) {
            throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return batch costPrice mismatch at index $index.");
        }

        $normalized[] = [
            'serverItemId' => finalizedCustomerReturnV1RequiredId($item['serverItemId'] ?? null, "items.$index.serverItemId"),
            'nameSnapshot' => finalizedCustomerReturnV1RequiredString($item['nameSnapshot'] ?? null, "items.$index.nameSnapshot"),
            'qty' => $qty,
            'price' => $price,
            'costPrice' => $costPrice,
            'requiresCylinderMutation' => ($item['requiresCylinderMutation'] ?? false) === true,
            'convQty' => $convQty,
            'returnBatchCreate' => $batch,
        ];
    }

    return $normalized;
}

function normalizeFinalizedCustomerReturnV1Cylinders($cylinders): array
{
    if (!is_array($cylinders) || !array_is_list($cylinders)) {
        throw new FinalizedCustomerReturnReplayV1Exception('Finalized Customer Return cylinders must be an array.');
    }

    $normalized = [];
    foreach ($cylinders as $index => $cylinder) {
        if (!is_array($cylinder) || array_is_list($cylinder)) {
            throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return cylinder at index $index must be an object.");
        }

        if (($cylinder['movement'] ?? null) !== 'customerHoldingToEmpty') {
            throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return cylinder movement is unsupported at index $index.");
        }

        $holding = $cylinder['customerHolding'] ?? null;
        if (!is_array($holding) || array_is_list($holding)) {
            throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return cylinder holding at index $index must be an object.");
        }

        $normalized[] = [
            'serverItemId' => finalizedCustomerReturnV1RequiredId($cylinder['serverItemId'] ?? null, "cylinders.$index.serverItemId"),
            'serverCylinderId' => finalizedCustomerReturnV1RequiredId($cylinder['serverCylinderId'] ?? null, "cylinders.$index.serverCylinderId"),
            'serverHoldingId' => finalizedCustomerReturnV1RequiredId($holding['serverHoldingId'] ?? null, "cylinders.$index.customerHolding.serverHoldingId"),
            'customerNameSnapshot' => finalizedCustomerReturnV1RequiredString($holding['customerNameSnapshot'] ?? null, "cylinders.$index.customerHolding.customerNameSnapshot"),
            'qtyReturned' => finalizedCustomerReturnV1Number($cylinder['qtyReturned'] ?? null, "cylinders.$index.qtyReturned", false, false),
        ];
    }

    return $normalized;
}

function validateFinalizedCustomerReturnV1ItemCylinderContract(array $items, array $cylinders): void
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
                throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return item is missing cylinder mapping at index $index.");
            }
            $expectedQty = (int) floor($item['qty'] / $item['convQty']);
            if ($expectedQty <= 0 || abs($matches[0]['qtyReturned'] - $expectedQty) > 0.000001) {
                throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return cylinder quantity is inconsistent at index $index.");
            }
        }
    }

    foreach ($cylinders as $index => $cylinder) {
        if (!isset($itemByServerId[$cylinder['serverItemId']])) {
            throw new FinalizedCustomerReturnReplayV1Exception("Finalized Customer Return cylinder at index $index does not match a Customer Return item.");
        }
    }
}

function normalizeFinalizedCustomerReturnV1Totals($totals): array
{
    if (!is_array($totals) || array_is_list($totals)) {
        throw new FinalizedCustomerReturnReplayV1Exception('Finalized Customer Return totals must be an object.');
    }

    $normalized = [];
    foreach (['subtotal', 'discount', 'tax', 'dues', 'grandTotal', 'arrears'] as $field) {
        $normalized[$field] = finalizedCustomerReturnV1Number($totals[$field] ?? null, "totals.$field", true, false);
    }
    $normalized['paid'] = finalizedCustomerReturnV1Number($totals['paid'] ?? null, 'totals.paid', true, true);

    $returnAmount = $normalized['subtotal'] - $normalized['discount'] + $normalized['tax'];
    if ($returnAmount < -0.000001) {
        throw new FinalizedCustomerReturnReplayV1Exception('Finalized Customer Return amount cannot be negative.');
    }
    if (abs(($normalized['dues'] - $returnAmount) - $normalized['grandTotal']) > 0.000001) {
        throw new FinalizedCustomerReturnReplayV1Exception('Finalized Customer Return total arithmetic is inconsistent.');
    }
    if (abs(($normalized['grandTotal'] - $normalized['paid']) - $normalized['arrears']) > 0.000001) {
        throw new FinalizedCustomerReturnReplayV1Exception('Finalized Customer Return arrears arithmetic is inconsistent.');
    }

    return $normalized;
}

function validateFinalizedCustomerReturnV1DatabaseMappings(PDO $pdo, array $normalized): void
{
    $contract = $normalized['contract'];

    if (!finalizedCustomerReturnV1ActiveRowExists($pdo, 'customers', $contract['customer']['serverId'])) {
        throw new FinalizedCustomerReturnReplayV1Exception('Mapped backend customer does not exist.');
    }

    if (!replayTableExists($pdo, 'item_batches')) {
        throw new FinalizedCustomerReturnReplayV1Exception('Batch table item_batches is unavailable.');
    }

    foreach ($contract['items'] as $index => $item) {
        if (!finalizedCustomerReturnV1ActiveRowExists($pdo, 'items', $item['serverItemId'])) {
            throw new FinalizedCustomerReturnReplayV1Exception("Mapped backend item does not exist at index $index.");
        }

        $cylinder = finalizedCustomerReturnV1CylinderRowByItem($pdo, $item['serverItemId']);
        $mappedCylinders = array_values(array_filter(
            $contract['cylinders'],
            static fn(array $mapped): bool => $mapped['serverItemId'] === $item['serverItemId']
        ));
        if ($item['requiresCylinderMutation'] || $cylinder !== null) {
            if ($cylinder === null || count($mappedCylinders) !== 1 || $mappedCylinders[0]['serverCylinderId'] !== (int) $cylinder['id']) {
                throw new FinalizedCustomerReturnReplayV1Exception("Mapped backend cylinder is missing or inconsistent at index $index.");
            }
            $expectedQty = (int) floor($item['qty'] / $item['convQty']);
            if ($expectedQty <= 0 || abs($mappedCylinders[0]['qtyReturned'] - $expectedQty) > 0.000001) {
                throw new FinalizedCustomerReturnReplayV1Exception("Mapped backend cylinder quantity is inconsistent at index $index.");
            }

            $holding = finalizedCustomerReturnV1CylinderHoldingRow($pdo, $mappedCylinders[0]);
            if ($holding === null) {
                throw new FinalizedCustomerReturnReplayV1Exception("Mapped backend customer cylinder holding is missing at index $index.");
            }
            if ((float) ($holding['qtyHeld'] ?? 0) + 0.000001 < $expectedQty) {
                throw new FinalizedCustomerReturnReplayV1Exception("Mapped backend customer cylinder holding is insufficient at index $index.");
            }
        }
    }

    if (abs((float) $contract['paidAmount']) > 0.000001 && !replayTableExists($pdo, 'customer_payments')) {
        throw new FinalizedCustomerReturnReplayV1Exception('Customer payment ledger table is unavailable.');
    }
}

function validateFinalizedCustomerReturnV1InvoiceOwnership(PDO $pdo, string $clientTransactionId, string $invoiceNo): void
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
        throw new FinalizedCustomerReturnReplayV1Exception('Invoice number already belongs to a different backend Customer Return.');
    }
}

function alignFinalizedCustomerReturnV1PaymentSnapshot(PDO $pdo, int $syncTransactionId, float $invoicePayable, array $paymentResult): void
{
    if ((int) ($paymentResult['insertedCount'] ?? 0) === 0) {
        return;
    }

    $statement = $pdo->prepare(
        'UPDATE `customer_payments`
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
             FROM `customer_payments`
             WHERE `sync_transaction_id` = :sync_transaction_id
               AND `payableSnapshot` = :payableSnapshot'
        );
        $check->execute([
            'payableSnapshot' => $invoicePayable,
            'sync_transaction_id' => $syncTransactionId,
        ]);

        if ((int) (($check->fetch()['row_count'] ?? 0)) !== 1) {
            throw new FinalizedCustomerReturnReplayV1Exception('Customer Return payment snapshot alignment failed.');
        }
    }
}

function finalizedCustomerReturnV1ActiveRowExists(PDO $pdo, string $table, int $id): bool
{
    if (!in_array($table, ['customers', 'items'], true)) {
        throw new FinalizedCustomerReturnReplayV1Exception('Unsupported finalized Customer Return mapping table.');
    }
    $statement = $pdo->prepare("SELECT `id` FROM `$table` WHERE `id` = :id AND `is_deleted` = 0 LIMIT 1 FOR UPDATE");
    $statement->execute(['id' => $id]);
    return (bool) $statement->fetch();
}

function finalizedCustomerReturnV1CylinderRowByItem(PDO $pdo, int $itemId): ?array
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

function finalizedCustomerReturnV1CylinderHoldingRow(PDO $pdo, array $cylinder): ?array
{
    $statement = $pdo->prepare(
        'SELECT `id`, `cylinderId`, `customerName`, `qtyHeld`
         FROM `cylinder_customers`
         WHERE `id` = :id
           AND `cylinderId` = :cylinderId
           AND `customerName` = :customerName
           AND `isDeleted` = 0
         LIMIT 1
         FOR UPDATE'
    );
    $statement->execute([
        'id' => $cylinder['serverHoldingId'],
        'cylinderId' => $cylinder['serverCylinderId'],
        'customerName' => $cylinder['customerNameSnapshot'],
    ]);
    $row = $statement->fetch();
    return $row ?: null;
}

function finalizedCustomerReturnV1RequiredId($value, string $field): int
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new FinalizedCustomerReturnReplayV1Exception("Required backend mapping $field is missing.");
    }
    $id = (int) $value;
    if ($id <= 0 || (string) $id !== trim((string) $value)) {
        throw new FinalizedCustomerReturnReplayV1Exception("Required backend mapping $field is invalid.");
    }
    return $id;
}

function finalizedCustomerReturnV1RequiredString($value, string $field): string
{
    $string = trim((string) ($value ?? ''));
    if ($string === '') {
        throw new FinalizedCustomerReturnReplayV1Exception("Required finalized Customer Return field $field is missing.");
    }
    return $string;
}

function finalizedCustomerReturnV1Number($value, string $field, bool $allowZero, bool $allowNegative): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new FinalizedCustomerReturnReplayV1Exception("Required finalized Customer Return field $field must be numeric.");
    }
    $number = (float) $value;
    if (!is_finite($number)) {
        throw new FinalizedCustomerReturnReplayV1Exception("Required finalized Customer Return field $field is invalid.");
    }
    if (!$allowNegative && ($allowZero ? $number < 0 : $number <= 0)) {
        throw new FinalizedCustomerReturnReplayV1Exception("Required finalized Customer Return field $field is invalid.");
    }
    if ($allowNegative && !$allowZero && abs($number) <= 0.000001) {
        throw new FinalizedCustomerReturnReplayV1Exception("Required finalized Customer Return field $field is invalid.");
    }
    return $number;
}

function finalizedCustomerReturnV1FiniteNumber($value, string $field): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new FinalizedCustomerReturnReplayV1Exception("Required finalized Customer Return field $field must be numeric.");
    }
    $number = (float) $value;
    if (!is_finite($number)) {
        throw new FinalizedCustomerReturnReplayV1Exception("Required finalized Customer Return field $field is invalid.");
    }
    return $number;
}
