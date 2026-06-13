<?php

declare(strict_types=1);

/*
 * Shared hosting note:
 * Prefer environment variables when your host supports them. If not, replace
 * the placeholder values below with credentials from the hosting control panel
 * and keep this file outside public access where your host allows it.
 */
function get_pdo(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $appEnv = strtolower(trim((string) (getenv('APP_ENV') ?: 'development')));
    $envHost = getenv('DB_HOST');
    $envName = getenv('DB_NAME');
    $envUser = getenv('DB_USER');
    $envPass = getenv('DB_PASS');

    if ($appEnv === 'production') {
        $missing = [];
        foreach ([
            'DB_HOST' => $envHost,
            'DB_NAME' => $envName,
            'DB_USER' => $envUser,
            'DB_PASS' => $envPass,
        ] as $key => $value) {
            if ($value === false || trim((string) $value) === '') {
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
    $pass = $envPass !== false ? $envPass : '';

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
