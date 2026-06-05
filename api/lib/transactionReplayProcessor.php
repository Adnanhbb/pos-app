<?php

declare(strict_types=1);

require_once __DIR__ . '/transactionReplayLock.php';
require_once __DIR__ . '/auth.php';

/*
 * Transaction replay processor.
 *
 * This validates stored transaction metadata, payload shape, and referenced
 * business entities, then applies planned item stock adjustments, persists finalized sales/sale_items,
 * updates customer/supplier accounting summaries, and writes authoritative payment ledger rows when paid
 * amounts are non-zero. It exercises lock, transaction, status, audit, and rollback paths. It now mutates cylinders when replayed cylinder/gas items require it.
 */

class ReplayBusinessValidationException extends RuntimeException
{
}

class ReplayStockMutationException extends RuntimeException
{
}

class ReplaySalesPersistenceException extends RuntimeException
{
}

class ReplayAccountingMutationException extends RuntimeException
{
}


class ReplayPaymentPersistenceException extends RuntimeException
{
}

class ReplayBatchMutationException extends RuntimeException
{
}

class ReplayCylinderMutationException extends RuntimeException
{
}

class ReplayInventoryValidationException extends ReplayBusinessValidationException
{
}


function replayStoredTransactionAuthorized(PDO $pdo, int|string $syncTransactionId, array $authContext): array
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
        $result = replayStoredTransaction($pdo, $syncTransactionId, $workerId);
        $result['authorized'] = true;
        $result['actor'] = [
            'actorType' => $auth['actorType'],
            'actorId' => $auth['actorId'],
            'actorRole' => $auth['actorRole'],
            'sessionId' => $auth['sessionId'],
        ];
        return $result;
    } finally {
        setTransactionReplayAuditActor(null);
    }
}

function replayStoredTransaction(PDO $pdo, int|string $syncTransactionId, string $workerId): array
{
    $id = (int) $syncTransactionId;
    $worker = trim($workerId);

    if ($id <= 0 || $worker === '') {
        return [
            'success' => false,
            'reason' => 'invalid_arguments',
        ];
    }

    $existingRow = getReplayProcessorTransactionRow($pdo, $id);
    if ($existingRow === null) {
        return [
            'success' => false,
            'reason' => 'not_found',
        ];
    }

    $terminalResult = skipReplayTerminalStateIfNeeded($pdo, $id, $existingRow);
    if ($terminalResult !== null) {
        return $terminalResult;
    }

    $lock = acquireReplayLock($pdo, $id, $worker);
    if (($lock['success'] ?? false) !== true) {
        return [
            'success' => false,
            'reason' => $lock['reason'] ?? 'lock_not_acquired',
            'lock' => $lock,
        ];
    }

    $transactionStarted = false;
    $clientTransactionId = (string) $existingRow['client_transaction_id'];

    try {
        $pdo->beginTransaction();
        $transactionStarted = true;

        $row = getReplayProcessorTransactionRowForUpdate($pdo, $id);
        if ($row === null) {
            throw new RuntimeException('Stored transaction row was not found during replay skeleton validation.');
        }

        $clientTransactionId = (string) ($row['client_transaction_id'] ?? '');
        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_validation_started',
            'processing',
            'processing',
            'Replay validation started before stock, sales persistence, accounting mutation, payment persistence, batch mutation, and cylinder mutation.'
        );

        $payload = validateReplaySkeletonPayload($row);
        validateReplayBusinessReferences($pdo, $payload);
        validateReplayInventorySufficiency($pdo, $payload);
        $mutationPlan = buildReplayMutationPlan($payload);

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_mutation_plan_generated',
            'processing',
            'processing',
            'Replay stock mutation plan generated in memory.'
        );

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_stock_mutation_started',
            'processing',
            'processing',
            'Replay stock mutation started. Only items.availableStock may be changed.'
        );

        $stockMutationResult = applyReplayStockAdjustments($pdo, $mutationPlan['stockAdjustments']);
        $stockMutationsApplied = (int) ($stockMutationResult['appliedCount'] ?? 0) > 0;

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_stock_mutation_completed',
            'processing',
            'processing',
            'Replay stock mutation completed. Only items.availableStock was changed.'
        );

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_sales_persistence_started',
            'processing',
            'processing',
            'Replay sales persistence started. Batch and cylinder mutation may follow.'
        );

        $salesPersistenceResult = persistReplayFinalizedSale($pdo, $id, $clientTransactionId, $payload);
        $salesPersisted = (int) ($salesPersistenceResult['saleItemsInserted'] ?? 0) > 0 || isset($salesPersistenceResult['saleId']);

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_sales_persistence_completed',
            'processing',
            'processing',
            'Replay sales persistence completed. Batch and cylinder mutation may follow.'
        );

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_accounting_mutation_started',
            'processing',
            'processing',
            'Replay accounting mutation started. Payment ledger, batch, and cylinder mutation may follow.'
        );

        $accountingMutationResult = applyReplayAccountingMutation($pdo, $payload);
        $accountingMutationsApplied = (int) ($accountingMutationResult['appliedCount'] ?? 0) > 0;

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_accounting_mutation_completed',
            'processing',
            'processing',
            'Replay accounting mutation completed. Payment ledger, batch, and cylinder mutation may follow.'
        );

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_payment_persistence_started',
            'processing',
            'processing',
            'Replay payment ledger persistence started. Batch and cylinder mutation may follow.'
        );

        $paymentPersistenceResult = persistReplayPaymentRows($pdo, $id, $clientTransactionId, $payload, $salesPersistenceResult, $accountingMutationResult);
        $paymentsPersisted = (int) ($paymentPersistenceResult['insertedCount'] ?? 0) > 0;

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_payment_persistence_completed',
            'processing',
            'processing',
            'Replay payment ledger persistence completed. Batch and cylinder mutation may follow.'
        );

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_batch_mutation_started',
            'processing',
            'processing',
            'Replay batch mutation started. Cylinder mutation may follow.'
        );

        $batchMutationResult = applyReplayBatchMutations($pdo, $id, $clientTransactionId, $payload, $salesPersistenceResult, $mutationPlan);
        $batchMutationsApplied = (int) ($batchMutationResult['appliedCount'] ?? 0) > 0;

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_batch_mutation_completed',
            'processing',
            'processing',
            'Replay batch mutation completed. Cylinder mutation may follow.'
        );

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_cylinder_mutation_started',
            'processing',
            'processing',
            'Replay cylinder mutation started.'
        );

        $cylinderMutationResult = applyReplayCylinderMutations($pdo, $id, $clientTransactionId, $payload, $mutationPlan);
        $cylinderMutationsApplied = (int) ($cylinderMutationResult['appliedCount'] ?? 0) > 0;

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_cylinder_mutation_completed',
            'processing',
            'processing',
            'Replay cylinder mutation completed.'
        );

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'replay_validation_completed',
            'processing',
            'processing',
            'Replay validation, stock mutation, sales persistence, accounting mutation, payment persistence, batch mutation, and cylinder mutation completed.'
        );

        $pdo->commit();
        $transactionStarted = false;

        $release = releaseReplayLock($pdo, $id, $worker, 'committed', null);
        if (($release['success'] ?? false) !== true) {
            return [
                'success' => false,
                'reason' => 'release_failed_after_validation',
                'syncTransactionId' => $id,
                'clientTransactionId' => $clientTransactionId,
                'release' => $release,
            ];
        }

        return [
            'success' => true,
            'syncTransactionId' => $id,
            'clientTransactionId' => $clientTransactionId,
            'replayStatus' => 'committed',
            'storedOnly' => false,
            'businessMutationsApplied' => $stockMutationsApplied || $salesPersisted || $accountingMutationsApplied || $paymentsPersisted || $batchMutationsApplied || $cylinderMutationsApplied,
            'stockMutationsApplied' => $stockMutationsApplied,
            'salesPersisted' => $salesPersisted,
            'accountingMutationsApplied' => $accountingMutationsApplied,
            'paymentsPersisted' => $paymentsPersisted,
            'batchMutationsApplied' => $batchMutationsApplied,
            'cylinderMutationsApplied' => $cylinderMutationsApplied,
            'mutationPlan' => $mutationPlan,
            'stockMutationResult' => $stockMutationResult,
            'salesPersistenceResult' => $salesPersistenceResult,
            'accountingMutationResult' => $accountingMutationResult,
            'paymentPersistenceResult' => $paymentPersistenceResult,
            'batchMutationResult' => $batchMutationResult,
            'cylinderMutationResult' => $cylinderMutationResult,
            'release' => $release,
        ];
    } catch (Throwable $exception) {
        if ($transactionStarted && $pdo->inTransaction()) {
            $pdo->rollBack();
        }

        try {
            if ($exception instanceof ReplayCylinderMutationException) {
                insertTransactionReplayAuditEvent(
                    $pdo,
                    $id,
                    $clientTransactionId,
                    'replay_cylinder_mutation_failed',
                    'processing',
                    'failed',
                    'Replay cylinder mutation failed and was rolled back with stock, sales, accounting, payment ledger, and batch changes.'
                );
            } elseif ($exception instanceof ReplayBatchMutationException) {
                insertTransactionReplayAuditEvent(
                    $pdo,
                    $id,
                    $clientTransactionId,
                    'replay_batch_mutation_failed',
                    'processing',
                    'failed',
                    'Replay batch mutation failed and was rolled back with stock, sales, accounting, and payment ledger changes. No cylinder mutations were applied.'
                );
            } elseif ($exception instanceof ReplayPaymentPersistenceException) {
                insertTransactionReplayAuditEvent(
                    $pdo,
                    $id,
                    $clientTransactionId,
                    'replay_payment_persistence_failed',
                    'processing',
                    'failed',
                    'Replay payment ledger persistence failed and was rolled back with stock, sales, accounting, and batch changes. No cylinder mutations were applied.'
                );
            } elseif ($exception instanceof ReplayAccountingMutationException) {
                insertTransactionReplayAuditEvent(
                    $pdo,
                    $id,
                    $clientTransactionId,
                    'replay_accounting_mutation_failed',
                    'processing',
                    'failed',
                    'Replay accounting mutation failed and was rolled back with stock, sales, and payment ledger changes. No cylinder or batch mutations were applied.'
                );
            } elseif ($exception instanceof ReplaySalesPersistenceException) {
                insertTransactionReplayAuditEvent(
                    $pdo,
                    $id,
                    $clientTransactionId,
                    'replay_sales_persistence_failed',
                    'processing',
                    'failed',
                    'Replay sales persistence failed and was rolled back with stock, accounting, and payment ledger changes. No cylinder or batch mutations were applied.'
                );
            } elseif ($exception instanceof ReplayStockMutationException) {
                insertTransactionReplayAuditEvent(
                    $pdo,
                    $id,
                    $clientTransactionId,
                    'replay_stock_mutation_failed',
                    'processing',
                    'failed',
                    'Replay stock mutation failed and was rolled back. No accounting, payment, cylinder, batch, sale, or sale item mutations were applied.'
                );
            } elseif ($exception instanceof ReplayInventoryValidationException) {
                insertTransactionReplayAuditEvent(
                    $pdo,
                    $id,
                    $clientTransactionId,
                    'replay_inventory_validation_failed',
                    'processing',
                    'failed',
                    'Replay inventory sufficiency validation failed. No stock mutation was applied.'
                );
            } elseif ($exception instanceof ReplayBusinessValidationException) {
                insertTransactionReplayAuditEvent(
                    $pdo,
                    $id,
                    $clientTransactionId,
                    'replay_business_validation_failed',
                    'processing',
                    'failed',
                    'Replay business-reference validation failed. No stock mutation was applied.'
                );
            }

            insertTransactionReplayAuditEvent(
                $pdo,
                $id,
                $clientTransactionId,
                'replay_failed',
                'processing',
                'failed',
                'Replay failed and any stock/sales/accounting/payment ledger/batch/cylinder changes were rolled back.'
            );
        } catch (Throwable $auditException) {
            unset($auditException);
        }

        $release = releaseReplayLock($pdo, $id, $worker, 'failed', $exception->getMessage());

        $reason = 'validation_failed';
        if ($exception instanceof ReplayCylinderMutationException) {
            $reason = 'cylinder_mutation_failed';
        } elseif ($exception instanceof ReplayBatchMutationException) {
            $reason = 'batch_mutation_failed';
        } elseif ($exception instanceof ReplayPaymentPersistenceException) {
            $reason = 'payment_persistence_failed';
        } elseif ($exception instanceof ReplayAccountingMutationException) {
            $reason = 'accounting_mutation_failed';
        } elseif ($exception instanceof ReplaySalesPersistenceException) {
            $reason = 'sales_persistence_failed';
        } elseif ($exception instanceof ReplayStockMutationException) {
            $reason = 'stock_mutation_failed';
        } elseif ($exception instanceof ReplayInventoryValidationException) {
            $reason = 'inventory_validation_failed';
        } elseif ($exception instanceof ReplayBusinessValidationException) {
            $reason = 'business_validation_failed';
        }

        return [
            'success' => false,
            'reason' => $reason,
            'syncTransactionId' => $id,
            'clientTransactionId' => $clientTransactionId,
            'error' => $exception->getMessage(),
            'release' => $release,
        ];
    }
}

