<?php

declare(strict_types=1);

require_once __DIR__ . '/transactionReplayProcessor.php';

/*
 * Narrow finalized-Sale replay bridge.
 *
 * This adapter accepts only the hardened finalizedSaleReplay v1 contract,
 * validates its backend mappings, and builds an in-memory server-id-only
 * envelope for the existing transactional replay primitives. Local IndexedDB
 * ids remain diagnostic metadata and are never used as MySQL mutation ids.
 */

class FinalizedSaleReplayV1Exception extends RuntimeException
{
}

function replayStoredFinalizedSaleV1Authorized(PDO $pdo, int|string $syncTransactionId, array $authContext): array
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
        $result = replayStoredFinalizedSaleV1($pdo, $syncTransactionId, $workerId);
        $result['authorized'] = true;
        return $result;
    } finally {
        setTransactionReplayAuditActor(null);
    }
}

function replayStoredFinalizedSaleV1(PDO $pdo, int|string $syncTransactionId, string $workerId): array
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
        $normalizedPayload = normalizeStoredFinalizedSaleV1Payload($existingRow);
    } catch (FinalizedSaleReplayV1Exception $exception) {
        return [
            'success' => false,
            'reason' => 'invalid_finalized_sale_contract',
            'syncTransactionId' => $id,
            'clientTransactionId' => (string) ($existingRow['client_transaction_id'] ?? ''),
            'error' => $exception->getMessage(),
        ];
    }

    $terminalResult = skipReplayTerminalStateIfNeeded($pdo, $id, $existingRow);
    if ($terminalResult !== null) {
        $terminalResult['saleReplayContract'] = 'finalizedSaleReplay';
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
            throw new FinalizedSaleReplayV1Exception('Stored transaction row was not found during finalized Sale replay.');
        }

        $clientTransactionId = (string) ($row['client_transaction_id'] ?? '');
        $normalizedPayload = normalizeStoredFinalizedSaleV1Payload($row);

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'finalized_sale_v1_validation_started',
            'processing',
            'processing',
            'Finalized Sale v1 replay validation started before any business mutation.'
        );

        validateFinalizedSaleV1DatabaseMappings($pdo, $normalizedPayload);
        validateReplayBusinessReferences($pdo, $normalizedPayload['serverPayload']);
        validateReplayInventorySufficiency($pdo, $normalizedPayload['serverPayload']);
        validateFinalizedSaleV1InvoiceOwnership($pdo, $clientTransactionId, $normalizedPayload['contract']['invoiceNo']);
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
        alignFinalizedSaleV1PaymentSnapshot(
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
            'finalized_sale_v1_replay_completed',
            'processing',
            'processing',
            'Finalized Sale v1 replay business mutations completed atomically.'
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
            'saleReplayContract' => 'finalizedSaleReplay',
            'payloadVersion' => 1,
            'replayStatus' => 'committed',
            'alreadyCommitted' => false,
            'businessMutationsApplied' => true,
            'stockMutationsApplied' => (int) ($stockMutationResult['appliedCount'] ?? 0) > 0,
            'salesPersisted' => isset($salesPersistenceResult['saleId']),
            'accountingMutationsApplied' => (int) ($accountingMutationResult['appliedCount'] ?? 0) > 0,
            'paymentsPersisted' => (int) ($paymentPersistenceResult['insertedCount'] ?? 0) > 0,
            'batchMutationsApplied' => (int) ($batchMutationResult['appliedCount'] ?? 0) > 0,
            'cylinderMutationsApplied' => (int) ($cylinderMutationResult['appliedCount'] ?? 0) > 0,
            'saleId' => (int) $salesPersistenceResult['saleId'],
            'invoiceNo' => (string) $salesPersistenceResult['invoiceNo'],
            'saleItemsInserted' => (int) ($salesPersistenceResult['saleItemsInserted'] ?? 0),
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
                'finalized_sale_v1_replay_failed',
                'processing',
                'failed',
                'Finalized Sale v1 replay failed. Any business mutations were rolled back.'
            );
        } catch (Throwable $auditException) {
            unset($auditException);
        }

        $release = releaseReplayLock($pdo, $id, $worker, 'failed', $exception->getMessage());

        return [
            'success' => false,
            'reason' => $exception instanceof FinalizedSaleReplayV1Exception
                ? 'invalid_finalized_sale_contract'
                : 'finalized_sale_replay_failed',
            'syncTransactionId' => $id,
            'clientTransactionId' => $clientTransactionId,
            'error' => $exception->getMessage(),
            'release' => $release,
        ];
    }
}

