<?php

declare(strict_types=1);

class MappedOpeningStockAdjustmentException extends RuntimeException
{
}

function adjustMappedOpeningStock(PDO $pdo, array $payload): array
{
    if ((int) ($payload['adjustmentVersion'] ?? 0) !== 1) {
        throw new MappedOpeningStockAdjustmentException('Only adjustmentVersion 1 is supported.');
    }

    $localItemId = mappedOpeningStockPositiveInt($payload['localItemId'] ?? null, 'localItemId');
    $serverItemId = mappedOpeningStockPositiveInt($payload['serverItemId'] ?? null, 'serverItemId');
    $localBatchId = mappedOpeningStockPositiveInt($payload['localBatchId'] ?? null, 'localBatchId');
    $serverBatchId = mappedOpeningStockPositiveInt($payload['serverBatchId'] ?? null, 'serverBatchId');
    $expected = mappedOpeningStockObject($payload['expected'] ?? null, 'expected');
    $expectedItemStock = mappedOpeningStockNonNegativeNumber(
        $expected['itemAvailableStock'] ?? null,
        'expected.itemAvailableStock'
    );
    $expectedPurchased = mappedOpeningStockNonNegativeNumber(
        $expected['qtyPurchased'] ?? null,
        'expected.qtyPurchased'
    );
    $expectedSold = mappedOpeningStockNonNegativeNumber(
        $expected['qtySold'] ?? null,
        'expected.qtySold'
    );
    $expectedBalance = mappedOpeningStockNonNegativeNumber(
        $expected['balance'] ?? null,
        'expected.balance'
    );
    $requestedOpeningStock = mappedOpeningStockNonNegativeNumber(
        $payload['requestedOpeningStock'] ?? null,
        'requestedOpeningStock'
    );

    if (
        abs($expectedPurchased - ($expectedSold + $expectedBalance)) > 0.000001 ||
        $requestedOpeningStock + 0.000001 < $expectedSold
    ) {
        throw new MappedOpeningStockAdjustmentException(
            'Opening Stock quantity history is inconsistent.'
        );
    }

    $started = false;
    try {
        $pdo->beginTransaction();
        $started = true;

        $itemStatement = $pdo->prepare(
            'SELECT `id`, `client_id`, `availableStock`, `category`, `is_deleted`
             FROM `items`
             WHERE `id` = :id
             LIMIT 1
             FOR UPDATE'
        );
        $itemStatement->execute(['id' => $serverItemId]);
        $item = $itemStatement->fetch();

        $batchStatement = $pdo->prepare(
            'SELECT `id`, `itemId`, `qtyPurchased`, `qtySold`, `balance`,
                    `sourceSaleId`, `invoiceNo`, `isDeleted`
             FROM `item_batches`
             WHERE `id` = :id
             LIMIT 1
             FOR UPDATE'
        );
        $batchStatement->execute(['id' => $serverBatchId]);
        $batch = $batchStatement->fetch();

        if (!$item || !$batch) {
            throw new MappedOpeningStockAdjustmentException(
                'Mapped item or Opening Stock batch was not found.'
            );
        }
        if (
            (string) ($item['client_id'] ?? '') !== (string) $localItemId ||
            (int) $batch['itemId'] !== $serverItemId ||
            (int) ($item['is_deleted'] ?? 0) !== 0 ||
            (int) ($batch['isDeleted'] ?? 0) !== 0 ||
            (int) ($batch['sourceSaleId'] ?? -1) !== 0 ||
            trim((string) ($batch['invoiceNo'] ?? '')) !== 'Opening Stock'
        ) {
            throw new MappedOpeningStockAdjustmentException(
                'Mapped Opening Stock ownership or identity is inconsistent.'
            );
        }

        $category = strtolower(trim((string) ($item['category'] ?? '')));
        if (str_contains($category, 'gas') || str_contains($category, 'cylinder')) {
            throw new MappedOpeningStockAdjustmentException(
                'Cylinder Opening Stock requires the cylinder workflow.'
            );
        }

        $currentItemStock = (float) $item['availableStock'];
        $currentPurchased = (float) $batch['qtyPurchased'];
        $currentSold = (float) $batch['qtySold'];
        $currentBalance = (float) $batch['balance'];
        if (
            abs($currentItemStock - $expectedItemStock) > 0.000001 ||
            abs($currentPurchased - $expectedPurchased) > 0.000001 ||
            abs($currentSold - $expectedSold) > 0.000001 ||
            abs($currentBalance - $expectedBalance) > 0.000001
        ) {
            throw new MappedOpeningStockAdjustmentException(
                'Backend inventory changed since the item edit was opened.'
            );
        }

        $newBalance = $requestedOpeningStock - $currentSold;
        $newAvailableStock = $currentItemStock + ($newBalance - $currentBalance);
        if ($newBalance < -0.000001 || $newAvailableStock < -0.000001) {
            throw new MappedOpeningStockAdjustmentException(
                'Opening Stock adjustment would create a negative balance.'
            );
        }

        $updateBatch = $pdo->prepare(
            'UPDATE `item_batches`
             SET `qtyPurchased` = :qtyPurchased, `balance` = :balance
             WHERE `id` = :id'
        );
        $updateBatch->execute([
            'qtyPurchased' => $requestedOpeningStock,
            'balance' => $newBalance,
            'id' => $serverBatchId,
        ]);

        $updateItem = $pdo->prepare(
            'UPDATE `items`
             SET `availableStock` = :availableStock
             WHERE `id` = :id'
        );
        $updateItem->execute([
            'availableStock' => $newAvailableStock,
            'id' => $serverItemId,
        ]);

        $pdo->commit();
        $started = false;

        return [
            'adjustmentContract' => 'mappedOpeningStockAdjustment',
            'adjustmentVersion' => 1,
            'localItemId' => $localItemId,
            'localBatchId' => $localBatchId,
            'serverItemId' => $serverItemId,
            'serverBatchId' => $serverBatchId,
            'availableStock' => $newAvailableStock,
            'qtyPurchased' => $requestedOpeningStock,
            'qtySold' => $currentSold,
            'balance' => $newBalance,
        ];
    } catch (Throwable $exception) {
        if ($started && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }
}

function mappedOpeningStockObject($value, string $field): array
{
    if (!is_array($value) || array_is_list($value)) {
        throw new MappedOpeningStockAdjustmentException("$field must be an object.");
    }
    return $value;
}

function mappedOpeningStockPositiveInt($value, string $field): int
{
    if (!is_numeric($value) || (int) $value <= 0) {
        throw new MappedOpeningStockAdjustmentException("$field must be a positive integer.");
    }
    return (int) $value;
}

function mappedOpeningStockNonNegativeNumber($value, string $field): float
{
    if (!is_numeric($value) || !is_finite((float) $value) || (float) $value < 0) {
        throw new MappedOpeningStockAdjustmentException("$field must be a non-negative number.");
    }
    return (float) $value;
}