function skipReplayTerminalStateIfNeeded(PDO $pdo, int $syncTransactionId, array $row): ?array
{
    $status = (string) ($row['replay_status'] ?? '');
    $terminalStatuses = ['committed', 'rolled_back', 'duplicate'];

    if (!in_array($status, $terminalStatuses, true)) {
        return null;
    }

    $clientTransactionId = (string) ($row['client_transaction_id'] ?? '');
    insertTransactionReplayAuditEvent(
        $pdo,
        $syncTransactionId,
        $clientTransactionId,
        'replay_terminal_state_skipped',
        $status,
        $status,
        'Replay skeleton skipped a terminal-state transaction. No replay was executed.'
    );

    return [
        'success' => true,
        'terminalStateSkipped' => true,
        'alreadyCommitted' => $status === 'committed',
        'syncTransactionId' => $syncTransactionId,
        'clientTransactionId' => $clientTransactionId,
        'replayStatus' => $status,
        'storedOnly' => true,
        'businessMutationsApplied' => false,
    ];
}
function validateReplaySkeletonPayload(array $row): array
{
    $payloadJson = $row['payload_json'] ?? null;
    if (!is_string($payloadJson) || trim($payloadJson) === '') {
        throw new RuntimeException('Stored transaction payload_json is empty.');
    }

    $payload = json_decode($payloadJson, true);
    if (!is_array($payload) || array_is_list($payload)) {
        throw new RuntimeException('Stored transaction payload_json must decode to an object.');
    }

    $clientTransactionId = (string) ($row['client_transaction_id'] ?? '');
    if (($payload['clientTransactionId'] ?? null) !== $clientTransactionId) {
        throw new RuntimeException('Stored payload clientTransactionId does not match sync_transactions row.');
    }

    if (!isset($payload['payload']) || !is_array($payload['payload']) || array_is_list($payload['payload'])) {
        throw new RuntimeException('Stored transaction payload must contain an object payload field.');
    }

    return $payload;
}

function validateReplayBusinessReferences(PDO $pdo, array $storedPayload): void
{
    $transactionPayload = $storedPayload['payload'];

    $customerIds = collectReplayReferenceIds($transactionPayload, ['customerId']);
    $supplierIds = collectReplayReferenceIds($transactionPayload, ['supplierId']);
    $itemIds = collectReplayItemReferenceIds($transactionPayload);

    validateReplayExistingActiveIds($pdo, 'customers', $customerIds, 'customer');
    validateReplayExistingActiveIds($pdo, 'suppliers', $supplierIds, 'supplier');
    validateReplayExistingActiveIds($pdo, 'items', $itemIds, 'item');
}



function buildReplayMutationPlan(array $storedPayload): array
{
    $plan = [
        'stockAdjustments' => [],
        'accountingAdjustments' => [],
        'paymentEffects' => [],
        'cylinderEffects' => [],
        'batchEffects' => [],
        'warnings' => [],
    ];

    $stockRule = getReplayStockPlanningRule($storedPayload);
    if ($stockRule === null) {
        $plan['warnings'][] = 'No stock planning rule applies to this transaction type yet.';
        return $plan;
    }

    $transactionPayload = $storedPayload['payload'];
    $items = $transactionPayload['saleItems'] ?? $transactionPayload['items'] ?? [];

    if (!is_array($items) || !array_is_list($items)) {
        throw new ReplayInventoryValidationException('Mutation planning items must be provided as an array.');
    }

    foreach ($items as $index => $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new ReplayInventoryValidationException("Mutation planning item at index $index must be an object.");
        }

        $rawId = $item['originalItemId'] ?? $item['itemId'] ?? null;
        if ($rawId === null || $rawId === '') {
            throw new ReplayInventoryValidationException("Mutation planning item at index $index must include originalItemId or itemId.");
        }

        $itemId = normalizeRequiredReplayReferenceId($rawId, "mutation planning item at index $index");
        $quantity = normalizeReplayPositiveQuantity($item['qty'] ?? $item['quantity'] ?? null, "mutation planning quantity at index $index");

        $plan['stockAdjustments'][] = [
            'itemId' => $itemId,
            'transactionType' => $stockRule['transactionType'],
            'direction' => $stockRule['direction'],
            'qty' => $quantity,
            'reason' => $stockRule['reason'],
        ];
    }

    return $plan;
}

function getReplayStockPlanningRule(array $storedPayload): ?array
{
    $transactionType = strtolower(trim((string) ($storedPayload['transactionType'] ?? '')));
    $transactionPayload = is_array($storedPayload['payload'] ?? null) ? $storedPayload['payload'] : [];
    $returnMode = strtolower(trim((string) ($transactionPayload['returnMode'] ?? '')));
    $sale = is_array($transactionPayload['sale'] ?? null) ? $transactionPayload['sale'] : [];
    $saleTransactionType = strtolower(trim((string) ($sale['transactionType'] ?? $transactionPayload['transactionType'] ?? '')));

    if ($transactionType === 'purchase') {
        return [
            'transactionType' => 'Purchase',
            'direction' => 'increase',
            'reason' => 'Purchase increases stock.',
        ];
    }

    if ($transactionType === 'sale') {
        if (str_contains($saleTransactionType, 'purchase')) {
            return [
                'transactionType' => 'Purchase',
                'direction' => 'increase',
                'reason' => 'Purchase increases stock.',
            ];
        }

        if (str_contains($saleTransactionType, 'customer return')) {
            return [
                'transactionType' => 'Customer Return',
                'direction' => 'increase',
                'reason' => 'Customer return increases stock.',
            ];
        }

        if (str_contains($saleTransactionType, 'supplier return')) {
            return [
                'transactionType' => 'Supplier Return',
                'direction' => 'decrease',
                'reason' => 'Supplier return decreases stock.',
            ];
        }

        return [
            'transactionType' => 'Sale',
            'direction' => 'decrease',
            'reason' => 'Sale decreases stock.',
        ];
    }

    if ($transactionType === 'return') {
        if ($returnMode === 'supplier' || str_contains($saleTransactionType, 'supplier return')) {
            return [
                'transactionType' => 'Supplier Return',
                'direction' => 'decrease',
                'reason' => 'Supplier return decreases stock.',
            ];
        }

        return [
            'transactionType' => 'Customer Return',
            'direction' => 'increase',
            'reason' => 'Customer return increases stock.',
        ];
    }

    return null;
}

