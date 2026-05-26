<?php

declare(strict_types=1);

/*
 * Settings endpoint.
 * Later auth middleware should be required here before handling the request.
 * Settings are stored as flexible JSON because the frontend shape can change.
 */
require_once __DIR__ . '/config/cors.php';
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/auth_audit.php';
require_once __DIR__ . '/lib/crud.php';

$method = get_request_method();
$id = get_query_id() ?? 'default';
$clientId = $id === '' ? 'default' : $id;

try {
        $pdo = get_pdo();
    initialize_optional_crud_auth_audit($pdo, 'settings.php', $method);

    if ($method === 'GET') {
        $row = get_settings_row($pdo, $clientId);

        if ($row === null && $clientId !== 'default') {
            error_response('Settings not found.', 404);
        }

        success_response($row === null ? null : normalize_settings_response($row));
    }

    if ($method === 'POST') {
        $body = get_json_body();
        $targetClientId = normalize_settings_client_id($body, $clientId);
        $row = create_settings_row($pdo, $targetClientId, $body);

        success_response(normalize_settings_response($row), 201);
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        $body = get_json_body();
        $targetClientId = normalize_settings_client_id($body, $clientId);
        $row = upsert_settings_row($pdo, $targetClientId, $body);

        success_response(normalize_settings_response($row));
    }

    error_response('Method not allowed.', 405);
} catch (PDOException $exception) {
    if (crud_is_duplicate_key_error($exception)) {
        error_response('Duplicate client_id', 409);
    }

    error_response('Database error.', 500);
} catch (Throwable $exception) {
    error_response('Server error.', 500);
}

function get_settings_row(PDO $pdo, string $clientId): ?array
{
    $statement = $pdo->prepare('SELECT * FROM `settings` WHERE `client_id` = :client_id LIMIT 1');
    $statement->execute(['client_id' => $clientId]);
    $row = $statement->fetch();

    return $row ?: null;
}

function create_settings_row(PDO $pdo, string $clientId, array $payload): array
{
    $json = encode_settings_payload($payload);
    $statement = $pdo->prepare(
        'INSERT INTO `settings` (`client_id`, `settings_json`) VALUES (:client_id, :settings_json)'
    );
    $statement->execute([
        'client_id' => $clientId,
        'settings_json' => $json,
    ]);

    return get_settings_by_id($pdo, (string) $pdo->lastInsertId());
}

function upsert_settings_row(PDO $pdo, string $clientId, array $payload): array
{
    $existing = get_settings_row($pdo, $clientId);

    if ($existing === null) {
        return create_settings_row($pdo, $clientId, $payload);
    }

    $json = encode_settings_payload($payload);
    $statement = $pdo->prepare(
        'UPDATE `settings` SET `settings_json` = :settings_json WHERE `client_id` = :client_id'
    );
    $statement->execute([
        'client_id' => $clientId,
        'settings_json' => $json,
    ]);

    return get_settings_row($pdo, $clientId);
}

function get_settings_by_id(PDO $pdo, string $id): array
{
    $statement = $pdo->prepare('SELECT * FROM `settings` WHERE `id` = :id LIMIT 1');
    $statement->execute(['id' => $id]);
    $row = $statement->fetch();

    if (!$row) {
        throw new RuntimeException('Settings row was not found after save.');
    }

    return $row;
}

function normalize_settings_client_id(array $payload, string $fallback): string
{
    if (array_key_exists('client_id', $payload) && trim((string) $payload['client_id']) !== '') {
        return (string) $payload['client_id'];
    }

    if (array_key_exists('localId', $payload) && trim((string) $payload['localId']) !== '') {
        return (string) $payload['localId'];
    }

    return $fallback;
}

function encode_settings_payload(array $payload): string
{
    unset($payload['id'], $payload['serverId']);

    $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

    if ($json === false) {
        throw new RuntimeException('Failed to encode settings JSON.');
    }

    return $json;
}

function normalize_settings_response(array $row): array
{
    $settings = json_decode((string) $row['settings_json'], true);

    if (!is_array($settings)) {
        $settings = [];
    }

    return array_merge($settings, [
        'id' => $row['id'],
        'serverId' => $row['id'],
        'client_id' => $row['client_id'],
        'created_at' => $row['created_at'],
        'updated_at' => $row['updated_at'],
    ]);
}


