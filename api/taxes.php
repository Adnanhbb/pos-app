<?php

declare(strict_types=1);

/*
 * Taxes CRUD endpoint.
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
    'table' => 'taxes',
    'entityLabel' => 'Tax',
    'allowedFields' => ['client_id', 'name', 'value', 'type'],
    'requiredOnCreate' => ['name'],
    'trimFields' => ['name', 'type'],
    'numericFields' => ['value'],
    'aliases' => [
        'rate' => 'value',
    ],
]);

