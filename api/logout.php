<?php

declare(strict_types=1);

/* Manual logout endpoint. Revokes only the bearer token presented by the caller. */
require_once __DIR__ . '/config/cors.php';
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/auth.php';

$method = get_request_method();

try {
    if ($method !== 'POST') {
        error_response('Method not allowed.', 405);
    }

    $pdo = get_pdo();
    $revoked = revoke_current_bearer_token($pdo);

    success_response([
        'loggedOut' => true,
        'tokenRevoked' => $revoked,
    ]);
} catch (PDOException $exception) {
    unset($exception);
    error_response('Database error.', 500);
} catch (Throwable $exception) {
    unset($exception);
    error_response('Server error.', 500);
}