function applyReplayStockAdjustments(PDO $pdo, array $stockAdjustments): array
{
    $applied = [];

    foreach ($stockAdjustments as $index => $adjustment) {
        if (!is_array($adjustment) || array_is_list($adjustment)) {
            throw new ReplayStockMutationException("Stock adjustment at index $index must be an object.");
        }

        $itemId = normalizeRequiredReplayReferenceId($adjustment['itemId'] ?? null, "stock adjustment item at index $index");
        $quantity = normalizeReplayPositiveQuantity($adjustment['qty'] ?? null, "stock adjustment quantity at index $index");
        $direction = strtolower(trim((string) ($adjustment['direction'] ?? '')));

        if (!in_array($direction, ['increase', 'decrease'], true)) {
            throw new ReplayStockMutationException("Unsupported stock adjustment direction at index $index.");
        }

        $statement = $pdo->prepare(
            'SELECT `id`, `availableStock`
             FROM `items`
             WHERE `id` = :id AND `is_deleted` = 0
             LIMIT 1
             FOR UPDATE'
        );
        $statement->execute(['id' => $itemId]);
        $row = $statement->fetch();

        if (!$row) {
            throw new ReplayStockMutationException("Stock mutation item does not exist: $itemId");
        }

        $stockValue = $row['availableStock'] ?? null;
        if ($stockValue === null || $stockValue === '' || !is_numeric($stockValue)) {
            throw new ReplayStockMutationException("Stock mutation item has missing or non-numeric stock: $itemId");
        }

        $beforeStock = (float) $stockValue;
        if (!is_finite($beforeStock)) {
            throw new ReplayStockMutationException("Stock mutation item has invalid stock: $itemId");
        }

        if ($direction === 'decrease') {
            if ($beforeStock + 0.000001 < $quantity) {
                throw new ReplayStockMutationException("Insufficient stock during mutation for item: $itemId");
            }
            $afterStock = $beforeStock - $quantity;
        } else {
            $afterStock = $beforeStock + $quantity;
        }

        if (!is_finite($afterStock) || $afterStock < -0.000001) {
            throw new ReplayStockMutationException("Stock mutation would produce invalid stock for item: $itemId");
        }

        if ($afterStock < 0) {
            $afterStock = 0.0;
        }

        $update = $pdo->prepare(
            'UPDATE `items`
             SET `availableStock` = :availableStock
             WHERE `id` = :id'
        );
        $update->execute([
            'availableStock' => $afterStock,
            'id' => $itemId,
        ]);

        if ($update->rowCount() !== 1) {
            throw new ReplayStockMutationException("Stock mutation update failed for item: $itemId");
        }

        $applied[] = [
            'itemId' => $itemId,
            'direction' => $direction,
            'qty' => $quantity,
            'before' => $beforeStock,
            'after' => $afterStock,
        ];
    }

    return [
        'appliedCount' => count($applied),
        'applied' => $applied,
    ];
}

