<?php

declare(strict_types=1);

require_once __DIR__ . '/runtime.php';

/*
 * Configure production origins through FRONTEND_ORIGIN. Multiple origins may
 * be comma-separated for a controlled staging/production rollout.
 *
 * Local development origins are opt-in through CORS_ALLOW_LOCAL=true. Same-
 * origin deployments (frontend and /api under one domain) require no CORS
 * response header when the browser sends no Origin header.
 */
$configuredOrigins = array_filter(array_map(
    static fn (string $origin): string => rtrim(trim($origin), '/'),
    explode(',', (string) app_config_value('FRONTEND_ORIGIN', ''))
));

$allowLocal = in_array(
    strtolower(trim((string) app_config_value('CORS_ALLOW_LOCAL', 'false'))),
    ['1', 'true', 'yes', 'on'],
    true
);

$localOrigins = $allowLocal
    ? [
        'http://localhost:5173',
        'http://localhost:4173',
        'http://127.0.0.1:5173',
        'http://127.0.0.1:4173',
    ]
    : [];

$allowedOrigins = array_values(array_unique(array_merge($configuredOrigins, $localOrigins)));

$origin = $_SERVER['HTTP_ORIGIN'] ?? '';

if ($origin !== '' && in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With');
header('Access-Control-Allow-Credentials: true');
header('Access-Control-Expose-Headers: X-Auth-Audit-Mode, X-Auth-Enforcement, X-Auth-Status, X-Auth-Actor-Type, X-Auth-Actor-Id, X-Auth-Actor-Role');

if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
    http_response_code(204);
    exit;
}


