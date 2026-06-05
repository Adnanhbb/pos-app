<?php

declare(strict_types=1);

class ManualItemOpeningStockMappingException extends RuntimeException
{
}

function mapManualItemOpeningStock(PDO $pdo, array $payload): array
{
    $mappingVersion = (int) ($payload['mappingVersion'] ?? 0);
    $localItemId = manualMappingPositiveInt($payload['localItemId'] ?? null, 'localItemId');
    $item = manualMappingObject($payload['item'] ?? null, 'item');
    $batch = manualMappingObject($payload['openingBatch'] ?? null, 'openingBatch');
    $localBatchId = manualMappingPositiveInt($batch['localBatchId'] ?? null, 'openingBatch.localBatchId');
    $mappingKey = "opening-stock-map-v1:item:$localItemId:batch:$localBatchId";

    if ($mappingVersion !== 1) {
        throw new ManualItemOpeningStockMappingException('Only mappingVersion 1 is supported.');
    }
    if ((int) ($batch['sourceSaleId'] ?? -1) !== 0 || trim((string) ($batch['invoiceNo'] ?? '')) !== 'Opening Stock') {
        throw new ManualItemOpeningStockMappingException('Only explicit Opening Stock batches may be mapped.');
    }

    $qtyPurchased = manualMappingPositiveNumber($batch['qtyPurchased'] ?? null, 'openingBatch.qtyPurchased');
    $qtySold = manualMappingNonNegativeNumber($batch['qtySold'] ?? null, 'openingBatch.qtySold');
    $balance = manualMappingNonNegativeNumber($batch['balance'] ?? null, 'openingBatch.balance');
    $backendOpeningQuantity = manualMappingPositiveNumber(
        $batch['backendOpeningQuantity'] ?? null,
        'openingBatch.backendOpeningQuantity'
    );
    $archivedConsumptionExcluded = manualMappingNonNegativeNumber(
        $batch['archivedConsumptionExcluded'] ?? null,
        'openingBatch.archivedConsumptionExcluded'
    );
    if (abs($qtyPurchased - ($qtySold + $balance)) > 0.000001) {
        throw new ManualItemOpeningStockMappingException('Opening Stock quantity history is inconsistent.');
    }
    if (
        $archivedConsumptionExcluded > $qtySold + 0.000001 ||
        abs($backendOpeningQuantity - ($qtyPurchased - $archivedConsumptionExcluded)) > 0.000001
    ) {
        throw new ManualItemOpeningStockMappingException(
            'Backend Opening Stock recovery baseline is inconsistent.'
        );
    }

    $name = trim((string) ($item['name'] ?? ''));
    if ($name === '') {
        throw new ManualItemOpeningStockMappingException('Item name is required.');
    }
    $category = trim((string) ($item['category'] ?? ''));
    if (stripos($category, 'gas') !== false || stripos($category, 'cylinder') !== false) {
        throw new ManualItemOpeningStockMappingException(
            'Cylinder item mapping requires a separate cylinder-aware contract.'
        );
    }

    $started = false;
    try {
        $pdo->beginTransaction();
        $started = true;

        $existingItemStatement = $pdo->prepare(
            'SELECT `id`, `name`, `availableStock`
             FROM `items`
             WHERE `client_id` = :client_id
             LIMIT 1
             FOR UPDATE'
        );
        $existingItemStatement->execute(['client_id' => (string) $localItemId]);
        $existingItem = $existingItemStatement->fetch();

        if ($existingItem) {
            $serverItemId = (int) $existingItem['id'];
            if (trim((string) $existingItem['name']) !== $name) {
                throw new ManualItemOpeningStockMappingException('Existing backend item client_id belongs to a different item profile.');
            }
        } else {
            $insertItem = $pdo->prepare(
                'INSERT INTO `items`
                    (`client_id`, `name`, `barcode`, `description`, `purchasePrice`, `retailPrice`, `discountPrice`, `wholesalePrice`, `availableStock`, `category`, `brand`, `minunit`, `maxunit`, `ConvQty`, `is_deleted`, `deleted_at`)
                 VALUES
                    (:client_id, :name, :barcode, :description, :purchasePrice, :retailPrice, :discountPrice, :wholesalePrice, :availableStock, :category, :brand, :minunit, :maxunit, :ConvQty, 0, NULL)'
            );
            $insertItem->execute([
                'client_id' => (string) $localItemId,
                'name' => $name,
                'barcode' => manualMappingOptionalString($item['barcode'] ?? null),
                'description' => manualMappingOptionalString($item['description'] ?? null),
                'purchasePrice' => manualMappingNonNegativeNumber($item['purchasePrice'] ?? 0, 'item.purchasePrice'),
                'retailPrice' => manualMappingNonNegativeNumber($item['retailPrice'] ?? 0, 'item.retailPrice'),
                'discountPrice' => manualMappingNonNegativeNumber($item['discountPrice'] ?? 0, 'item.discountPrice'),
                'wholesalePrice' => manualMappingNonNegativeNumber($item['wholesalePrice'] ?? 0, 'item.wholesalePrice'),
                'availableStock' => $backendOpeningQuantity,
                'category' => manualMappingOptionalString($category),
                'brand' => manualMappingOptionalString($item['brand'] ?? null),
                'minunit' => manualMappingOptionalString($item['minunit'] ?? null),
                'maxunit' => manualMappingOptionalString($item['maxunit'] ?? null),
                'ConvQty' => manualMappingPositiveNumber($item['ConvQty'] ?? 1, 'item.ConvQty'),
            ]);
            $serverItemId = (int) $pdo->lastInsertId();
        }

        $existingBatchStatement = $pdo->prepare(
            'SELECT `id`, `itemId`, `qtyPurchased`, `qtySold`, `balance`
             FROM `item_batches`
             WHERE `client_transaction_id` = :mapping_key
             LIMIT 1
             FOR UPDATE'
        );
        $existingBatchStatement->execute(['mapping_key' => $mappingKey]);
        $existingBatch = $existingBatchStatement->fetch();

        if ($existingBatch) {
            $serverBatchId = (int) $existingBatch['id'];
            if (
                (int) $existingBatch['itemId'] !== $serverItemId ||
                abs((float) $existingBatch['qtyPurchased'] - $backendOpeningQuantity) > 0.000001 ||
                abs((float) $existingBatch['qtySold']) > 0.000001 ||
                abs((float) $existingBatch['balance'] - $backendOpeningQuantity) > 0.000001
            ) {
                throw new ManualItemOpeningStockMappingException('Existing backend Opening Stock mapping does not match the requested baseline.');
            }
            $alreadyMapped = true;
        } else {
            if ($existingItem) {
                $existingStock = (float) ($existingItem['availableStock'] ?? 0);
                if (abs($existingStock) <= 0.000001) {
                    $stockUpdate = $pdo->prepare(
                        'UPDATE `items` SET `availableStock` = :availableStock WHERE `id` = :id'
                    );
                    $stockUpdate->execute([
                        'availableStock' => $backendOpeningQuantity,
                        'id' => $serverItemId,
                    ]);
                } elseif (abs($existingStock - $backendOpeningQuantity) > 0.000001) {
                    throw new ManualItemOpeningStockMappingException(
                        'Existing backend item stock is not an empty or matching Opening Stock baseline.'
                    );
                }
            }

            $insertBatch = $pdo->prepare(
                'INSERT INTO `item_batches`
                    (`itemId`, `purchaseDate`, `qtyPurchased`, `qtySold`, `balance`, `costPrice`, `sourceSaleId`, `invoiceNo`, `sync_transaction_id`, `client_transaction_id`, `batch_json`, `isDeleted`, `deletedAt`)
                 VALUES
                    (:itemId, :purchaseDate, :qtyPurchased, 0, :balance, :costPrice, 0, :invoiceNo, NULL, :mapping_key, :batch_json, 0, NULL)'
            );
            $insertBatch->execute([
                'itemId' => $serverItemId,
                'purchaseDate' => trim((string) ($batch['purchaseDate'] ?? '')),
                'qtyPurchased' => $backendOpeningQuantity,
                'balance' => $backendOpeningQuantity,
                'costPrice' => manualMappingNonNegativeNumber($batch['costPrice'] ?? 0, 'openingBatch.costPrice'),
                'invoiceNo' => 'Opening Stock',
                'mapping_key' => $mappingKey,
                'batch_json' => json_encode([
                    'mappingVersion' => 1,
                    'localItemId' => $localItemId,
                    'localBatchId' => $localBatchId,
                    'localQtySoldAtMapping' => $qtySold,
                    'localBalanceAtMapping' => $balance,
                    'backendOpeningQuantity' => $backendOpeningQuantity,
                    'archivedConsumptionExcluded' => $archivedConsumptionExcluded,
                ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]);
            $serverBatchId = (int) $pdo->lastInsertId();
            $alreadyMapped = false;
        }

        if ($serverItemId <= 0 || $serverBatchId <= 0) {
            throw new ManualItemOpeningStockMappingException('Backend mapping did not return valid identifiers.');
        }

        $pdo->commit();
        $started = false;

        return [
            'mappingVersion' => 1,
            'localItemId' => $localItemId,
            'serverItemId' => $serverItemId,
            'localBatchId' => $localBatchId,
            'serverBatchId' => $serverBatchId,
            'alreadyMapped' => $alreadyMapped,
            'backendOpeningQuantity' => $backendOpeningQuantity,
        ];
    } catch (Throwable $exception) {
        if ($started && $pdo->inTransaction()) {
            $pdo->rollBack();
        }
        throw $exception;
    }
}

function manualMappingObject($value, string $field): array
{
    if (!is_array($value) || array_is_list($value)) {
        throw new ManualItemOpeningStockMappingException("$field must be an object.");
    }
    return $value;
}

function manualMappingPositiveInt($value, string $field): int
{
    if (!is_numeric($value) || (int) $value <= 0) {
        throw new ManualItemOpeningStockMappingException("$field must be a positive integer.");
    }
    return (int) $value;
}

function manualMappingPositiveNumber($value, string $field): float
{
    $number = manualMappingNonNegativeNumber($value, $field);
    if ($number <= 0) {
        throw new ManualItemOpeningStockMappingException("$field must be greater than zero.");
    }
    return $number;
}

function manualMappingNonNegativeNumber($value, string $field): float
{
    if (!is_numeric($value) || !is_finite((float) $value) || (float) $value < 0) {
        throw new ManualItemOpeningStockMappingException("$field must be a non-negative number.");
    }
    return (float) $value;
}

function manualMappingOptionalString($value): ?string
{
    if ($value === null) {
        return null;
    }
    $text = trim((string) $value);
    return $text === '' ? null : $text;
}