function persistReplayFinalizedSale(PDO $pdo, int $syncTransactionId, string $clientTransactionId, array $storedPayload): array
{
    $stockRule = getReplayStockPlanningRule($storedPayload);
    if ($stockRule === null) {
        return [
            'skipped' => true,
            'reason' => 'no_sales_persistence_rule',
        ];
    }

    $transactionPayload = $storedPayload['payload'];
    $header = getReplaySaleHeaderPayload($storedPayload, $stockRule['transactionType']);
    $items = $transactionPayload['saleItems'] ?? $transactionPayload['items'] ?? null;

    if (!is_array($items) || !array_is_list($items) || $items === []) {
        throw new ReplaySalesPersistenceException('Sales persistence requires at least one sale item.');
    }

    $invoiceNo = trim((string) ($header['invoiceNo'] ?? $transactionPayload['invoiceNo'] ?? $clientTransactionId));
    if ($invoiceNo === '') {
        $invoiceNo = $clientTransactionId;
    }

    $createdAt = $storedPayload['createdAt'] ?? null;
    $date = trim((string) ($header['date'] ?? $transactionPayload['date'] ?? ''));
    if ($date === '') {
        $date = is_numeric($createdAt) ? date('Y-m-d', (int) $createdAt) : date('Y-m-d');
    }

    $saleItemRows = normalizeReplaySaleItemsForPersistence($items);
    $computedSubtotal = 0.0;
    foreach ($saleItemRows as $itemRow) {
        $computedSubtotal += (float) $itemRow['qty'] * (float) $itemRow['price'];
    }

    $subtotal = normalizeReplayOptionalNumber($header['subtotal'] ?? $transactionPayload['subtotal'] ?? null, $computedSubtotal);
    $discount = normalizeReplayOptionalNumber($header['discount'] ?? $transactionPayload['discount'] ?? null, 0.0);
    $tax = normalizeReplayOptionalNumber($header['tax'] ?? $transactionPayload['tax'] ?? null, 0.0);
    $grandTotal = normalizeReplayOptionalNumber($header['grandTotal'] ?? $transactionPayload['grandTotal'] ?? null, $subtotal - $discount + $tax);
    $paid = normalizeReplayOptionalNumber($header['paid'] ?? $transactionPayload['paid'] ?? null, 0.0);
    $arrears = normalizeReplayOptionalNumber($header['arrears'] ?? $transactionPayload['arrears'] ?? null, 0.0);
    $dues = normalizeReplayOptionalNumber($header['dues'] ?? $transactionPayload['dues'] ?? null, max(0.0, $grandTotal - $paid));
    $profit = normalizeReplayOptionalNumber($header['profit'] ?? $transactionPayload['profit'] ?? null, 0.0);

    $customerId = normalizeOptionalReplayReferenceId($header['customerId'] ?? $transactionPayload['customerId'] ?? null, 'sales customerId');
    $supplierId = normalizeOptionalReplayReferenceId($header['supplierId'] ?? $transactionPayload['supplierId'] ?? null, 'sales supplierId');

    $insertSale = $pdo->prepare(
        'INSERT INTO `sales`
            (`sync_transaction_id`, `client_transaction_id`, `invoiceNo`, `date`, `transactionType`, `customerId`, `supplierId`, `customerName`, `supplierName`, `subtotal`, `discount`, `tax`, `dues`, `grandTotal`, `paid`, `arrears`, `profit`, `isPostponed`, `sale_json`)
         VALUES
            (:sync_transaction_id, :client_transaction_id, :invoiceNo, :date, :transactionType, :customerId, :supplierId, :customerName, :supplierName, :subtotal, :discount, :tax, :dues, :grandTotal, :paid, :arrears, :profit, :isPostponed, :sale_json)'
    );

    try {
        $insertSale->execute([
            'sync_transaction_id' => $syncTransactionId,
            'client_transaction_id' => $clientTransactionId,
            'invoiceNo' => $invoiceNo,
            'date' => $date,
            'transactionType' => $stockRule['transactionType'],
            'customerId' => $customerId,
            'supplierId' => $supplierId,
            'customerName' => normalizeReplayOptionalString($header['customerName'] ?? $transactionPayload['customerName'] ?? null),
            'supplierName' => normalizeReplayOptionalString($header['supplierName'] ?? $transactionPayload['supplierName'] ?? null),
            'subtotal' => $subtotal,
            'discount' => $discount,
            'tax' => $tax,
            'dues' => $dues,
            'grandTotal' => $grandTotal,
            'paid' => $paid,
            'arrears' => $arrears,
            'profit' => $profit,
            'isPostponed' => !empty($header['isPostponed']) ? 1 : 0,
            'sale_json' => json_encode($header, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
    } catch (Throwable $exception) {
        throw new ReplaySalesPersistenceException('Sales header persistence failed: ' . $exception->getMessage(), 0, $exception);
    }

    $saleId = (int) $pdo->lastInsertId();
    if ($saleId <= 0) {
        throw new ReplaySalesPersistenceException('Sales header persistence did not return a sale id.');
    }

    $insertItem = $pdo->prepare(
        'INSERT INTO `sale_items`
            (`sale_id`, `originalItemId`, `name`, `qty`, `price`, `priceCategory`, `discountType`, `discountValue`, `taxType`, `taxValue`, `item_json`)
         VALUES
            (:sale_id, :originalItemId, :name, :qty, :price, :priceCategory, :discountType, :discountValue, :taxType, :taxValue, :item_json)'
    );

    $insertedItems = 0;
    foreach ($saleItemRows as $itemRow) {
        try {
            $insertItem->execute([
                'sale_id' => $saleId,
                'originalItemId' => $itemRow['originalItemId'],
                'name' => $itemRow['name'],
                'qty' => $itemRow['qty'],
                'price' => $itemRow['price'],
                'priceCategory' => $itemRow['priceCategory'],
                'discountType' => $itemRow['discountType'],
                'discountValue' => $itemRow['discountValue'],
                'taxType' => $itemRow['taxType'],
                'taxValue' => $itemRow['taxValue'],
                'item_json' => $itemRow['itemJson'],
            ]);
            $insertedItems += 1;
        } catch (Throwable $exception) {
            throw new ReplaySalesPersistenceException('Sale item persistence failed: ' . $exception->getMessage(), 0, $exception);
        }
    }

    return [
        'saleId' => $saleId,
        'saleItemsInserted' => $insertedItems,
        'invoiceNo' => $invoiceNo,
        'transactionType' => $stockRule['transactionType'],
    ];
}

function getReplaySaleHeaderPayload(array $storedPayload, string $fallbackTransactionType): array
{
    $transactionPayload = $storedPayload['payload'];
    foreach (['sale', 'purchase', 'return', 'invoice'] as $key) {
        if (isset($transactionPayload[$key]) && is_array($transactionPayload[$key]) && !array_is_list($transactionPayload[$key])) {
            $header = $transactionPayload[$key];
            if (!isset($header['transactionType']) || trim((string) $header['transactionType']) === '') {
                $header['transactionType'] = $fallbackTransactionType;
            }
            return $header;
        }
    }

    $header = $transactionPayload;
    $header['transactionType'] = $header['transactionType'] ?? $fallbackTransactionType;
    return $header;
}

function normalizeReplaySaleItemsForPersistence(array $items): array
{
    $rows = [];
    foreach ($items as $index => $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new ReplaySalesPersistenceException("Sale item at index $index must be an object.");
        }

        $itemId = normalizeRequiredReplayReferenceId($item['originalItemId'] ?? $item['itemId'] ?? null, "sale item at index $index");
        $qty = normalizeReplayPositiveQuantity($item['qty'] ?? $item['quantity'] ?? null, "sale item quantity at index $index");
        $price = normalizeReplayOptionalNumber($item['price'] ?? null, 0.0);

        $rows[] = [
            'originalItemId' => $itemId,
            'name' => normalizeReplayRequiredString($item['name'] ?? ('Item #' . $itemId), "sale item name at index $index"),
            'qty' => $qty,
            'price' => $price,
            'priceCategory' => normalizeReplayOptionalString($item['priceCategory'] ?? null) ?? 'Retail',
            'discountType' => normalizeReplayOptionalString($item['discountType'] ?? null) ?? 'flat',
            'discountValue' => normalizeReplayOptionalNumber($item['discountValue'] ?? null, 0.0),
            'taxType' => normalizeReplayOptionalString($item['taxType'] ?? null) ?? 'flat',
            'taxValue' => normalizeReplayOptionalNumber($item['taxValue'] ?? null, 0.0),
            'itemJson' => json_encode($item, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ];
    }

    return $rows;
}

function normalizeReplayOptionalNumber($value, float $default): float
{
    if ($value === null || $value === '') {
        return $default;
    }

    if (!is_numeric($value)) {
        throw new ReplaySalesPersistenceException('Sales persistence numeric field must be numeric.');
    }

    $number = (float) $value;
    if (!is_finite($number)) {
        throw new ReplaySalesPersistenceException('Sales persistence numeric field must be finite.');
    }

    return $number;
}

function normalizeReplayOptionalString($value): ?string
{
    if ($value === null) {
        return null;
    }

    $string = trim((string) $value);
    return $string === '' ? null : $string;
}

function normalizeReplayRequiredString($value, string $field): string
{
    $string = normalizeReplayOptionalString($value);
    if ($string === null) {
        throw new ReplaySalesPersistenceException("Required $field is missing.");
    }

    return $string;
}

function applyReplayAccountingMutation(PDO $pdo, array $storedPayload): array
{
    $stockRule = getReplayStockPlanningRule($storedPayload);
    if ($stockRule === null) {
        return [
            'appliedCount' => 0,
            'applied' => [],
            'skipped' => true,
            'reason' => 'no_accounting_rule',
        ];
    }

    $transactionPayload = $storedPayload['payload'];
    $header = getReplaySaleHeaderPayload($storedPayload, $stockRule['transactionType']);
    $amount = calculateReplayAccountingAmount($storedPayload, $header);
    $paid = calculateReplayAccountingPaid($header, $transactionPayload, $stockRule['transactionType']);
    $isReturn = in_array($stockRule['transactionType'], ['Customer Return', 'Supplier Return'], true);
    $payableDelta = $isReturn ? -$amount : $amount;
    $paidDelta = $isReturn ? -abs($paid) : $paid;

    if ($stockRule['transactionType'] === 'Sale' || $stockRule['transactionType'] === 'Customer Return') {
        $customerId = normalizeOptionalReplayReferenceId($header['customerId'] ?? $transactionPayload['customerId'] ?? null, 'accounting customerId');
        if ($customerId === null) {
            return [
                'appliedCount' => 0,
                'applied' => [],
                'skipped' => true,
                'reason' => 'missing_customer_id',
            ];
        }

        $applied = applyReplayPartyAccountingMutation($pdo, 'customers', $customerId, $payableDelta, $paidDelta, $stockRule['transactionType']);
        return [
            'appliedCount' => 1,
            'applied' => [$applied],
        ];
    }

    if ($stockRule['transactionType'] === 'Purchase' || $stockRule['transactionType'] === 'Supplier Return') {
        $supplierId = normalizeOptionalReplayReferenceId($header['supplierId'] ?? $transactionPayload['supplierId'] ?? null, 'accounting supplierId');
        if ($supplierId === null) {
            return [
                'appliedCount' => 0,
                'applied' => [],
                'skipped' => true,
                'reason' => 'missing_supplier_id',
            ];
        }

        $applied = applyReplayPartyAccountingMutation($pdo, 'suppliers', $supplierId, $payableDelta, $paidDelta, $stockRule['transactionType']);
        return [
            'appliedCount' => 1,
            'applied' => [$applied],
        ];
    }

    return [
        'appliedCount' => 0,
        'applied' => [],
        'skipped' => true,
        'reason' => 'unsupported_accounting_transaction_type',
    ];
}

function applyReplayPartyAccountingMutation(PDO $pdo, string $table, int $partyId, float $payableDelta, float $paidDelta, string $transactionType): array
{
    if (!in_array($table, ['customers', 'suppliers'], true)) {
        throw new ReplayAccountingMutationException('Unsupported accounting table.');
    }

    $statement = $pdo->prepare(
        "SELECT `id`, `invoices`, `payable`, `paid`, `balance`
         FROM `$table`
         WHERE `id` = :id AND `is_deleted` = 0
         LIMIT 1
         FOR UPDATE"
    );
    $statement->execute(['id' => $partyId]);
    $row = $statement->fetch();

    if (!$row) {
        throw new ReplayAccountingMutationException("Accounting party does not exist: $table#$partyId");
    }

    $before = normalizeReplayAccountingRow($row);
    $afterPayable = $before['payable'] + $payableDelta;
    $afterPaid = $before['paid'] + $paidDelta;
    $afterBalance = $afterPayable - $afterPaid;
    $afterInvoices = $before['invoices'] + 1;

    foreach ([$afterPayable, $afterPaid, $afterBalance] as $value) {
        if (!is_finite($value)) {
            throw new ReplayAccountingMutationException('Accounting mutation produced an invalid numeric value.');
        }
    }

    $update = $pdo->prepare(
        "UPDATE `$table`
         SET `invoices` = :invoices,
             `payable` = :payable,
             `paid` = :paid,
             `balance` = :balance
         WHERE `id` = :id"
    );

    try {
        $update->execute([
            'invoices' => $afterInvoices,
            'payable' => $afterPayable,
            'paid' => $afterPaid,
            'balance' => $afterBalance,
            'id' => $partyId,
        ]);
    } catch (Throwable $exception) {
        throw new ReplayAccountingMutationException("Accounting update failed for $table#$partyId: " . $exception->getMessage(), 0, $exception);
    }

    if ($update->rowCount() !== 1) {
        throw new ReplayAccountingMutationException("Accounting update failed for $table#$partyId");
    }

    return [
        'table' => $table,
        'partyId' => $partyId,
        'transactionType' => $transactionType,
        'payableDelta' => $payableDelta,
        'paidDelta' => $paidDelta,
        'before' => $before,
        'after' => [
            'invoices' => $afterInvoices,
            'payable' => $afterPayable,
            'paid' => $afterPaid,
            'balance' => $afterBalance,
        ],
    ];
}

function normalizeReplayAccountingRow(array $row): array
{
    foreach (['payable', 'paid', 'balance'] as $field) {
        if (!isset($row[$field]) || !is_numeric($row[$field])) {
            throw new ReplayAccountingMutationException("Accounting field $field must be numeric.");
        }
    }

    return [
        'invoices' => (int) ($row['invoices'] ?? 0),
        'payable' => (float) $row['payable'],
        'paid' => (float) $row['paid'],
        'balance' => (float) $row['balance'],
    ];
}

function calculateReplayAccountingAmount(array $storedPayload, array $header): float
{
    $transactionPayload = $storedPayload['payload'];
    $items = $transactionPayload['saleItems'] ?? $transactionPayload['items'] ?? [];
    $computedSubtotal = 0.0;

    if (is_array($items) && array_is_list($items)) {
        foreach ($items as $item) {
            if (is_array($item) && !array_is_list($item)) {
                $qty = normalizeReplayPositiveQuantity($item['qty'] ?? $item['quantity'] ?? null, 'accounting item quantity');
                $price = normalizeReplayAccountingNumber($item['price'] ?? null, 0.0, 'accounting item price');
                $computedSubtotal += $qty * $price;
            }
        }
    }

    $subtotal = normalizeReplayAccountingNumber($header['subtotal'] ?? $transactionPayload['subtotal'] ?? null, $computedSubtotal, 'accounting subtotal');
    $discount = normalizeReplayAccountingNumber($header['discount'] ?? $transactionPayload['discount'] ?? null, 0.0, 'accounting discount');
    $tax = normalizeReplayAccountingNumber($header['tax'] ?? $transactionPayload['tax'] ?? null, 0.0, 'accounting tax');
    $amount = $subtotal - $discount + $tax;

    if (!is_finite($amount)) {
        throw new ReplayAccountingMutationException('Accounting amount must be finite.');
    }

    return $amount;
}

function calculateReplayAccountingPaid(array $header, array $transactionPayload, string $transactionType): float
{
    $value = normalizeReplayAccountingNumber($header['paid'] ?? $transactionPayload['paid'] ?? null, 0.0, 'accounting paid');
    return in_array($transactionType, ['Customer Return', 'Supplier Return'], true) ? abs($value) : $value;
}

function normalizeReplayAccountingNumber($value, float $default, string $field): float
{
    if ($value === null || $value === '') {
        return $default;
    }

    if (!is_numeric($value)) {
        throw new ReplayAccountingMutationException("$field must be numeric.");
    }

    $number = (float) $value;
    if (!is_finite($number)) {
        throw new ReplayAccountingMutationException("$field must be finite.");
    }

    return $number;
}
function persistReplayPaymentRows(PDO $pdo, int $syncTransactionId, string $clientTransactionId, array $storedPayload, array $salesPersistenceResult, array $accountingMutationResult): array
{
    $stockRule = getReplayStockPlanningRule($storedPayload);
    if ($stockRule === null) {
        return [
            'insertedCount' => 0,
            'inserted' => [],
            'skipped' => true,
            'reason' => 'no_payment_rule',
        ];
    }

    $transactionPayload = $storedPayload['payload'];
    $header = getReplaySaleHeaderPayload($storedPayload, $stockRule['transactionType']);
    $paid = calculateReplayAccountingPaid($header, $transactionPayload, $stockRule['transactionType']);
    $isReturn = in_array($stockRule['transactionType'], ['Customer Return', 'Supplier Return'], true);
    $effectivePaid = $isReturn ? -abs($paid) : $paid;

    if (abs($effectivePaid) < 0.000001) {
        return [
            'insertedCount' => 0,
            'inserted' => [],
            'skipped' => true,
            'reason' => 'zero_paid',
        ];
    }

    if ($stockRule['transactionType'] === 'Sale' || $stockRule['transactionType'] === 'Customer Return') {
        $customerId = normalizeOptionalReplayReferenceId($header['customerId'] ?? $transactionPayload['customerId'] ?? null, 'payment customerId');
        if ($customerId === null) {
            return [
                'insertedCount' => 0,
                'inserted' => [],
                'skipped' => true,
                'reason' => 'missing_customer_id',
            ];
        }

        if (!replayTableExists($pdo, 'customer_payments')) {
            return [
                'insertedCount' => 0,
                'inserted' => [],
                'skipped' => true,
                'reason' => 'missing_customer_payments_table',
            ];
        }

        $invoiceNo = normalizeReplayPaymentInvoiceNo($header, $transactionPayload, $clientTransactionId);
        $payment = insertReplayPaymentRow($pdo, 'customer_payments', [
            'customerId' => $customerId,
            'customerName' => normalizeReplayOptionalString($header['customerName'] ?? $transactionPayload['customerName'] ?? null) ?? '',
            'invoiceNo' => $invoiceNo,
            'amount' => $effectivePaid,
            'paymentDate' => normalizeReplayPaymentDate($storedPayload, $header, $transactionPayload),
            'remarks' => $stockRule['transactionType'] === 'Customer Return' ? 'Return adjustment ' . $invoiceNo : $invoiceNo,
            'payableSnapshot' => extractReplayAccountingSnapshotValue($accountingMutationResult, 'payable'),
            'balanceSnapshot' => extractReplayAccountingSnapshotValue($accountingMutationResult, 'balance'),
            'sync_transaction_id' => $syncTransactionId,
            'client_transaction_id' => $clientTransactionId,
            'sale_id' => isset($salesPersistenceResult['saleId']) ? (int) $salesPersistenceResult['saleId'] : null,
            'source' => 'transaction_replay',
        ]);

        return [
            'insertedCount' => 1,
            'inserted' => [$payment],
        ];
    }

    if ($stockRule['transactionType'] === 'Purchase' || $stockRule['transactionType'] === 'Supplier Return') {
        $supplierId = normalizeOptionalReplayReferenceId($header['supplierId'] ?? $transactionPayload['supplierId'] ?? null, 'payment supplierId');
        if ($supplierId === null) {
            return [
                'insertedCount' => 0,
                'inserted' => [],
                'skipped' => true,
                'reason' => 'missing_supplier_id',
            ];
        }

        if (!replayTableExists($pdo, 'supplier_payments')) {
            return [
                'insertedCount' => 0,
                'inserted' => [],
                'skipped' => true,
                'reason' => 'missing_supplier_payments_table',
            ];
        }

        $invoiceNo = normalizeReplayPaymentInvoiceNo($header, $transactionPayload, $clientTransactionId);
        $payment = insertReplayPaymentRow($pdo, 'supplier_payments', [
            'supplierId' => $supplierId,
            'supplierName' => normalizeReplayOptionalString($header['supplierName'] ?? $transactionPayload['supplierName'] ?? null) ?? '',
            'invoiceNo' => $invoiceNo,
            'amount' => $effectivePaid,
            'paymentDate' => normalizeReplayPaymentDate($storedPayload, $header, $transactionPayload),
            'remarks' => $stockRule['transactionType'] === 'Supplier Return' ? 'Supplier Return adjustment ' . $invoiceNo : $invoiceNo,
            'payableSnapshot' => extractReplayAccountingSnapshotValue($accountingMutationResult, 'payable'),
            'balanceSnapshot' => extractReplayAccountingSnapshotValue($accountingMutationResult, 'balance'),
            'sync_transaction_id' => $syncTransactionId,
            'client_transaction_id' => $clientTransactionId,
            'sale_id' => isset($salesPersistenceResult['saleId']) ? (int) $salesPersistenceResult['saleId'] : null,
            'source' => 'transaction_replay',
        ]);

        return [
            'insertedCount' => 1,
            'inserted' => [$payment],
        ];
    }

    return [
        'insertedCount' => 0,
        'inserted' => [],
        'skipped' => true,
        'reason' => 'unsupported_payment_transaction_type',
    ];
}

function insertReplayPaymentRow(PDO $pdo, string $table, array $values): array
{
    if (!in_array($table, ['customer_payments', 'supplier_payments'], true)) {
        throw new ReplayPaymentPersistenceException('Unsupported payment table.');
    }

    $columns = replayTableColumns($pdo, $table);
    $required = $table === 'customer_payments' ? ['customerId', 'amount'] : ['supplierId', 'amount'];
    foreach ($required as $requiredColumn) {
        if (!in_array($requiredColumn, $columns, true)) {
            throw new ReplayPaymentPersistenceException("Payment table $table is missing required column $requiredColumn.");
        }
    }

    $insert = [];
    foreach ($values as $column => $value) {
        if (in_array($column, $columns, true)) {
            $insert[$column] = $value;
        }
    }

    if ($insert === []) {
        throw new ReplayPaymentPersistenceException("Payment table $table has no compatible columns.");
    }

    $columnSql = implode(', ', array_map(static fn(string $column): string => "`$column`", array_keys($insert)));
    $placeholderSql = implode(', ', array_map(static fn(string $column): string => ':' . $column, array_keys($insert)));
    $statement = $pdo->prepare("INSERT INTO `$table` ($columnSql) VALUES ($placeholderSql)");

    try {
        $statement->execute($insert);
    } catch (Throwable $exception) {
        throw new ReplayPaymentPersistenceException("Payment persistence failed for $table: " . $exception->getMessage(), 0, $exception);
    }

    $id = (int) $pdo->lastInsertId();
    if ($id <= 0) {
        throw new ReplayPaymentPersistenceException("Payment persistence did not return an id for $table.");
    }

    return [
        'table' => $table,
        'id' => $id,
        'amount' => (float) ($values['amount'] ?? 0),
        'invoiceNo' => $values['invoiceNo'] ?? null,
        'saleId' => $values['sale_id'] ?? null,
    ];
}

function replayTableExists(PDO $pdo, string $table): bool
{
    $statement = $pdo->prepare('SELECT COUNT(*) AS table_count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = :table_name');
    $statement->execute(['table_name' => $table]);
    return (int) (($statement->fetch()['table_count'] ?? 0)) > 0;
}

function replayTableColumns(PDO $pdo, string $table): array
{
    $statement = $pdo->prepare('SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :table_name');
    $statement->execute(['table_name' => $table]);
    return array_map('strval', $statement->fetchAll(PDO::FETCH_COLUMN));
}

function normalizeReplayPaymentInvoiceNo(array $header, array $transactionPayload, string $clientTransactionId): string
{
    $invoiceNo = trim((string) ($header['invoiceNo'] ?? $transactionPayload['invoiceNo'] ?? $clientTransactionId));
    return $invoiceNo === '' ? $clientTransactionId : $invoiceNo;
}

function normalizeReplayPaymentDate(array $storedPayload, array $header, array $transactionPayload): string
{
    $date = trim((string) ($header['paymentDate'] ?? $transactionPayload['paymentDate'] ?? $header['date'] ?? $transactionPayload['date'] ?? ''));
    if ($date !== '') {
        return $date;
    }

    $createdAt = $storedPayload['createdAt'] ?? null;
    if (is_numeric($createdAt)) {
        $timestamp = (int) $createdAt;
        if ($timestamp > 9999999999) {
            $timestamp = (int) floor($timestamp / 1000);
        }
        return date('c', $timestamp);
    }

    return date('c');
}

function extractReplayAccountingSnapshotValue(array $accountingMutationResult, string $field): float
{
    $first = $accountingMutationResult['applied'][0]['after'][$field] ?? null;
    if ($first === null || $first === '' || !is_numeric($first)) {
        return 0.0;
    }

    return (float) $first;
}
function applyReplayBatchMutations(PDO $pdo, int $syncTransactionId, string $clientTransactionId, array $storedPayload, array $salesPersistenceResult, array $mutationPlan): array
{
    $stockRule = getReplayStockPlanningRule($storedPayload);
    if ($stockRule === null) {
        return [
            'appliedCount' => 0,
            'created' => [],
            'consumed' => [],
            'skipped' => true,
            'reason' => 'no_batch_rule',
        ];
    }

    if (!replayTableExists($pdo, 'item_batches')) {
        throw new ReplayBatchMutationException('Batch table item_batches does not exist.');
    }

    $transactionPayload = $storedPayload['payload'];
    $header = getReplaySaleHeaderPayload($storedPayload, $stockRule['transactionType']);
    $items = $transactionPayload['saleItems'] ?? $transactionPayload['items'] ?? null;
    if (!is_array($items) || !array_is_list($items) || $items === []) {
        throw new ReplayBatchMutationException('Batch mutation requires item rows.');
    }

    $invoiceNo = trim((string) ($salesPersistenceResult['invoiceNo'] ?? $header['invoiceNo'] ?? $transactionPayload['invoiceNo'] ?? $clientTransactionId));
    if ($invoiceNo === '') {
        $invoiceNo = $clientTransactionId;
    }

    $saleId = isset($salesPersistenceResult['saleId']) ? (int) $salesPersistenceResult['saleId'] : null;
    $created = [];
    $consumed = [];

    foreach ($items as $index => $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new ReplayBatchMutationException("Batch mutation item at index $index must be an object.");
        }

        $itemId = normalizeRequiredReplayReferenceId($item['originalItemId'] ?? $item['itemId'] ?? null, "batch item at index $index");
        $quantity = normalizeReplayPositiveQuantity($item['qty'] ?? $item['quantity'] ?? null, "batch quantity at index $index");

        if (in_array($stockRule['transactionType'], ['Purchase', 'Customer Return'], true)) {
            $created[] = createReplayBatchRow($pdo, $syncTransactionId, $clientTransactionId, $item, $itemId, $quantity, $stockRule['transactionType'], $invoiceNo, $saleId, $storedPayload, $header, $transactionPayload);
            continue;
        }

        if (in_array($stockRule['transactionType'], ['Sale', 'Supplier Return'], true)) {
            $consumed = array_merge($consumed, consumeReplayBatchRows($pdo, $item, $itemId, $quantity, $stockRule['transactionType']));
            continue;
        }
    }

    return [
        'appliedCount' => count($created) + count($consumed),
        'created' => $created,
        'consumed' => $consumed,
    ];
}

function createReplayBatchRow(PDO $pdo, int $syncTransactionId, string $clientTransactionId, array $item, int $itemId, float $quantity, string $transactionType, string $invoiceNo, ?int $saleId, array $storedPayload, array $header, array $transactionPayload): array
{
    $purchaseDate = trim((string) ($item['purchaseDate'] ?? $header['purchaseDate'] ?? $header['date'] ?? $transactionPayload['date'] ?? ''));
    if ($purchaseDate === '') {
        $purchaseDate = normalizeReplayPaymentDate($storedPayload, $header, $transactionPayload);
    }

    $costPrice = normalizeReplayBatchCostPrice($item);
    $statement = $pdo->prepare(
        'INSERT INTO `item_batches`
            (`itemId`, `purchaseDate`, `qtyPurchased`, `qtySold`, `balance`, `costPrice`, `sourceSaleId`, `invoiceNo`, `sync_transaction_id`, `client_transaction_id`, `batch_json`, `isDeleted`, `deletedAt`)
         VALUES
            (:itemId, :purchaseDate, :qtyPurchased, 0, :balance, :costPrice, :sourceSaleId, :invoiceNo, :sync_transaction_id, :client_transaction_id, :batch_json, 0, NULL)'
    );

    try {
        $statement->execute([
            'itemId' => $itemId,
            'purchaseDate' => $purchaseDate,
            'qtyPurchased' => $quantity,
            'balance' => $quantity,
            'costPrice' => $costPrice,
            'sourceSaleId' => $saleId,
            'invoiceNo' => $invoiceNo,
            'sync_transaction_id' => $syncTransactionId,
            'client_transaction_id' => $clientTransactionId,
            'batch_json' => json_encode(['transactionType' => $transactionType, 'item' => $item], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
        ]);
    } catch (Throwable $exception) {
        throw new ReplayBatchMutationException('Batch creation failed: ' . $exception->getMessage(), 0, $exception);
    }

    $batchId = (int) $pdo->lastInsertId();
    if ($batchId <= 0) {
        throw new ReplayBatchMutationException('Batch creation did not return an id.');
    }

    return [
        'batchId' => $batchId,
        'localBatchId' => normalizeOptionalReplayReferenceId($item['batchLocalId'] ?? null, 'batchLocalId'),
        'itemId' => $itemId,
        'transactionType' => $transactionType,
        'qtyPurchased' => $quantity,
        'balance' => $quantity,
        'invoiceNo' => $invoiceNo,
    ];
}

function consumeReplayBatchRows(PDO $pdo, array $item, int $itemId, float $quantity, string $transactionType): array
{
    $requestedBatchId = normalizeOptionalReplayReferenceId($item['batchId'] ?? null, 'batchId');
    $rows = fetchReplayBatchRowsForConsumption($pdo, $itemId, $requestedBatchId);
    if ($rows === [] && $requestedBatchId === null) {
        return [];
    }

    $remaining = $quantity;
    $consumed = [];

    foreach ($rows as $row) {
        if ($remaining <= 0.000001) {
            break;
        }

        $batchId = (int) $row['id'];
        $balance = normalizeReplayBatchNumber($row['balance'] ?? null, "batch $batchId balance");
        if ($balance <= 0.000001) {
            continue;
        }

        $take = min($remaining, $balance);
        $before = [
            'qtyPurchased' => normalizeReplayBatchNumber($row['qtyPurchased'] ?? null, "batch $batchId qtyPurchased"),
            'qtySold' => normalizeReplayBatchNumber($row['qtySold'] ?? null, "batch $batchId qtySold"),
            'balance' => $balance,
        ];

        if ($transactionType === 'Supplier Return') {
            $afterPurchased = $before['qtyPurchased'] - $take;
            if ($afterPurchased < -0.000001) {
                throw new ReplayBatchMutationException("Supplier return would make batch qtyPurchased negative: $batchId");
            }
            $afterSold = $before['qtySold'];
        } else {
            $afterPurchased = $before['qtyPurchased'];
            $afterSold = $before['qtySold'] + $take;
        }

        $afterBalance = $before['balance'] - $take;
        if ($afterBalance < -0.000001) {
            throw new ReplayBatchMutationException("Batch balance would become negative: $batchId");
        }
        if ($afterBalance < 0) {
            $afterBalance = 0.0;
        }
        if ($afterPurchased < 0) {
            $afterPurchased = 0.0;
        }

        $update = $pdo->prepare(
            'UPDATE `item_batches`
             SET `qtyPurchased` = :qtyPurchased, `qtySold` = :qtySold, `balance` = :balance
             WHERE `id` = :id'
        );
        $update->execute([
            'qtyPurchased' => $afterPurchased,
            'qtySold' => $afterSold,
            'balance' => $afterBalance,
            'id' => $batchId,
        ]);

        if ($update->rowCount() !== 1) {
            throw new ReplayBatchMutationException("Batch update failed: $batchId");
        }

        $consumed[] = [
            'batchId' => $batchId,
            'itemId' => $itemId,
            'transactionType' => $transactionType,
            'qty' => $take,
            'before' => $before,
            'after' => [
                'qtyPurchased' => $afterPurchased,
                'qtySold' => $afterSold,
                'balance' => $afterBalance,
            ],
        ];

        $remaining -= $take;
    }

    if ($remaining > 0.000001) {
        throw new ReplayBatchMutationException("Insufficient batch inventory for item: $itemId");
    }

    return $consumed;
}

function fetchReplayBatchRowsForConsumption(PDO $pdo, int $itemId, ?int $batchId): array
{
    if ($batchId !== null) {
        $statement = $pdo->prepare(
            'SELECT `id`, `itemId`, `qtyPurchased`, `qtySold`, `balance`
             FROM `item_batches`
             WHERE `id` = :batchId AND `itemId` = :itemId AND `isDeleted` = 0
             LIMIT 1
             FOR UPDATE'
        );
        $statement->execute(['batchId' => $batchId, 'itemId' => $itemId]);
        $row = $statement->fetch();
        return $row ? [$row] : [];
    }

    $statement = $pdo->prepare(
        'SELECT `id`, `itemId`, `qtyPurchased`, `qtySold`, `balance`
         FROM `item_batches`
         WHERE `itemId` = :itemId AND `isDeleted` = 0 AND `balance` > 0
         ORDER BY `purchaseDate` ASC, `id` ASC
         FOR UPDATE'
    );
    $statement->execute(['itemId' => $itemId]);
    return $statement->fetchAll();
}

function normalizeReplayBatchCostPrice(array $item): float
{
    return normalizeReplayOptionalNumber($item['costPrice'] ?? $item['minUnitPrice'] ?? $item['purchasePrice'] ?? $item['price'] ?? null, 0.0);
}

function normalizeReplayBatchNumber($value, string $field): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new ReplayBatchMutationException("Required $field must be numeric.");
    }

    $number = (float) $value;
    if (!is_finite($number)) {
        throw new ReplayBatchMutationException("Required $field must be finite.");
    }

    return $number;
}
function applyReplayCylinderMutations(PDO $pdo, int $syncTransactionId, string $clientTransactionId, array $storedPayload, array $mutationPlan): array
{
    $stockRule = getReplayStockPlanningRule($storedPayload);
    if ($stockRule === null) {
        return ['appliedCount' => 0, 'applied' => [], 'holdings' => [], 'skipped' => true, 'reason' => 'no_cylinder_rule'];
    }

    $transactionPayload = $storedPayload['payload'];
    $header = getReplaySaleHeaderPayload($storedPayload, $stockRule['transactionType']);
    $items = $transactionPayload['saleItems'] ?? $transactionPayload['items'] ?? null;
    if (!is_array($items) || !array_is_list($items) || $items === []) {
        return ['appliedCount' => 0, 'applied' => [], 'holdings' => [], 'skipped' => true, 'reason' => 'no_items'];
    }

    if (!replayTableExists($pdo, 'cylinders')) {
        return ['appliedCount' => 0, 'applied' => [], 'holdings' => [], 'skipped' => true, 'reason' => 'missing_cylinders_table'];
    }

    $applied = [];
    $holdings = [];

    foreach ($items as $index => $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new ReplayCylinderMutationException("Cylinder mutation item at index $index must be an object.");
        }

        $itemId = normalizeRequiredReplayReferenceId($item['originalItemId'] ?? $item['itemId'] ?? null, "cylinder item at index $index");
        $itemRow = fetchReplayCylinderItemRow($pdo, $itemId);
        if ($itemRow === null) {
            throw new ReplayCylinderMutationException("Cylinder item does not exist: $itemId");
        }

        $cylinderRow = fetchReplayCylinderRowForUpdate($pdo, $itemId);
        $isCylinderItem = isReplayCylinderItemRow($itemRow) || $cylinderRow !== null;
        if (!$isCylinderItem) {
            continue;
        }
        if ($cylinderRow === null) {
            throw new ReplayCylinderMutationException("Cylinder inventory row does not exist for item: $itemId");
        }

        $rawQty = normalizeReplayPositiveQuantity($item['qty'] ?? $item['quantity'] ?? null, "cylinder quantity at index $index");
        $convQty = normalizeReplayCylinderConvQty($item, $itemRow, $cylinderRow);
        $cylinderQty = (int) floor($rawQty / $convQty);
        if ($cylinderQty <= 0) {
            continue;
        }

        $before = normalizeReplayCylinderRow($cylinderRow);
        validateReplayCylinderInvariant($before, 'before');
        $after = $before;
        $holdingResult = null;
        $customerName = normalizeReplayCylinderCustomerName($pdo, $header, $transactionPayload);

        if ($stockRule['transactionType'] === 'Sale') {
            if ($after['filledCylinders'] + 0.000001 < $cylinderQty) {
                throw new ReplayCylinderMutationException("Insufficient filled cylinders for item: $itemId");
            }
            $after['filledCylinders'] -= $cylinderQty;
            $after['withCustomers'] += $cylinderQty;
            $after['qtyInStock'] = $before['qtyInStock'];
            if ($customerName === '') {
                throw new ReplayCylinderMutationException('Cylinder sale requires customerName or customerId.');
            }
            $holdingResult = applyReplayCylinderCustomerHolding($pdo, (int) $before['id'], (string) $before['title'], $customerName, $cylinderQty, false);
        } elseif ($stockRule['transactionType'] === 'Customer Return') {
            if ($after['withCustomers'] + 0.000001 < $cylinderQty) {
                throw new ReplayCylinderMutationException("Insufficient with-customer cylinders for item: $itemId");
            }
            $after['withCustomers'] -= $cylinderQty;
            $after['emptyCylinders'] += $cylinderQty;
            $after['qtyInStock'] = $before['qtyInStock'];
            if ($customerName === '') {
                throw new ReplayCylinderMutationException('Cylinder customer return requires customerName or customerId.');
            }
            $holdingResult = applyReplayCylinderCustomerHolding($pdo, (int) $before['id'], (string) $before['title'], $customerName, -$cylinderQty, true);
        } elseif ($stockRule['transactionType'] === 'Purchase') {
            $after['filledCylinders'] += $cylinderQty;
            $after['qtyInStock'] += $cylinderQty;
        } elseif ($stockRule['transactionType'] === 'Supplier Return') {
            if ($after['filledCylinders'] + 0.000001 < $cylinderQty) {
                throw new ReplayCylinderMutationException("Insufficient filled cylinders for supplier return item: $itemId");
            }
            if ($after['qtyInStock'] + 0.000001 < $cylinderQty) {
                throw new ReplayCylinderMutationException("Insufficient cylinder stock for supplier return item: $itemId");
            }
            $after['filledCylinders'] -= $cylinderQty;
            $after['qtyInStock'] -= $cylinderQty;
        } else {
            continue;
        }

        validateReplayCylinderNonNegative($after);
        validateReplayCylinderInvariant($after, 'after');
        updateReplayCylinderRow($pdo, $after);

        $applied[] = [
            'cylinderId' => (int) $before['id'],
            'itemId' => $itemId,
            'transactionType' => $stockRule['transactionType'],
            'qty' => $cylinderQty,
            'before' => replayCylinderPublicSnapshot($before),
            'after' => replayCylinderPublicSnapshot($after),
        ];
        if ($holdingResult !== null) {
            $holdings[] = $holdingResult;
        }
    }

    return ['appliedCount' => count($applied) + count($holdings), 'applied' => $applied, 'holdings' => $holdings];
}

