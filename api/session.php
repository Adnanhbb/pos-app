<?php

declare(strict_types=1);

/* Safe session inspection endpoint for bearer-token based frontend sessions. */
require_once __DIR__ . '/config/cors.php';
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/auth.php';

$method = get_request_method();

try {
    if ($method !== 'GET') {
        error_response('Method not allowed.', 405);
    }

    $pdo = get_pdo();
    $auth = authenticate_replay_request($pdo);

    if (($auth['authenticated'] ?? false) !== true) {
        error_response('Unauthorized.', 401);
    }

    $actor = [
        'actorType' => (string) ($auth['actorType'] ?? ''),
        'actorId' => (string) ($auth['actorId'] ?? ''),
        'actorRole' => (string) ($auth['actorRole'] ?? ''),
        'sessionId' => $auth['sessionId'] ?? null,
    ];

    if (($auth['actorType'] ?? '') === 'user') {
        $statement = $pdo->prepare(
            'SELECT `id`, `username`, `name`, `mobile`, `role`, `is_active`, `is_deleted`
             FROM `users`
             WHERE `id` = :id
             LIMIT 1'
        );
        $statement->execute(['id' => (string) ($auth['actorId'] ?? '')]);
        $user = $statement->fetch();

        if (!$user || (int) ($user['is_deleted'] ?? 0) !== 0 || (int) ($user['is_active'] ?? 1) !== 1) {
            error_response('Unauthorized.', 401);
        }

        $actor = array_merge($actor, [
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
        ]);
    }

    success_response([
        'authenticated' => true,
        'actor' => $actor,
    ]);
} catch (PDOException $exception) {
    unset($exception);
    error_response('Database error.', 500);
} catch (Throwable $exception) {
    unset($exception);
    error_response('Server error.', 500);
}