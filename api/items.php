<?php

declare(strict_types=1);

/*
 * Items endpoint.
 * This endpoint is not authoritative for stock/cascade changes yet.
 * Stock, batches, cylinders, and item relation changes must later sync through
 * dedicated atomic transaction endpoints.
 */
require_once __DIR__ . '/config/cors.php';
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/auth_audit.php';
require_once __DIR__ . '/lib/validation.php';
require_once __DIR__ . '/lib/crud.php';

$method = get_request_method();
$id = get_query_id();

$createFields = [
    'client_id',
    'name',
    'barcode',
    'description',
    'purchasePrice',
    'retailPrice',
    'discountPrice',
    'wholesalePrice',
    'availableStock',
    'category',
    'brand',
    'minunit',
    'maxunit',
    'ConvQty',
];

$safeUpdateFields = [
    'client_id',
    'name',
    'barcode',
    'description',
    'purchasePrice',
    'retailPrice',
    'discountPrice',
    'wholesalePrice',
];

$unsafeUpdateFields = [
    'availableStock',
    'category',
    'brand',
    'minunit',
    'maxunit',
    'ConvQty',
];

$numericFields = [
    'purchasePrice',
    'retailPrice',
    'discountPrice',
    'wholesalePrice',
    'availableStock',
    'ConvQty',
];

try {
        $pdo = get_pdo();
    initialize_optional_crud_auth_audit($pdo, 'items.php', $method);

    if ($method === 'GET') {
        if ($id !== null) {
            $item = crud_get_by_id($pdo, 'items', $id);

            if ($item === null) {
                error_response('Item not found.', 404);
            }

            success_response(normalize_item_response($item));
        }

        success_response(array_map('normalize_item_response', crud_list($pdo, 'items')));
    }

    if ($method === 'POST') {
        $body = normalize_item_payload(get_json_body(), $numericFields);
        $errors = require_fields($body, ['name']);

        if ($errors !== []) {
            error_response('Validation failed.', 422, $errors);
        }

        $item = crud_create($pdo, 'items', $body, $createFields);
        success_response(normalize_item_response($item), 201);
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        if ($id === null) {
            error_response('Item id is required.', 400);
        }

        $existing = crud_get_by_id($pdo, 'items', $id);

        if ($existing === null) {
            error_response('Item not found.', 404);
        }

        $body = normalize_item_payload(get_json_body(), $numericFields);

        foreach ($unsafeUpdateFields as $field) {
            if (array_key_exists($field, $body)) {
                error_response('Unsafe item fields must be synced through transaction endpoints.', 400, [
                    'field' => $field,
                ]);
            }
        }

        if (array_key_exists('name', $body)) {
            $errors = require_fields($body, ['name']);

            if ($errors !== []) {
                error_response('Validation failed.', 422, $errors);
            }
        }

        $item = crud_update($pdo, 'items', $id, $body, $safeUpdateFields);

        if ($item === null) {
            error_response('Item not found.', 404);
        }

        success_response(normalize_item_response($item));
    }

    if ($method === 'DELETE') {
        if ($id === null) {
            error_response('Item id is required.', 400);
        }

        $existing = crud_get_by_id($pdo, 'items', $id);

        if ($existing === null) {
            error_response('Item not found.', 404);
        }

        /*
         * Item delete/restore must later become transactional because local
         * callers also affect batches, cylinders, and category/brand/unit counts.
         */
        success_response(normalize_item_response(crud_soft_delete($pdo, 'items', $id)));
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

function normalize_item_payload(array $body, array $numericFields): array
{
    if (array_key_exists('localId', $body) && !array_key_exists('client_id', $body)) {
        $body['client_id'] = $body['localId'] === null ? null : (string) $body['localId'];
    }

    if (array_key_exists('client_id', $body) && $body['client_id'] !== null) {
        $body['client_id'] = (string) $body['client_id'];
    }

    foreach (['name', 'barcode', 'category', 'brand', 'minunit', 'maxunit'] as $field) {
        if (array_key_exists($field, $body) && is_string($body[$field])) {
            $body[$field] = trim($body[$field]);
        }
    }

    foreach ($numericFields as $field) {
        if (array_key_exists($field, $body)) {
            $body[$field] = (float) $body[$field];
        }
    }

    return $body;
}

function normalize_item_response(?array $item): ?array
{
    if ($item === null) {
        return null;
    }

    foreach ([
        'purchasePrice',
        'retailPrice',
        'discountPrice',
        'wholesalePrice',
        'availableStock',
        'ConvQty',
    ] as $field) {
        if (array_key_exists($field, $item)) {
            $item[$field] = (float) $item[$field];
        }
    }

    return $item;
}



