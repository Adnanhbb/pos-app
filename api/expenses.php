<?php

declare(strict_types=1);

/*
 * Expenses CRUD endpoint.
 * Later auth middleware should be required here before handling the request.
 */
require_once __DIR__ . '/config/cors.php';
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/validation.php';
require_once __DIR__ . '/lib/crud.php';
require_once __DIR__ . '/lib/entity_endpoint.php';

handle_entity_crud_endpoint([
    'table' => 'expenses',
    'deleteMode' => 'soft',
    'entityLabel' => 'Expense',
    'allowedFields' => [
        'client_id',
        'date',
        'category',
        'amount',
        'description',
    ],
    'requiredOnCreate' => ['date', 'category', 'amount'],
    'trimFields' => ['date', 'category', 'description'],
    'numericFields' => ['amount'],
    'normalizer' => static function (array $body): array {
        unset($body['title'], $body['name']);

        return $body;
    },
]);