function fetchReplayCylinderItemRow(PDO $pdo, int $itemId): ?array
{
    $statement = $pdo->prepare('SELECT `id`, `name`, `category`, `ConvQty`, `is_deleted` FROM `items` WHERE `id` = :id AND `is_deleted` = 0 LIMIT 1');
    $statement->execute(['id' => $itemId]);
    $row = $statement->fetch();
    return $row ?: null;
}

function fetchReplayCylinderRowForUpdate(PDO $pdo, int $itemId): ?array
{
    $statement = $pdo->prepare(
        'SELECT `id`, `itemId`, `title`, `qtyInStock`, `filledCylinders`, `emptyCylinders`, `withCustomers`, `convQty`, `isDeleted`, `deletedAt`
         FROM `cylinders`
         WHERE `itemId` = :itemId AND `isDeleted` = 0
         LIMIT 1
         FOR UPDATE'
    );
    $statement->execute(['itemId' => $itemId]);
    $row = $statement->fetch();
    return $row ?: null;
}

function isReplayCylinderItemRow(array $itemRow): bool
{
    $category = strtolower((string) ($itemRow['category'] ?? ''));
    $name = strtolower((string) ($itemRow['name'] ?? ''));
    return str_contains($category, 'gas') || str_contains($category, 'cylinder');
}

