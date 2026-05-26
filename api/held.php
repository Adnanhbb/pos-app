<?php

declare(strict_types=1);

/*
 * Bundled held cart endpoint.
 * Later auth middleware should be required here before handling the request.
 * Held headers and held_items are handled as one logical unit.
 */
require_once __DIR__ . '/config/cors.php';
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/auth_audit.php';
require_once __DIR__ . '/lib/crud.php';

$method = get_request_method();
$id = get_query_id();

try {
        $pdo = get_pdo();
    initialize_optional_crud_auth_audit($pdo, 'held.php', $method);

    if ($method === 'GET') {
        if ($id !== null) {
            $held = get_held_bundle($pdo, $id);

            if ($held === null) {
                error_response('Held cart not found.', 404);
            }

            success_response($held);
        }

        success_response(list_held_bundles($pdo));
    }

    if ($method === 'POST') {
        $bundle = normalize_held_request(get_json_body());
        $held = create_held_bundle($pdo, $bundle['held'], $bundle['items']);

        success_response($held, 201);
    }

    if ($method === 'DELETE') {
        if ($id === null) {
            error_response('Held cart id is required.', 400);
        }

        $existing = get_held_bundle($pdo, $id);

        if ($existing === null) {
            error_response('Held cart not found.', 404);
        }

        soft_delete_held($pdo, $id);
        success_response([
            'id' => $id,
            'serverId' => $id,
            'is_deleted' => 1,
        ]);
    }

    error_response('Method not allowed.', 405);
} catch (InvalidArgumentException $exception) {
    error_response($exception->getMessage(), 400);
} catch (PDOException $exception) {
    if (crud_is_duplicate_key_error($exception)) {
        error_response('Duplicate client_id', 409);
    }

    error_response('Database error.', 500);
} catch (Throwable $exception) {
    error_response('Server error.', 500);
}

function normalize_held_request(array $body): array
{
    $payload = $body['payload'] ?? $body;

    if (!is_array($payload)) {
        throw new InvalidArgumentException('Invalid held payload.');
    }

    $held = $payload['held'] ?? null;
    $items = $payload['items'] ?? null;

    if (!is_array($held)) {
        $held = $payload;
        unset($held['items']);
    }

    if (!is_array($items)) {
        $items = [];
    }

    if (array_key_exists('localId', $payload) && !array_key_exists('client_id', $held)) {
        $held['client_id'] = $payload['localId'];
    }

    if (array_key_exists('client_id', $payload) && !array_key_exists('client_id', $held)) {
        $held['client_id'] = $payload['client_id'];
    }

    if (array_key_exists('localId', $held) && !array_key_exists('client_id', $held)) {
        $held['client_id'] = $held['localId'];
    }

    if (array_key_exists('client_id', $held) && $held['client_id'] !== null) {
        $held['client_id'] = (string) $held['client_id'];
    }

    return [
        'held' => $held,
        'items' => array_values($items),
    ];
}

function create_held_bundle(PDO $pdo, array $held, array $items): array
{
    $pdo->beginTransaction();

    try {
        $heldJson = json_encode($held, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if ($heldJson === false) {
            throw new RuntimeException('Failed to encode held header.');
        }

        $statement = $pdo->prepare(
            'INSERT INTO `held`
                (`client_id`, `customerName`, `supplierName`, `transactionType`, `total`, `held_json`)
             VALUES
                (:client_id, :customerName, :supplierName, :transactionType, :total, :held_json)'
        );
        $statement->execute([
            'client_id' => $held['client_id'] ?? null,
            'customerName' => $held['customerName'] ?? null,
            'supplierName' => $held['supplierName'] ?? null,
            'transactionType' => $held['transactionType'] ?? null,
            'total' => get_held_total($held),
            'held_json' => $heldJson,
        ]);

        $heldId = (string) $pdo->lastInsertId();
        $itemStatement = $pdo->prepare(
            'INSERT INTO `held_items` (`held_id`, `item_json`) VALUES (:held_id, :item_json)'
        );

        foreach ($items as $item) {
            $itemJson = json_encode($item, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

            if ($itemJson === false) {
                throw new RuntimeException('Failed to encode held item.');
            }

            $itemStatement->execute([
                'held_id' => $heldId,
                'item_json' => $itemJson,
            ]);
        }

        $pdo->commit();

        return get_held_bundle($pdo, $heldId);
    } catch (Throwable $exception) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }

        throw $exception;
    }
}

function list_held_bundles(PDO $pdo): array
{
    $statement = $pdo->prepare(
        'SELECT * FROM `held` WHERE `is_deleted` = 0 ORDER BY `id` DESC'
    );
    $statement->execute();
    $rows = $statement->fetchAll();

    return array_map(
        static fn (array $row): array => normalize_held_response($pdo, $row),
        $rows
    );
}

function get_held_bundle(PDO $pdo, string $id): ?array
{
    $statement = $pdo->prepare(
        'SELECT * FROM `held` WHERE `id` = :id AND `is_deleted` = 0 LIMIT 1'
    );
    $statement->execute(['id' => $id]);
    $row = $statement->fetch();

    if (!$row) {
        return null;
    }

    return normalize_held_response($pdo, $row);
}

function normalize_held_response(PDO $pdo, array $held): array
{
    $items = get_held_items($pdo, (string) $held['id']);
    $decodedHeld = [];

    if (!empty($held['held_json'])) {
        $decoded = json_decode((string) $held['held_json'], true);

        if (is_array($decoded)) {
            $decodedHeld = $decoded;
        }
    }

    unset($held['held_json']);

    $held = array_merge($decodedHeld, $held);
    $held['serverId'] = $held['id'];
    $held['total'] = (float) $held['total'];
    $held['items'] = $items;

    return $held;
}

function get_held_items(PDO $pdo, string $heldId): array
{
    $statement = $pdo->prepare(
        'SELECT * FROM `held_items` WHERE `held_id` = :held_id ORDER BY `id` ASC'
    );
    $statement->execute(['held_id' => $heldId]);
    $rows = $statement->fetchAll();

    return array_map(static function (array $row): array {
        $item = json_decode((string) $row['item_json'], true);

        if (!is_array($item)) {
            $item = [];
        }

        $item['id'] = $item['id'] ?? $row['id'];
        $item['heldId'] = $item['heldId'] ?? $row['held_id'];
        $item['serverId'] = $row['id'];

        return $item;
    }, $rows);
}

function soft_delete_held(PDO $pdo, string $id): void
{
    $statement = $pdo->prepare(
        'UPDATE `held` SET `is_deleted` = 1, `deleted_at` = NOW() WHERE `id` = :id AND `is_deleted` = 0'
    );
    $statement->execute(['id' => $id]);
}

function get_held_total(array $held): float
{
    if (array_key_exists('total', $held)) {
        return (float) $held['total'];
    }

    if (array_key_exists('grandTotal', $held)) {
        return (float) $held['grandTotal'];
    }

    return 0.0;
}