function normalizeStoredFinalizedSaleV1Payload(array $row): array
{
    $storedPayload = validateReplaySkeletonPayload($row);
    if (($storedPayload['transactionType'] ?? null) !== 'sale') {
        throw new FinalizedSaleReplayV1Exception('Only outer transactionType sale is supported.');
    }

    $topReadiness = $storedPayload['replayReadiness'] ?? null;
    validateFinalizedSaleV1Readiness($topReadiness, 'Stored transaction');

    $transactionPayload = $storedPayload['payload'];
    $contract = $transactionPayload['finalizedSaleReplay'] ?? null;
    if (!is_array($contract) || array_is_list($contract)) {
        throw new FinalizedSaleReplayV1Exception('Stored transaction is missing finalizedSaleReplay v1 contract.');
    }

    if (($contract['payloadVersion'] ?? null) !== 1) {
        throw new FinalizedSaleReplayV1Exception('Only finalizedSaleReplay payloadVersion 1 is supported.');
    }
    if (($contract['transactionType'] ?? null) !== 'Sale') {
        throw new FinalizedSaleReplayV1Exception('Only finalized Sale transactions are supported.');
    }
    if (($contract['clientTransactionId'] ?? null) !== ($storedPayload['clientTransactionId'] ?? null)) {
        throw new FinalizedSaleReplayV1Exception('Finalized Sale clientTransactionId does not match stored transaction.');
    }

    validateFinalizedSaleV1Readiness($contract['replayReadiness'] ?? null, 'Finalized Sale contract');

    $legacySale = $transactionPayload['sale'] ?? null;
    if (!is_array($legacySale) || array_is_list($legacySale)) {
        throw new FinalizedSaleReplayV1Exception('Stored finalized Sale is missing its sale header.');
    }
    if (($legacySale['transactionType'] ?? null) !== 'Sale' || !empty($legacySale['isPostponed'])) {
        throw new FinalizedSaleReplayV1Exception('Only completed, non-postponed Sale headers may replay.');
    }

    $invoiceNo = finalizedSaleV1RequiredString($contract['invoiceNo'] ?? null, 'invoiceNo');
    if ($invoiceNo !== trim((string) ($legacySale['invoiceNo'] ?? ''))) {
        throw new FinalizedSaleReplayV1Exception('Finalized Sale invoiceNo does not match stored sale header.');
    }

    $customer = normalizeFinalizedSaleV1Customer($contract['customer'] ?? null);
    $items = normalizeFinalizedSaleV1Items($contract['items'] ?? null);
    $cylinders = normalizeFinalizedSaleV1Cylinders($contract['cylinders'] ?? null);
    $totals = normalizeFinalizedSaleV1Totals($contract['totals'] ?? null);
    $paidAmount = finalizedSaleV1Number($contract['payments']['paidAmount'] ?? null, 'payments.paidAmount', true);

    if (abs($paidAmount - $totals['paid']) > 0.000001) {
        throw new FinalizedSaleReplayV1Exception('Finalized Sale paid amount does not match totals.');
    }

    $serverItems = [];
    foreach ($items as $item) {
        $serverItems[] = [
            'originalItemId' => $item['serverItemId'],
            'itemId' => $item['serverItemId'],
            'name' => $item['nameSnapshot'],
            'qty' => $item['qty'],
            'price' => $item['price'],
            'batchId' => $item['serverBatchId'],
            'convQty' => $item['convQty'],
        ];
    }

    $serverPayload = [
        'clientTransactionId' => (string) $storedPayload['clientTransactionId'],
        'transactionType' => 'sale',
        'createdAt' => $storedPayload['createdAt'],
        'payload' => [
            'sale' => [
                'invoiceNo' => $invoiceNo,
                'date' => trim((string) ($legacySale['date'] ?? '')),
                'transactionType' => 'Sale',
                'customerId' => $customer['serverId'] ?? null,
                'customerName' => $customer['nameSnapshot'] ?? trim((string) ($legacySale['customerName'] ?? '')),
                'subtotal' => $totals['subtotal'],
                'discount' => $totals['discount'],
                'tax' => $totals['tax'],
                'dues' => $totals['dues'],
                'grandTotal' => $totals['grandTotal'],
                'paid' => $totals['paid'],
                'arrears' => $totals['arrears'],
                'profit' => finalizedSaleV1FiniteNumber($legacySale['profit'] ?? 0, 'sale.profit'),
                'isPostponed' => false,
            ],
            'customerId' => $customer['serverId'] ?? null,
            'customerName' => $customer['nameSnapshot'] ?? trim((string) ($legacySale['customerName'] ?? '')),
            'saleItems' => $serverItems,
        ],
    ];

    return [
        'contract' => [
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

function validateFinalizedSaleV1Readiness($readiness, string $label): void
{
    if (!is_array($readiness) || array_is_list($readiness)) {
        throw new FinalizedSaleReplayV1Exception("$label replayReadiness is missing.");
    }
    if (($readiness['scope'] ?? null) !== 'finalized_sale' || ($readiness['payloadVersion'] ?? null) !== 1) {
        throw new FinalizedSaleReplayV1Exception("$label replayReadiness contract is unsupported.");
    }
    if (($readiness['status'] ?? null) !== 'ready') {
        throw new FinalizedSaleReplayV1Exception("$label is not replay-ready.");
    }
    if (!isset($readiness['reasons']) || !is_array($readiness['reasons']) || $readiness['reasons'] !== []) {
        throw new FinalizedSaleReplayV1Exception("$label replayReadiness reasons must be empty.");
    }
}

function normalizeFinalizedSaleV1Customer($customer): ?array
{
    if ($customer === null) {
        return null;
    }
    if (!is_array($customer) || array_is_list($customer)) {
        throw new FinalizedSaleReplayV1Exception('Finalized Sale customer mapping must be an object or null.');
    }

    return [
        'serverId' => finalizedSaleV1RequiredId($customer['serverId'] ?? null, 'customer.serverId'),
        'nameSnapshot' => finalizedSaleV1RequiredString($customer['nameSnapshot'] ?? null, 'customer.nameSnapshot'),
    ];
}

function normalizeFinalizedSaleV1Items($items): array
{
    if (!is_array($items) || !array_is_list($items) || $items === []) {
        throw new FinalizedSaleReplayV1Exception('Finalized Sale must include mapped item rows.');
    }

    $normalized = [];
    foreach ($items as $index => $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new FinalizedSaleReplayV1Exception("Finalized Sale item at index $index must be an object.");
        }

        $resolvedBatch = $item['resolvedBatch'] ?? null;
        $serverBatchId = null;
        if ($resolvedBatch !== null) {
            if (!is_array($resolvedBatch) || array_is_list($resolvedBatch)) {
                throw new FinalizedSaleReplayV1Exception("Finalized Sale item batch at index $index must be an object.");
            }
            $serverBatchId = finalizedSaleV1RequiredId($resolvedBatch['serverBatchId'] ?? null, "items.$index.resolvedBatch.serverBatchId");
            $consumedQty = finalizedSaleV1Number($resolvedBatch['consumedQty'] ?? null, "items.$index.resolvedBatch.consumedQty", false);
            $qty = finalizedSaleV1Number($item['qty'] ?? null, "items.$index.qty", false);
            if (abs($consumedQty - $qty) > 0.000001) {
                throw new FinalizedSaleReplayV1Exception("Finalized Sale exact batch quantity mismatch at index $index.");
            }
        }

        $conversion = is_array($item['conversion'] ?? null) ? $item['conversion'] : [];
        $normalized[] = [
            'serverItemId' => finalizedSaleV1RequiredId($item['serverItemId'] ?? null, "items.$index.serverItemId"),
            'nameSnapshot' => finalizedSaleV1RequiredString($item['nameSnapshot'] ?? null, "items.$index.nameSnapshot"),
            'qty' => finalizedSaleV1Number($item['qty'] ?? null, "items.$index.qty", false),
            'price' => finalizedSaleV1Number($item['price'] ?? null, "items.$index.price", true),
            'serverBatchId' => $serverBatchId,
            'requiresCylinderMutation' => ($item['requiresCylinderMutation'] ?? false) === true,
            'convQty' => finalizedSaleV1Number($conversion['convQty'] ?? 1, "items.$index.conversion.convQty", false),
        ];
    }

    return $normalized;
}

function normalizeFinalizedSaleV1Cylinders($cylinders): array
{
    if (!is_array($cylinders) || !array_is_list($cylinders)) {
        throw new FinalizedSaleReplayV1Exception('Finalized Sale cylinders must be an array.');
    }

    $normalized = [];
    foreach ($cylinders as $index => $cylinder) {
        if (!is_array($cylinder) || array_is_list($cylinder)) {
            throw new FinalizedSaleReplayV1Exception("Finalized Sale cylinder at index $index must be an object.");
        }
        $holding = $cylinder['customerHolding'] ?? null;
        $normalized[] = [
            'serverItemId' => finalizedSaleV1RequiredId($cylinder['serverItemId'] ?? null, "cylinders.$index.serverItemId"),
            'serverCylinderId' => finalizedSaleV1RequiredId($cylinder['serverCylinderId'] ?? null, "cylinders.$index.serverCylinderId"),
            'qtyMoved' => finalizedSaleV1Number($cylinder['qtyMoved'] ?? null, "cylinders.$index.qtyMoved", false),
            'customerNameSnapshot' => is_array($holding)
                ? finalizedSaleV1RequiredString($holding['customerNameSnapshot'] ?? null, "cylinders.$index.customerHolding.customerNameSnapshot")
                : '',
        ];
    }

    return $normalized;
}

function normalizeFinalizedSaleV1Totals($totals): array
{
    if (!is_array($totals) || array_is_list($totals)) {
        throw new FinalizedSaleReplayV1Exception('Finalized Sale totals must be an object.');
    }

    $normalized = [];
    foreach (['subtotal', 'discount', 'tax', 'dues', 'grandTotal', 'paid', 'arrears'] as $field) {
        $normalized[$field] = finalizedSaleV1Number($totals[$field] ?? null, "totals.$field", true);
    }

    $invoiceAmount = $normalized['subtotal'] - $normalized['discount'] + $normalized['tax'];
    if (abs(($normalized['dues'] + $invoiceAmount) - $normalized['grandTotal']) > 0.000001) {
        throw new FinalizedSaleReplayV1Exception('Finalized Sale total arithmetic is inconsistent.');
    }
    if (abs(($normalized['grandTotal'] - $normalized['paid']) - $normalized['arrears']) > 0.000001) {
        throw new FinalizedSaleReplayV1Exception('Finalized Sale arrears arithmetic is inconsistent.');
    }

    return $normalized;
}

function validateFinalizedSaleV1DatabaseMappings(PDO $pdo, array $normalized): void
{
    $contract = $normalized['contract'];

    if ($contract['customer'] !== null && !finalizedSaleV1ActiveRowExists($pdo, 'customers', $contract['customer']['serverId'])) {
        throw new FinalizedSaleReplayV1Exception('Mapped backend customer does not exist.');
    }

    foreach ($contract['items'] as $index => $item) {
        if (!finalizedSaleV1ActiveRowExists($pdo, 'items', $item['serverItemId'])) {
            throw new FinalizedSaleReplayV1Exception("Mapped backend item does not exist at index $index.");
        }

        $batchRows = finalizedSaleV1ActiveBatchRows($pdo, $item['serverItemId']);
        if ($item['serverBatchId'] === null && $batchRows !== []) {
            throw new FinalizedSaleReplayV1Exception("Mapped backend item requires an exact batch id at index $index.");
        }
        if ($item['serverBatchId'] !== null) {
            $matchingBatch = array_values(array_filter(
                $batchRows,
                static fn(array $batch): bool => (int) $batch['id'] === $item['serverBatchId']
            ));
            if ($matchingBatch === [] || (float) $matchingBatch[0]['balance'] + 0.000001 < $item['qty']) {
                throw new FinalizedSaleReplayV1Exception("Mapped backend batch is missing or insufficient at index $index.");
            }
        }

        $cylinder = finalizedSaleV1CylinderRowByItem($pdo, $item['serverItemId']);
        $mappedCylinders = array_values(array_filter(
            $contract['cylinders'],
            static fn(array $mapped): bool => $mapped['serverItemId'] === $item['serverItemId']
        ));
        if ($item['requiresCylinderMutation'] || $cylinder !== null) {
            if ($cylinder === null || count($mappedCylinders) !== 1 || $mappedCylinders[0]['serverCylinderId'] !== (int) $cylinder['id']) {
                throw new FinalizedSaleReplayV1Exception("Mapped backend cylinder is missing or inconsistent at index $index.");
            }
            $expectedQty = (int) floor($item['qty'] / $item['convQty']);
            if ($expectedQty <= 0 || abs($mappedCylinders[0]['qtyMoved'] - $expectedQty) > 0.000001) {
                throw new FinalizedSaleReplayV1Exception("Mapped backend cylinder quantity is inconsistent at index $index.");
            }
        }
    }

    if ($contract['customer'] !== null && abs((float) $contract['paidAmount']) > 0.000001 && !replayTableExists($pdo, 'customer_payments')) {
        throw new FinalizedSaleReplayV1Exception('Customer payment ledger table is unavailable.');
    }
}

function validateFinalizedSaleV1InvoiceOwnership(PDO $pdo, string $clientTransactionId, string $invoiceNo): void
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
        throw new FinalizedSaleReplayV1Exception('Invoice number already belongs to a different backend Sale.');
    }
}