function normalizeReplayCylinderConvQty(array $itemPayload, array $itemRow, array $cylinderRow): float
{
    $value = $itemPayload['convQty'] ?? $itemPayload['ConvQty'] ?? $itemRow['ConvQty'] ?? $cylinderRow['convQty'] ?? 1;
    if ($value === null || $value === '' || !is_numeric($value)) {
        return 1.0;
    }
    $number = (float) $value;
    return is_finite($number) && $number > 0 ? $number : 1.0;
}

function normalizeReplayCylinderRow(array $row): array
{
    foreach (['qtyInStock', 'filledCylinders', 'emptyCylinders', 'withCustomers'] as $field) {
        if (!isset($row[$field]) || !is_numeric($row[$field])) {
            throw new ReplayCylinderMutationException("Cylinder field $field must be numeric.");
        }
    }

    return [
        'id' => (int) $row['id'],
        'itemId' => (int) $row['itemId'],
        'title' => (string) ($row['title'] ?? ''),
        'qtyInStock' => (float) $row['qtyInStock'],
        'filledCylinders' => (float) $row['filledCylinders'],
        'emptyCylinders' => (float) $row['emptyCylinders'],
        'withCustomers' => (float) $row['withCustomers'],
    ];
}

function validateReplayCylinderNonNegative(array $row): void
{
    foreach (['qtyInStock', 'filledCylinders', 'emptyCylinders', 'withCustomers'] as $field) {
        if ((float) $row[$field] < -0.000001) {
            throw new ReplayCylinderMutationException("Cylinder field $field cannot become negative.");
        }
    }
}

