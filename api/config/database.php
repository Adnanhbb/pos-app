<?php

declare(strict_types=1);

require_once __DIR__ . '/runtime.php';

/*
 * Shared hosting note:
 * Environment variables take precedence. api/config/private.php is the
 * gitignored fallback for hosts that do not expose PHP environment variables.
 */
function get_pdo(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $appEnv = strtolower(trim((string) app_config_value('APP_ENV', 'development')));
    $envHost = app_config_value('DB_HOST');
    $envName = app_config_value('DB_NAME');
    $envUser = app_config_value('DB_USER');
    $envPass = app_config_value('DB_PASS');

    if ($appEnv === 'production') {
        $missing = [];
        foreach ([
            'DB_HOST' => $envHost,
            'DB_NAME' => $envName,
            'DB_USER' => $envUser,
            'DB_PASS' => $envPass,
        ] as $key => $value) {
            if ($value === null || trim((string) $value) === '') {
                $missing[] = $key;
            }
        }

        if ($missing !== []) {
            throw new RuntimeException('Production database configuration is incomplete.');
        }
    }

    $host = $envHost ?: 'localhost';
    $name = $envName ?: 'jawad_bro';
    $user = $envUser ?: 'root';
    $pass = $envPass !== null ? (string) $envPass : '';

    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;charset=utf8mb4',
        $host,
        $name
    );

    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false,
    ]);

    return $pdo;
}
