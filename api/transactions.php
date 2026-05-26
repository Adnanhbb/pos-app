<?php

declare(strict_types=1);

/*
 * Transaction sync skeleton.
 *
 * This endpoint currently validates, stores, and deduplicates offline POS
 * transaction payloads only. Full stock, accounting, payment, batch, and
 * cylinder mutation logic must be implemented later inside one MySQL
 * transaction before this is considered production-complete transaction sync.
 *
 * Later auth middleware should be required here before handling the request.
 */
require_once __DIR__ . '/config/cors.php';
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/validation.php';
require_once __DIR__ . '/lib/idempotency.php';

$method = get_request_method();

try {
    if ($method !== 'POST') {
        error_response('Method not allowed.', 405);
    }

    $payload = get_json_body();
    $errors = require_fields($payload, [
        'clientTransactionId',
        'transactionType',
        'createdAt',
        'payload',
    ]);

    if ($errors !== []) {
        error_response('Validation failed.', 422, $errors);
    }

    if (!is_array($payload['payload'])) {
        error_response('Validation failed.', 422, [
            'payload' => 'This field must be an object.',
        ]);
    }

    $clientTransactionId = trim((string) $payload['clientTransactionId']);
    $transactionType = trim((string) $payload['transactionType']);

    if ($clientTransactionId === '' || $transactionType === '') {
        error_response('Validation failed.', 422, [
            'clientTransactionId' => $clientTransactionId === '' ? 'This field cannot be empty.' : null,
            'transactionType' => $transactionType === '' ? 'This field cannot be empty.' : null,
        ]);
    }

    $allowedTransactionTypes = [
        'sale',
        'return',
        'invoice_delete',
        'payment',
        'stock_adjustment',
        'cylinder_adjustment',
    ];

    if (!in_array($transactionType, $allowedTransactionTypes, true)) {
        error_response('Validation failed.', 422, [
            'transactionType' => 'Unsupported transaction type.',
        ]);
    }

    if (!is_numeric($payload['createdAt'])) {
        error_response('Validation failed.', 422, [
            'createdAt' => 'This field must be numeric.',
        ]);
    }

    validate_storage_only_transaction_payload($transactionType, $payload['payload']);

    $pdo = get_pdo();
    $requestHash = hash_request_payload($payload);
    $existing = get_idempotency_record($pdo, $clientTransactionId);
    $idempotentResponse = idempotent_response_or_conflict($existing, $requestHash);

    if ($idempotentResponse !== null) {
        success_response($idempotentResponse);
    }

    $payloadJson = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if ($payloadJson === false) {
        throw new RuntimeException('Failed to encode transaction payload.');
    }

    $response = [
        'accepted' => true,
        'storedOnly' => true,
        'clientTransactionId' => $clientTransactionId,
        'transactionType' => $transactionType,
    ];

    $pdo->beginTransaction();

    try {
        create_idempotency_record(
            $pdo,
            $clientTransactionId,
            $transactionType,
            $requestHash,
            'processing'
        );

        $statement = $pdo->prepare(
            'INSERT INTO `sync_transactions`
                (`client_transaction_id`, `transaction_type`, `payload_json`, `status`, `replay_status`, `replay_attempts`)
             VALUES
                (:client_transaction_id, :transaction_type, :payload_json, :status, :replay_status, :replay_attempts)'
        );
        $statement->execute([
            'client_transaction_id' => $clientTransactionId,
            'transaction_type' => $transactionType,
            'payload_json' => $payloadJson,
            'status' => 'stored',
            'replay_status' => 'stored',
            'replay_attempts' => 0,
        ]);

        $syncTransactionId = (int) $pdo->lastInsertId();
        insert_transaction_replay_audit_event(
            $pdo,
            $syncTransactionId,
            $clientTransactionId,
            'stored',
            null,
            'stored',
            'Transaction payload stored for future replay. No replay was executed.'
        );

        update_idempotency_completed($pdo, $clientTransactionId, $response);
        $pdo->commit();
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }

    success_response($response, 201);
} catch (InvalidArgumentException $exception) {
    error_response($exception->getMessage(), 400);
} catch (PDOException $exception) {
    if ($exception->getCode() === '23000') {
        error_response('Duplicate clientTransactionId', 409);
    }

    error_response('Database error.', 500);
} catch (Throwable $exception) {
    error_response('Server error.', 500);
}
function validate_storage_only_transaction_payload(string $transactionType, array $transactionPayload): void
{
    if ($transactionType === 'sale') {
        validate_object_field($transactionPayload, 'sale');
        validate_items_array($transactionPayload);
        return;
    }

    if ($transactionType === 'return') {
        validate_object_field($transactionPayload, 'sale');
        validate_items_array($transactionPayload);

        $returnMode = $transactionPayload['returnMode'] ?? null;
        if (!in_array($returnMode, ['customer', 'supplier'], true)) {
            error_response('Validation failed.', 422, [
                'returnMode' => 'This field must be customer or supplier.',
            ]);
        }

        return;
    }

    if ($transactionType === 'invoice_delete') {
        validate_object_field($transactionPayload, 'invoice');
        validate_items_array($transactionPayload);
        return;
    }

    if ($transactionType === 'payment') {
        validate_object_field($transactionPayload, 'payment');

        $partyType = $transactionPayload['partyType'] ?? null;
        if (!in_array($partyType, ['customer', 'supplier'], true)) {
            error_response('Validation failed.', 422, [
                'partyType' => 'This field must be customer or supplier.',
            ]);
        }
    }
}

function validate_object_field(array $payload, string $field): void
{
    if (!isset($payload[$field]) || !is_array($payload[$field]) || array_is_list($payload[$field])) {
        error_response('Validation failed.', 422, [
            $field => 'This field must be an object.',
        ]);
    }
}

function validate_items_array(array $payload): void
{
    $items = $payload['saleItems'] ?? $payload['items'] ?? null;

    if (!is_array($items) || !array_is_list($items) || count($items) === 0) {
        error_response('Validation failed.', 422, [
            'saleItems' => 'This field must be a non-empty array.',
        ]);
    }

    foreach ($items as $index => $item) {
        if (!is_array($item)) {
            error_response('Validation failed.', 422, [
                "saleItems.$index" => 'Each item must be an object.',
            ]);
        }

        if (isset($item['qty']) && !is_numeric($item['qty'])) {
            error_response('Validation failed.', 422, [
                "saleItems.$index.qty" => 'Quantity must be numeric.',
            ]);
        }

        if (isset($item['price']) && !is_numeric($item['price'])) {
            error_response('Validation failed.', 422, [
                "saleItems.$index.price" => 'Price must be numeric.',
            ]);
        }
    }
}
function insert_transaction_replay_audit_event(
    PDO $pdo,
    int $syncTransactionId,
    string $clientTransactionId,
    string $eventType,
    ?string $statusBefore,
    ?string $statusAfter,
    string $message
): void {
    $statement = $pdo->prepare(
        'INSERT INTO `transaction_replay_audit`
            (`sync_transaction_id`, `client_transaction_id`, `event_type`, `status_before`, `status_after`, `message`)
         VALUES
            (:sync_transaction_id, :client_transaction_id, :event_type, :status_before, :status_after, :message)'
    );
    $statement->execute([
        'sync_transaction_id' => $syncTransactionId,
        'client_transaction_id' => $clientTransactionId,
        'event_type' => $eventType,
        'status_before' => $statusBefore,
        'status_after' => $statusAfter,
        'message' => $message,
    ]);
}