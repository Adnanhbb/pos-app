<?php

declare(strict_types=1);

/*
 * Users/staff CRUD endpoint.
 * login.php and password verification will be implemented later.
 * Auth middleware will be added later.
 */
require_once __DIR__ . '/config/cors.php';
require_once __DIR__ . '/config/database.php';
require_once __DIR__ . '/lib/request.php';
require_once __DIR__ . '/lib/response.php';
require_once __DIR__ . '/lib/auth_audit.php';
require_once __DIR__ . '/lib/validation.php';
require_once __DIR__ . '/lib/crud.php';

$method = get_request_method();
$id = get_query_id();

try {
        $pdo = get_pdo();
    initialize_optional_crud_auth_audit($pdo, 'users.php', $method);

    if ($method === 'GET') {
        if ($id !== null) {
            $user = get_user_by_id($pdo, $id);

            if ($user === null) {
                error_response('User not found.', 404);
            }

            success_response(normalize_user_response($user));
        }

        success_response(array_map('normalize_user_response', list_users($pdo)));
    }

    if ($method === 'POST') {
        $body = normalize_user_payload(get_json_body());
        $errors = require_fields($body, ['username', 'name', 'role']);

        if (!has_non_empty_password($body)) {
            $errors['password'] = 'This field is required.';
        }

        if ($errors !== []) {
            error_response('Validation failed.', 422, $errors);
        }

        $user = create_user($pdo, $body);
        success_response(normalize_user_response($user), 201);
    }

    if ($method === 'PUT' || $method === 'PATCH') {
        if ($id === null) {
            error_response('User id is required.', 400);
        }

        $existing = get_user_by_id($pdo, $id);

        if ($existing === null) {
            error_response('User not found.', 404);
        }

        $body = normalize_user_payload(get_json_body());
        $user = update_user_row($pdo, $id, $body);

        if ($user === null) {
            error_response('User not found.', 404);
        }

        success_response(normalize_user_response($user));
    }

    if ($method === 'DELETE') {
        if ($id === null) {
            error_response('User id is required.', 400);
        }

        $existing = get_user_by_id($pdo, $id);

        if ($existing === null) {
            error_response('User not found.', 404);
        }

        $user = soft_delete_user($pdo, $id);
        success_response(normalize_user_response($user));
    }

    error_response('Method not allowed.', 405);
} catch (PDOException $exception) {
    if (crud_is_duplicate_key_error($exception)) {
        error_response('Duplicate user identifier', 409);
    }

    error_response('Database error.', 500);
} catch (Throwable $exception) {
    error_response('Server error.', 500);
}

function list_users(PDO $pdo): array
{
    $statement = $pdo->prepare(
        'SELECT * FROM `users` WHERE `is_deleted` = 0 ORDER BY `id` DESC'
    );
    $statement->execute();

    return $statement->fetchAll();
}

function get_user_by_id(PDO $pdo, string $id, bool $includeDeleted = false): ?array
{
    $sql = 'SELECT * FROM `users` WHERE `id` = :id';

    if (!$includeDeleted) {
        $sql .= ' AND `is_deleted` = 0';
    }

    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $statement->execute(['id' => $id]);
    $row = $statement->fetch();

    return $row ?: null;
}

function create_user(PDO $pdo, array $body): array
{
    $statement = $pdo->prepare(
        'INSERT INTO `users` (`client_id`, `username`, `name`, `mobile`, `role`, `password_hash`, `is_active`)
         VALUES (:client_id, :username, :name, :mobile, :role, :password_hash, :is_active)'
    );
    $statement->execute([
        'client_id' => $body['client_id'] ?? null,
        'username' => $body['username'],
        'name' => $body['name'],
        'mobile' => $body['mobile'] ?? null,
        'role' => $body['role'],
        'password_hash' => password_hash((string) $body['password'], PASSWORD_DEFAULT),
        'is_active' => $body['is_active'] ?? 1,
    ]);

    return get_user_by_id($pdo, (string) $pdo->lastInsertId(), true);
}

function update_user_row(PDO $pdo, string $id, array $body): ?array
{
    $allowed = ['client_id', 'username', 'name', 'mobile', 'role', 'is_active'];
    $updates = [];
    $params = ['id' => $id];

    foreach ($allowed as $field) {
        if (array_key_exists($field, $body)) {
            $updates[] = '`' . $field . '` = :' . $field;
            $params[$field] = $body[$field];
        }
    }

    if (has_non_empty_password($body)) {
        $updates[] = '`password_hash` = :password_hash';
        $params['password_hash'] = password_hash((string) $body['password'], PASSWORD_DEFAULT);
    }

    if ($updates === []) {
        return get_user_by_id($pdo, $id);
    }

    $sql = 'UPDATE `users` SET ' . implode(', ', $updates) . ' WHERE `id` = :id AND `is_deleted` = 0';
    $statement = $pdo->prepare($sql);
    $statement->execute($params);

    return get_user_by_id($pdo, $id);
}

function soft_delete_user(PDO $pdo, string $id): ?array
{
    $statement = $pdo->prepare(
        'UPDATE `users` SET `is_deleted` = 1, `deleted_at` = NOW() WHERE `id` = :id AND `is_deleted` = 0'
    );
    $statement->execute(['id' => $id]);

    return get_user_by_id($pdo, $id, true);
}

function normalize_user_payload(array $body): array
{
    $aliases = [
        'Username' => 'username',
        'Name' => 'name',
        'Mobile' => 'mobile',
        'Role' => 'role',
        'Password' => 'password',
        'localId' => 'client_id',
    ];

    foreach ($aliases as $source => $target) {
        if (array_key_exists($source, $body) && !array_key_exists($target, $body)) {
            $body[$target] = $body[$source];
        }
    }

    foreach (['client_id', 'username', 'name', 'mobile', 'role'] as $field) {
        if (array_key_exists($field, $body) && $body[$field] !== null) {
            $body[$field] = trim((string) $body[$field]);
        }
    }

    if (array_key_exists('password', $body) && $body['password'] !== null) {
        $body['password'] = (string) $body['password'];
    }

    if (array_key_exists('is_active', $body)) {
        $body['is_active'] = (int) ((bool) $body['is_active']);
    }

    return $body;
}

function has_non_empty_password(array $body): bool
{
    return array_key_exists('password', $body)
        && is_string($body['password'])
        && trim($body['password']) !== '';
}

function normalize_user_response(?array $user): ?array
{
    if ($user === null) {
        return null;
    }

    unset($user['password_hash'], $user['password'], $user['Password']);

    $user['serverId'] = $user['id'];
    $user['is_active'] = (int) $user['is_active'];
    $user['is_deleted'] = (int) $user['is_deleted'];
    $user['Username'] = $user['username'];
    $user['Name'] = $user['name'];
    $user['Mobile'] = $user['mobile'];
    $user['Role'] = $user['role'];

    return $user;
}