function validateReplayCylinderInvariant(array $row, string $phase): void
{
    validateReplayCylinderNonNegative($row);
    $sum = (float) $row['filledCylinders'] + (float) $row['emptyCylinders'] + (float) $row['withCustomers'];
    if (abs((float) $row['qtyInStock'] - $sum) > 0.000001) {
        throw new ReplayCylinderMutationException("Cylinder invariant failed $phase mutation.");
    }
}

function updateReplayCylinderRow(PDO $pdo, array $row): void
{
    $statement = $pdo->prepare(
        'UPDATE `cylinders`
         SET `qtyInStock` = :qtyInStock,
             `filledCylinders` = :filledCylinders,
             `emptyCylinders` = :emptyCylinders,
             `withCustomers` = :withCustomers
         WHERE `id` = :id'
    );
    $statement->execute([
        'qtyInStock' => $row['qtyInStock'],
        'filledCylinders' => $row['filledCylinders'],
        'emptyCylinders' => $row['emptyCylinders'],
        'withCustomers' => $row['withCustomers'],
        'id' => $row['id'],
    ]);
    if ($statement->rowCount() !== 1) {
        throw new ReplayCylinderMutationException('Cylinder inventory update failed.');
    }
}

function normalizeReplayCylinderCustomerName(PDO $pdo, array $header, array $transactionPayload): string
{
    $name = trim((string) ($header['customerName'] ?? $transactionPayload['customerName'] ?? ''));
    if ($name !== '') {
        return $name;
    }

    $customerId = normalizeOptionalReplayReferenceId($header['customerId'] ?? $transactionPayload['customerId'] ?? null, 'cylinder customerId');
    if ($customerId === null) {
        return '';
    }

    $statement = $pdo->prepare('SELECT `name` FROM `customers` WHERE `id` = :id AND `is_deleted` = 0 LIMIT 1');
    $statement->execute(['id' => $customerId]);
    return trim((string) (($statement->fetch()['name'] ?? '') ?: ''));
}

function applyReplayCylinderCustomerHolding(PDO $pdo, int $cylinderId, string $cylinderType, string $customerName, float $qtyChange, bool $requireExisting): array
{
    if (!replayTableExists($pdo, 'cylinder_customers')) {
        throw new ReplayCylinderMutationException('Cylinder customer holding table cylinder_customers does not exist.');
    }

    $statement = $pdo->prepare(
        'SELECT `id`, `qtyHeld`
         FROM `cylinder_customers`
         WHERE `cylinderId` = :cylinderId AND `customerName` = :customerName AND `isDeleted` = 0
         LIMIT 1
         FOR UPDATE'
    );
    $statement->execute(['cylinderId' => $cylinderId, 'customerName' => $customerName]);
    $row = $statement->fetch();

    if (!$row) {
        if ($requireExisting || $qtyChange < 0) {
            throw new ReplayCylinderMutationException('Customer does not hold enough cylinders for return.');
        }
        $insert = $pdo->prepare(
            'INSERT INTO `cylinder_customers` (`cylinderId`, `cylinderType`, `customerName`, `qtyHeld`, `isDeleted`, `deletedAt`)
             VALUES (:cylinderId, :cylinderType, :customerName, :qtyHeld, 0, NULL)'
        );
        $insert->execute(['cylinderId' => $cylinderId, 'cylinderType' => $cylinderType, 'customerName' => $customerName, 'qtyHeld' => $qtyChange]);
        $id = (int) $pdo->lastInsertId();
        return ['holdingId' => $id, 'cylinderId' => $cylinderId, 'customerName' => $customerName, 'before' => 0, 'after' => $qtyChange];
    }

    $before = (float) ($row['qtyHeld'] ?? 0);
    $after = $before + $qtyChange;
    if ($after < -0.000001) {
        throw new ReplayCylinderMutationException('Customer does not hold enough cylinders for return.');
    }
    $after = max(0.0, $after);

    $update = $pdo->prepare('UPDATE `cylinder_customers` SET `qtyHeld` = :qtyHeld WHERE `id` = :id');
    $update->execute(['qtyHeld' => $after, 'id' => (int) $row['id']]);
    if ($update->rowCount() !== 1) {
        throw new ReplayCylinderMutationException('Cylinder customer holding update failed.');
    }

    return ['holdingId' => (int) $row['id'], 'cylinderId' => $cylinderId, 'customerName' => $customerName, 'before' => $before, 'after' => $after];
}

