<?php

declare(strict_types=1);

/*
 * Shared-hosting friendly auth/session foundation.
 *
 * Supports bearer tokens from environment variables or api_auth_tokens rows.
 * Tokens are never stored or returned in plaintext; only SHA-256 hashes are
 * compared. This file does not start sync, replay transactions by itself, or
 * mutate business data.
 */

class ApiAuthException extends RuntimeException
{
}

function hash_auth_token(string $token): string
{
    return hash('sha256', $token);
}

function get_authorization_header_value(): ?string
{
    $candidates = [
        $_SERVER['HTTP_AUTHORIZATION'] ?? null,
        $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? null,
        $_SERVER['Authorization'] ?? null,
    ];

    foreach ($candidates as $candidate) {
        if (is_string($candidate) && trim($candidate) !== '') {
            return trim($candidate);
        }
    }

    if (function_exists('apache_request_headers')) {
        $headers = apache_request_headers();
        foreach ($headers as $name => $value) {
            if (strtolower((string) $name) === 'authorization' && trim((string) $value) !== '') {
                return trim((string) $value);
            }
        }
    }

    return null;
}

function bearer_token_from_authorization_header(?string $header): ?string
{
    if ($header === null || trim($header) === '') {
        return null;
    }

    if (!preg_match('/^Bearer\s+(.+)$/i', trim($header), $matches)) {
        return null;
    }

    $token = trim($matches[1]);
    return $token === '' ? null : $token;
}

function get_bearer_token_from_request(): ?string
{
    return bearer_token_from_authorization_header(get_authorization_header_value());
}

function replay_auth_unauthorized_result(string $reason = 'unauthorized'): array
{
    return [
        'success' => false,
        'authenticated' => false,
        'reason' => $reason,
    ];
}

function authenticate_api_bearer_token(PDO $pdo, ?string $token): array
{
    if ($token === null || trim($token) === '') {
        return replay_auth_unauthorized_result('missing_bearer_token');
    }

    $token = trim($token);
    $envReplayToken = trim((string) getenv('REPLAY_WORKER_TOKEN'));
    if ($envReplayToken !== '' && hash_equals($envReplayToken, $token)) {
        return [
            'success' => true,
            'authenticated' => true,
            'source' => 'environment',
            'actorType' => 'replay_worker',
            'actorId' => trim((string) (getenv('REPLAY_WORKER_ID') ?: 'env-replay-worker')),
            'actorRole' => 'replay',
            'sessionId' => null,
        ];
    }

    if (!auth_table_exists($pdo, 'api_auth_tokens')) {
        return replay_auth_unauthorized_result('token_store_unavailable');
    }

    $statement = $pdo->prepare(
        'SELECT `id`, `actor_type`, `actor_id`, `role`, `label`, `expires_at`
         FROM `api_auth_tokens`
         WHERE `token_hash` = :token_hash
           AND `is_active` = 1
           AND (`expires_at` IS NULL OR `expires_at` > NOW())
         LIMIT 1'
    );
    $statement->execute([
        'token_hash' => hash_auth_token($token),
    ]);
    $row = $statement->fetch();

    if (!$row) {
        return replay_auth_unauthorized_result('invalid_bearer_token');
    }

    try {
        $update = $pdo->prepare('UPDATE `api_auth_tokens` SET `last_used_at` = NOW() WHERE `id` = :id');
        $update->execute(['id' => $row['id']]);
    } catch (Throwable $exception) {
        unset($exception);
    }

    return [
        'success' => true,
        'authenticated' => true,
        'source' => 'api_auth_tokens',
        'actorType' => (string) ($row['actor_type'] ?? 'unknown'),
        'actorId' => (string) ($row['actor_id'] ?? ''),
        'actorRole' => (string) ($row['role'] ?? ''),
        'sessionId' => (string) ($row['id'] ?? ''),
    ];
}

function authenticate_replay_request(PDO $pdo): array
{
    return authenticate_api_bearer_token($pdo, get_bearer_token_from_request());
}

function require_replay_request_auth(PDO $pdo): array
{
    $auth = authenticate_replay_request($pdo);
    return require_replay_auth_context($auth);
}