function alignFinalizedSaleV1PaymentSnapshot(PDO $pdo, int $syncTransactionId, float $invoicePayable, array $paymentResult): void
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
        throw new FinalizedSaleReplayV1Exception('Customer payment snapshot alignment failed.');
    }
}

function finalizedSaleV1ActiveRowExists(PDO $pdo, string $table, int $id): bool
{
    if (!in_array($table, ['customers', 'items'], true)) {
        throw new FinalizedSaleReplayV1Exception('Unsupported finalized Sale mapping table.');
    }
    $statement = $pdo->prepare("SELECT `id` FROM `$table` WHERE `id` = :id AND `is_deleted` = 0 LIMIT 1 FOR UPDATE");
    $statement->execute(['id' => $id]);
    return (bool) $statement->fetch();
}

function finalizedSaleV1ActiveBatchRows(PDO $pdo, int $itemId): array
{
    $statement = $pdo->prepare(
        'SELECT `id`, `balance`
         FROM `item_batches`
         WHERE `itemId` = :itemId AND `isDeleted` = 0 AND `balance` > 0
         ORDER BY `id` ASC
         FOR UPDATE'
    );
    $statement->execute(['itemId' => $itemId]);
    return $statement->fetchAll();
}

function finalizedSaleV1CylinderRowByItem(PDO $pdo, int $itemId): ?array
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

