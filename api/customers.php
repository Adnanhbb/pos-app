<?php

declare(strict_types=1);

/*
 * Customers CRUD endpoint.
 * Later auth middleware should be required here before handling the request.
 * Payment and transaction/accounting logic does not belong in this endpoint.
 */
require_once __DIR__ . '/config/cors.php';
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/validation.php';
require_once __DIR__ . '/lib/crud.php';
require_once __DIR__ . '/lib/entity_endpoint.php';

handle_entity_crud_endpoint([
    'table' => 'customers',
    'deleteMode' => 'soft',
    'entityLabel' => 'Customer',
    'allowedFields' => [
        'client_id',
        'name',
        'mobile',
        'cnic',
        'address',
    ],
    'requiredOnCreate' => ['name'],
    'trimFields' => ['name', 'mobile', 'cnic', 'address'],
]);
