<?php

declare(strict_types=1);

function hash_request_payload(array $payload): string
{
    return hash('sha256', canonical_json_encode($payload));
}

function get_idempotency_record(PDO $pdo, string $clientTransactionId): ?array
{
    $statement = $pdo->prepare(
        'SELECT * FROM `transaction_idempotency`
         WHERE `client_transaction_id` = :client_transaction_id
         LIMIT 1'
    );
    $statement->execute([
        'client_transaction_id' => $clientTransactionId,
    ]);
    $row = $statement->fetch();

    return $row ?: null;
}

function create_idempotency_record(
    PDO $pdo,
    string $clientTransactionId,
    string $transactionType,
    string $requestHash,
    string $status = 'processing'
): void {
    $statement = $pdo->prepare(
        'INSERT INTO `transaction_idempotency`
            (`client_transaction_id`, `transaction_type`, `status`, `request_hash`)
         VALUES
            (:client_transaction_id, :transaction_type, :status, :request_hash)'
    );
    $statement->execute([
        'client_transaction_id' => $clientTransactionId,
        'transaction_type' => $transactionType,
        'status' => $status,
        'request_hash' => $requestHash,
    ]);
}

function update_idempotency_completed(
    PDO $pdo,
    string $clientTransactionId,
    array $response,
    ?string $errorMessage = null
): void {
    $responseJson = json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if ($responseJson === false) {
        throw new RuntimeException('Failed to encode idempotency response.');
    }

    $statement = $pdo->prepare(
        'UPDATE `transaction_idempotency`
         SET `status` = :status,
             `response_json` = :response_json,
             `error_message` = :error_message
         WHERE `client_transaction_id` = :client_transaction_id'
    );
    $statement->execute([
        'status' => 'completed',
        'response_json' => $responseJson,
        'error_message' => $errorMessage,
        'client_transaction_id' => $clientTransactionId,
    ]);
}

function idempotent_response_or_conflict(?array $record, string $requestHash): ?array
{
    if ($record === null) {
        return null;
    }

    if (($record['request_hash'] ?? '') !== $requestHash) {
        error_response('Duplicate clientTransactionId with different payload.', 409);
    }

    if (($record['status'] ?? '') === 'completed' && !empty($record['response_json'])) {
        $response = json_decode((string) $record['response_json'], true);

        if (is_array($response)) {
            return $response;
        }
    }

    error_response('Transaction is already being processed.', 409);
}

function canonical_json_encode(array $payload): string
{
    $normalized = canonicalize_payload($payload);
    $json = json_encode($normalized, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if ($json === false) {
        throw new RuntimeException('Failed to encode request payload.');
    }

    return $json;
}

function canonicalize_payload($value)
{
    if (!is_array($value)) {
        return $value;
    }

    if (is_list_array($value)) {
        return array_map('canonicalize_payload', $value);
    }

    ksort($value);

    foreach ($value as $key => $childValue) {
        $value[$key] = canonicalize_payload($childValue);
    }

    return $value;
}

function is_list_array(array $value): bool
{
    if ($value === []) {
        return true;
    }

    return array_keys($value) === range(0, count($value) - 1);
}