function finalizedSaleV1RequiredId($value, string $field): int
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new FinalizedSaleReplayV1Exception("Required backend mapping $field is missing.");
    }
    $id = (int) $value;
    if ($id <= 0 || (string) $id !== trim((string) $value)) {
        throw new FinalizedSaleReplayV1Exception("Required backend mapping $field is invalid.");
    }
    return $id;
}

function finalizedSaleV1RequiredString($value, string $field): string
{
    $string = trim((string) ($value ?? ''));
    if ($string === '') {
        throw new FinalizedSaleReplayV1Exception("Required finalized Sale field $field is missing.");
    }
    return $string;
}

function finalizedSaleV1Number($value, string $field, bool $allowZero): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new FinalizedSaleReplayV1Exception("Required finalized Sale field $field must be numeric.");
    }
    $number = (float) $value;
    if (!is_finite($number) || ($allowZero ? $number < 0 : $number <= 0)) {
        throw new FinalizedSaleReplayV1Exception("Required finalized Sale field $field is invalid.");
    }
    return $number;
}

function finalizedSaleV1FiniteNumber($value, string $field): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new FinalizedSaleReplayV1Exception("Required finalized Sale field $field must be numeric.");
    }
    $number = (float) $value;
    if (!is_finite($number)) {
        throw new FinalizedSaleReplayV1Exception("Required finalized Sale field $field is invalid.");
    }
    return $number;
}