function require_replay_auth_context(array $auth): array
{
    if (($auth['authenticated'] ?? false) !== true) {
        throw new ApiAuthException('Unauthorized replay request.');
    }

    $actorType = trim((string) ($auth['actorType'] ?? ''));
    $actorId = trim((string) ($auth['actorId'] ?? ''));
    $actorRole = strtolower(trim((string) ($auth['actorRole'] ?? '')));

    if ($actorType === '' || $actorId === '') {
        throw new ApiAuthException('Unauthorized replay request.');
    }

    $allowedRoles = ['replay', 'admin', 'owner', 'dev'];
    $allowedActorTypes = ['replay_worker', 'user', 'device'];

    if (!in_array($actorRole, $allowedRoles, true) || !in_array($actorType, $allowedActorTypes, true)) {
        throw new ApiAuthException('Unauthorized replay request.');
    }

    return [
        'authenticated' => true,
        'actorType' => $actorType,
        'actorId' => $actorId,
        'actorRole' => $actorRole,
        'sessionId' => isset($auth['sessionId']) && $auth['sessionId'] !== null ? (string) $auth['sessionId'] : null,
        'source' => isset($auth['source']) ? (string) $auth['source'] : null,
    ];
}

function replay_worker_id_from_auth_context(array $auth): string
{
    $actorType = preg_replace('/[^a-zA-Z0-9_-]+/', '-', (string) ($auth['actorType'] ?? 'actor'));
    $actorId = preg_replace('/[^a-zA-Z0-9_-]+/', '-', (string) ($auth['actorId'] ?? 'unknown'));
    $workerId = trim($actorType . '-' . $actorId, '-');

    return $workerId === '' ? 'authorized-replay-worker' : substr($workerId, 0, 150);
}

function auth_table_exists(PDO $pdo, string $table): bool
{
    try {
        $statement = $pdo->prepare(
            'SELECT COUNT(*) AS count
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = :table'
        );
        $statement->execute(['table' => $table]);
        $row = $statement->fetch();

        return (int) ($row['count'] ?? 0) > 0;
    } catch (Throwable $exception) {
        unset($exception);
        return false;
    }
}

function unauthorized_response(string $message = 'Unauthorized.'): void
{
    if (function_exists('error_response')) {
        error_response($message, 401);
    }

    http_response_code(401);
    header('Content-Type: application/json');
    echo json_encode([
        'success' => false,
        'message' => $message,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}
function ensure_api_auth_tokens_table(PDO $pdo): void
{
    $pdo->exec("CREATE TABLE IF NOT EXISTS `api_auth_tokens` (
        `id` BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
        `token_hash` CHAR(64) NOT NULL UNIQUE,
        `actor_type` VARCHAR(50) NOT NULL,
        `actor_id` VARCHAR(150) NOT NULL,
        `role` VARCHAR(80) NOT NULL,
        `label` VARCHAR(180) NULL,
        `is_active` TINYINT(1) NOT NULL DEFAULT 1,
        `expires_at` DATETIME NULL,
        `last_used_at` DATETIME NULL,
        `revoked_at` DATETIME NULL,
        `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX `idx_api_auth_tokens_actor` (`actor_type`, `actor_id`),
        INDEX `idx_api_auth_tokens_role` (`role`),
        INDEX `idx_api_auth_tokens_active` (`is_active`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
}

function generate_bearer_token(): string
{
    return rtrim(strtr(base64_encode(random_bytes(32)), '+/', '-_'), '=');
}

function auth_token_expiry_sql(): ?string
{
    $ttl = (int) (getenv('AUTH_TOKEN_TTL_SECONDS') ?: 2592000);
    if ($ttl <= 0) {
        return null;
    }

    return date('Y-m-d H:i:s', time() + $ttl);
}

function create_user_auth_token(PDO $pdo, array $user, string $label = 'frontend login'): array
{
    ensure_api_auth_tokens_table($pdo);

    $token = generate_bearer_token();
    $statement = $pdo->prepare(
        'INSERT INTO `api_auth_tokens` (`token_hash`, `actor_type`, `actor_id`, `role`, `label`, `is_active`, `expires_at`)
         VALUES (:token_hash, :actor_type, :actor_id, :role, :label, 1, :expires_at)'
    );
    $statement->execute([
        'token_hash' => hash_auth_token($token),
        'actor_type' => 'user',
        'actor_id' => (string) $user['id'],
        'role' => (string) ($user['role'] ?? ''),
        'label' => substr($label, 0, 180),
        'expires_at' => auth_token_expiry_sql(),
    ]);

    return [
        'token' => $token,
        'sessionId' => (string) $pdo->lastInsertId(),
    ];
}

function revoke_current_bearer_token(PDO $pdo): bool
{
    $token = get_bearer_token_from_request();
    if ($token === null || trim($token) === '' || !auth_table_exists($pdo, 'api_auth_tokens')) {
        return false;
    }

    $statement = $pdo->prepare(
        'UPDATE `api_auth_tokens`
         SET `is_active` = 0, `revoked_at` = NOW()
         WHERE `token_hash` = :token_hash AND `is_active` = 1'
    );
    $statement->execute(['token_hash' => hash_auth_token($token)]);

    return $statement->rowCount() > 0;
}