function replayCylinderPublicSnapshot(array $row): array
{
    return [
        'qtyInStock' => (float) $row['qtyInStock'],
        'filledCylinders' => (float) $row['filledCylinders'],
        'emptyCylinders' => (float) $row['emptyCylinders'],
        'withCustomers' => (float) $row['withCustomers'],
    ];
}
function validateReplayInventorySufficiency(PDO $pdo, array $storedPayload): void
{
    if (!isReplayInventoryDeductionTransaction($storedPayload)) {
        return;
    }

    $transactionPayload = $storedPayload['payload'];
    $items = $transactionPayload['saleItems'] ?? $transactionPayload['items'] ?? null;

    if ($items === null) {
        throw new ReplayInventoryValidationException('Deduction transaction must include item rows for inventory validation.');
    }

    if (!is_array($items) || !array_is_list($items)) {
        throw new ReplayInventoryValidationException('Deduction transaction items must be provided as an array.');
    }

    $requiredQuantities = collectReplayInventoryRequirements($items);
    if ($requiredQuantities === []) {
        throw new ReplayInventoryValidationException('Deduction transaction must include at least one item quantity.');
    }

    $stockRows = fetchReplayInventoryStockRows($pdo, array_keys($requiredQuantities));
    validateReplayInventoryStockRows($requiredQuantities, $stockRows);
}

function isReplayInventoryDeductionTransaction(array $storedPayload): bool
{
    $transactionType = strtolower(trim((string) ($storedPayload['transactionType'] ?? '')));
    $transactionPayload = is_array($storedPayload['payload'] ?? null) ? $storedPayload['payload'] : [];
    $returnMode = strtolower(trim((string) ($transactionPayload['returnMode'] ?? '')));
    $sale = is_array($transactionPayload['sale'] ?? null) ? $transactionPayload['sale'] : [];
    $saleTransactionType = strtolower(trim((string) ($sale['transactionType'] ?? $transactionPayload['transactionType'] ?? '')));

    if ($transactionType === 'sale') {
        if (str_contains($saleTransactionType, 'purchase')) {
            return false;
        }

        if (str_contains($saleTransactionType, 'customer return')) {
            return false;
        }

        return true;
    }

    if ($transactionType === 'return') {
        if ($returnMode === 'supplier' || str_contains($saleTransactionType, 'supplier return')) {
            return true;
        }

        return false;
    }

    return false;
}

function collectReplayInventoryRequirements(array $items): array
{
    $requiredQuantities = [];

    foreach ($items as $index => $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new ReplayInventoryValidationException("Inventory item at index $index must be an object.");
        }

        $rawId = $item['originalItemId'] ?? $item['itemId'] ?? null;
        if ($rawId === null || $rawId === '') {
            throw new ReplayInventoryValidationException("Inventory item at index $index must include originalItemId or itemId.");
        }

        $itemId = normalizeRequiredReplayReferenceId($rawId, "inventory item at index $index");
        $quantity = normalizeReplayPositiveQuantity($item['qty'] ?? $item['quantity'] ?? null, "inventory quantity at index $index");

        $requiredQuantities[$itemId] = ($requiredQuantities[$itemId] ?? 0.0) + $quantity;
    }

    return $requiredQuantities;
}

function normalizeReplayPositiveQuantity($value, string $field): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new ReplayInventoryValidationException("Required $field must be numeric.");
    }

    $quantity = (float) $value;
    if (!is_finite($quantity) || $quantity <= 0) {
        throw new ReplayInventoryValidationException("Required $field must be greater than zero.");
    }

    return $quantity;
}

function fetchReplayInventoryStockRows(PDO $pdo, array $itemIds): array
{
    $ids = array_values(array_unique(array_map('intval', $itemIds)));
    if ($ids === []) {
        return [];
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        "SELECT `id`, `availableStock` FROM `items` WHERE `id` IN ($placeholders) AND `is_deleted` = 0"
    );
    $statement->execute($ids);

    $rows = [];
    foreach ($statement->fetchAll() as $row) {
        $rows[(int) $row['id']] = $row;
    }

    return $rows;
}

function validateReplayInventoryStockRows(array $requiredQuantities, array $stockRows): void
{
    foreach ($requiredQuantities as $itemId => $requiredQuantity) {
        if (!isset($stockRows[$itemId])) {
            throw new ReplayInventoryValidationException("Inventory item does not exist for stock validation: $itemId");
        }

        $stockValue = $stockRows[$itemId]['availableStock'] ?? null;
        if ($stockValue === null || $stockValue === '' || !is_numeric($stockValue)) {
            throw new ReplayInventoryValidationException("Inventory stock is missing or non-numeric for item: $itemId");
        }

        $availableStock = (float) $stockValue;
        if (!is_finite($availableStock)) {
            throw new ReplayInventoryValidationException("Inventory stock is non-numeric for item: $itemId");
        }

        if ($availableStock + 0.000001 < (float) $requiredQuantity) {
            throw new ReplayInventoryValidationException("Insufficient stock for item: $itemId");
        }
    }
}

function collectReplayReferenceIds($value, array $keys): array
{
    $ids = [];

    if (!is_array($value)) {
        return $ids;
    }

    foreach ($value as $key => $childValue) {
        if (is_string($key) && in_array($key, $keys, true)) {
            $normalized = normalizeOptionalReplayReferenceId($childValue, $key);
            if ($normalized !== null) {
                $ids[] = $normalized;
            }
            continue;
        }

        if (is_array($childValue)) {
            $ids = array_merge($ids, collectReplayReferenceIds($childValue, $keys));
        }
    }

    return array_values(array_unique($ids));
}

function collectReplayItemReferenceIds(array $transactionPayload): array
{
    $items = $transactionPayload['saleItems'] ?? $transactionPayload['items'] ?? null;

    if ($items === null) {
        return [];
    }

    if (!is_array($items) || !array_is_list($items)) {
        throw new ReplayBusinessValidationException('Transaction item references must be provided as an array.');
    }

    $ids = [];
    foreach ($items as $index => $item) {
        if (!is_array($item) || array_is_list($item)) {
            throw new ReplayBusinessValidationException("Transaction item reference at index $index must be an object.");
        }

        $rawId = $item['originalItemId'] ?? $item['itemId'] ?? null;
        if ($rawId === null || $rawId === '') {
            throw new ReplayBusinessValidationException("Transaction item reference at index $index must include originalItemId or itemId.");
        }

        $ids[] = normalizeRequiredReplayReferenceId($rawId, "item reference at index $index");
    }

    return array_values(array_unique($ids));
}

function normalizeOptionalReplayReferenceId($value, string $field): ?int
{
    if ($value === null || $value === '') {
        return null;
    }

    return normalizeRequiredReplayReferenceId($value, $field);
}

function normalizeRequiredReplayReferenceId($value, string $field): int
{
    if (!is_numeric($value)) {
        throw new ReplayBusinessValidationException("Referenced $field must be numeric.");
    }

    $id = (int) $value;
    if ($id <= 0 || (string) $id !== (string) (int) $value) {
        throw new ReplayBusinessValidationException("Referenced $field must be a positive integer.");
    }

    return $id;
}

function validateReplayExistingActiveIds(PDO $pdo, string $table, array $ids, string $label): void
{
    $ids = array_values(array_unique(array_map('intval', $ids)));
    if ($ids === []) {
        return;
    }

    $allowedTables = ['customers', 'suppliers', 'items'];
    if (!in_array($table, $allowedTables, true)) {
        throw new RuntimeException('Unsupported replay reference table.');
    }

    $placeholders = implode(',', array_fill(0, count($ids), '?'));
    $statement = $pdo->prepare(
        "SELECT `id` FROM `$table` WHERE `id` IN ($placeholders) AND `is_deleted` = 0"
    );
    $statement->execute($ids);
    $found = array_map('intval', $statement->fetchAll(PDO::FETCH_COLUMN));
    $missing = array_values(array_diff($ids, $found));

    if ($missing !== []) {
        throw new ReplayBusinessValidationException('Referenced ' . $label . ' does not exist: ' . implode(',', $missing));
    }
}

function getReplayProcessorTransactionRow(PDO $pdo, int $syncTransactionId): ?array
{
    $statement = $pdo->prepare(
        'SELECT `id`, `client_transaction_id`, `transaction_type`, `payload_json`, `status`, `replay_status`, `replay_attempts`, `locked_at`, `locked_by`
         FROM `sync_transactions`
         WHERE `id` = :id
         LIMIT 1'
    );
    $statement->execute(['id' => $syncTransactionId]);
    $row = $statement->fetch();

    return $row ?: null;
}

function getReplayProcessorTransactionRowForUpdate(PDO $pdo, int $syncTransactionId): ?array
{
    $statement = $pdo->prepare(
        'SELECT `id`, `client_transaction_id`, `transaction_type`, `payload_json`, `status`, `replay_status`, `replay_attempts`, `locked_at`, `locked_by`
         FROM `sync_transactions`
         WHERE `id` = :id
         LIMIT 1
         FOR UPDATE'
    );
    $statement->execute(['id' => $syncTransactionId]);
    $row = $statement->fetch();

    return $row ?: null;
}








