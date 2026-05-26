<?php

declare(strict_types=1);

/*
 * Public health endpoint. Other API endpoints will later require auth.
 * Shared hosting should keep database credentials in environment variables or
 * the safest location supported by the host.
 */
require_once __DIR__ . '/config/cors.php';
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';

$method = get_request_method();

if ($method !== 'GET') {
    error_response('Method not allowed.', 405);
}

try {
    get_pdo()->query('SELECT 1');

    success_response([
        'status' => 'ok',
        'db' => 'connected',
    ]);
} catch (Throwable $exception) {
    error_response('Database connection failed.', 500, [
        'db' => 'disconnected',
    ]);
}

