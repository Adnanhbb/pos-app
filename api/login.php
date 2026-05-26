<?php

declare(strict_types=1);

/*
 * Minimal production-oriented login endpoint.
 * Issues bearer tokens backed by api_auth_tokens rows. Passwords are verified
 * against users.password_hash and are never returned or stored in plaintext.
 */
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

    $body = get_json_body();
    $username = trim((string) ($body['username'] ?? $body['Username'] ?? ''));
    $password = (string) ($body['password'] ?? $body['Password'] ?? '');

    if ($username === '' || $password === '') {
        error_response('Username and password are required.', 422);
    }

    $pdo = get_pdo();
    $statement = $pdo->prepare(
        'SELECT `id`, `username`, `name`, `mobile`, `role`, `password_hash`, `is_active`, `is_deleted`, `created_at`, `updated_at`
         FROM `users`
         WHERE `username` = :username
         LIMIT 1'
    );
    $statement->execute(['username' => $username]);
    $user = $statement->fetch();

    if (!$user || (int) ($user['is_deleted'] ?? 0) !== 0 || (int) ($user['is_active'] ?? 1) !== 1) {
        error_response('Invalid username or password.', 401);
    }

    if (!password_verify($password, (string) ($user['password_hash'] ?? ''))) {
        error_response('Invalid username or password.', 401);
    }

    $token = create_user_auth_token($pdo, $user, 'frontend login');

    success_response([
        'token' => $token['token'],
        'tokenType' => 'Bearer',
        'sessionId' => $token['sessionId'],
        'actor' => safe_user_actor_response($user, $token['sessionId']),
    ]);
} catch (PDOException $exception) {
    unset($exception);
    error_response('Database error.', 500);
} catch (Throwable $exception) {
    unset($exception);
    error_response('Server error.', 500);
}

function safe_user_actor_response(array $user, ?string $sessionId = null): array
{
    return [
        'id' => (int) $user['id'],
        'serverId' => (int) $user['id'],
        'username' => (string) $user['username'],
        'Username' => (string) $user['username'],
        'name' => (string) $user['name'],
        'Name' => (string) $user['name'],
        'mobile' => $user['mobile'] ?? null,
        'Mobile' => $user['mobile'] ?? null,
        'role' => (string) $user['role'],
        'Role' => (string) $user['role'],
        'is_active' => (int) $user['is_active'],
        'actorType' => 'user',
        'actorId' => (string) $user['id'],
        'actorRole' => (string) $user['role'],
        'sessionId' => $sessionId,
    ];
}