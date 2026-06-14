<?php

declare(strict_types=1);

/*
 * TEMPORARY SUPPORT ENDPOINT.
 *
 * Enable only during supervised troubleshooting by setting
 * ENABLE_CONFIG_DIAGNOSTICS=true in server environment configuration or
 * api/config/private.php. Disable it and remove this file after diagnosis.
 */

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
header('Pragma: no-cache');
header('X-Content-Type-Options: nosniff');
header('X-Robots-Tag: noindex, nofollow, noarchive');

function config_check_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function config_check_enabled(mixed $value): bool
{
    return in_array(
        strtolower(trim((string) $value)),
        ['1', 'true', 'yes', 'on', 'enabled'],
        true
    );
}

function sanitized_database_error(Throwable $exception): array
{
    $message = strtolower($exception->getMessage());
    $safeMessage = 'Database connection test failed.';

    if (str_contains($message, 'production database configuration is incomplete')) {
        $safeMessage = 'Required production database configuration is incomplete.';
    } elseif (str_contains($message, 'could not find driver')) {
        $safeMessage = 'PDO MySQL is not available.';
    } elseif (str_contains($message, 'access denied')) {
        $safeMessage = 'Database authentication was rejected.';
    } elseif (str_contains($message, 'unknown database')) {
        $safeMessage = 'The configured database was not found.';
    } elseif (
        str_contains($message, 'connection refused') ||
        str_contains($message, 'timed out') ||
        str_contains($message, 'getaddrinfo') ||
        str_contains($message, 'name or service not known') ||
        str_contains($message, 'no such host')
    ) {
        $safeMessage = 'The configured database host could not be reached.';
    }

    $sqlState = null;
    $driverCode = null;

    if ($exception instanceof PDOException) {
        $candidate = strtoupper(trim((string) $exception->getCode()));
        if (preg_match('/^[A-Z0-9]{5}$/', $candidate) === 1) {
            $sqlState = $candidate;
        }

        if (isset($exception->errorInfo[1]) && is_numeric($exception->errorInfo[1])) {
            $driverCode = (int) $exception->errorInfo[1];
        }
    }

    return [
        'sqlState' => $sqlState,
        'driverCode' => $driverCode,
        'message' => $safeMessage,
    ];
}

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    config_check_response([
        'success' => false,
        'message' => 'Method not allowed.',
    ], 405);
}

$privateConfigPath = __DIR__ . '/config/private.php';
$privateConfigExists = is_file($privateConfigPath);
$privateConfigReadable = $privateConfigExists && is_readable($privateConfigPath);

try {
    require_once __DIR__ . '/config/runtime.php';

    if (!config_check_enabled(app_config_value('ENABLE_CONFIG_DIAGNOSTICS', false))) {
        config_check_response([
            'success' => false,
            'message' => 'Not found.',
        ], 404);
    }

    $privateConfig = app_private_config();
    $privateConfigLoaded = $privateConfigExists && is_array($privateConfig);

    $pdoMysqlLoaded = extension_loaded('pdo_mysql')
        && class_exists(PDO::class)
        && in_array('mysql', PDO::getAvailableDrivers(), true);

    $connection = [
        'success' => false,
        'error' => null,
    ];

    try {
        require_once __DIR__ . '/config/database.php';
        get_pdo()->query('SELECT 1');
        $connection['success'] = true;
    } catch (Throwable $exception) {
        $connection['error'] = sanitized_database_error($exception);
    }

    config_check_response([
        'success' => true,
        'temporarySupportEndpoint' => true,
        'removeAfterTroubleshooting' => true,
        'phpVersion' => PHP_VERSION,
        'privateConfig' => [
            'exists' => $privateConfigExists,
            'readable' => $privateConfigReadable,
            'loaded' => $privateConfigLoaded,
        ],
        'runtimeConfig' => [
            'appEnv' => (string) app_config_value('APP_ENV', ''),
            'dbHost' => (string) app_config_value('DB_HOST', ''),
            'dbName' => (string) app_config_value('DB_NAME', ''),
            'dbUser' => (string) app_config_value('DB_USER', ''),
            'dbPasswordPresent' => trim((string) app_config_value('DB_PASS', '')) !== '',
            'frontendOrigin' => (string) app_config_value('FRONTEND_ORIGIN', ''),
            'corsAllowLocal' => (string) app_config_value('CORS_ALLOW_LOCAL', 'false'),
            'replayWorkerTokenPresent' => trim((string) app_config_value('REPLAY_WORKER_TOKEN', '')) !== '',
        ],
        'pdoMysqlLoaded' => $pdoMysqlLoaded,
        'databaseConnection' => $connection,
    ]);
} catch (Throwable $exception) {
    config_check_response([
        'success' => false,
        'temporarySupportEndpoint' => true,
        'privateConfig' => [
            'exists' => $privateConfigExists,
            'readable' => $privateConfigReadable,
            'loaded' => false,
        ],
        'message' => 'Runtime configuration could not be loaded.',
    ], 500);
}
