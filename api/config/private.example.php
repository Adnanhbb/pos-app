<?php

declare(strict_types=1);

/*
 * Host-only configuration template.
 *
 * Create api/config/private.php on the hosting server from this example when
 * PHP environment variables are unavailable. Never commit or share the real
 * private.php file, database password, or replay token.
 */
return [
    'APP_ENV' => 'production',
    'DB_HOST' => 'replace_with_database_host',
    'DB_NAME' => 'replace_with_database_name',
    'DB_USER' => 'replace_with_database_user',
    'DB_PASS' => 'replace_with_database_password',
    'FRONTEND_ORIGIN' => 'https://replace-with-production-domain.example',
    'CORS_ALLOW_LOCAL' => 'false',
    'CRUD_AUTH_ENFORCEMENT' => 'off',
    'REPLAY_WORKER_TOKEN' => 'replace_with_strong_random_token',
    // Temporary support switch. Keep false except during supervised diagnosis.
    'ENABLE_CONFIG_DIAGNOSTICS' => 'false',
];
