<?php

declare(strict_types=1);

/*
 * Client-setup helper for a database-backed developer support account.
 * Credentials are read from environment variables and are never printed.
 */
require_once __DIR__ . '/../api/config/database.php';

function fail_support_setup(string $message, int $exitCode = 1): never
{
    fwrite(STDERR, $message . PHP_EOL);
    exit($exitCode);
}

$username = trim((string) getenv('SUPPORT_USER_USERNAME'));
$password = (string) getenv('SUPPORT_USER_PASSWORD');
$name = trim((string) (getenv('SUPPORT_USER_NAME') ?: 'Developer Support'));
$mobile = trim((string) getenv('SUPPORT_USER_MOBILE'));
$role = trim((string) (getenv('SUPPORT_USER_ROLE') ?: 'Dev'));

if ($username === '' || trim($password) === '') {
    fail_support_setup('SUPPORT_USER_USERNAME and SUPPORT_USER_PASSWORD are required.');
}

if (strcasecmp($role, 'admin') === 0) {
    $role = 'admin';
} elseif ($role !== 'Dev') {
    fail_support_setup('SUPPORT_USER_ROLE must be Dev or admin.');
}

try {
    $pdo = get_pdo();
    $statement = $pdo->prepare(
        'SELECT `id`, `username`, `role`, `is_active`, `is_deleted`
         FROM `users`
         WHERE `username` = :username
         LIMIT 1'
    );
    $statement->execute(['username' => $username]);
    $existing = $statement->fetch();

    if ($existing) {
        if ((int) ($existing['is_deleted'] ?? 0) !== 0 || (int) ($existing['is_active'] ?? 1) !== 1) {
            fail_support_setup('Support user already exists but is inactive or deleted. Review it manually; no changes were applied.');
        }

        fwrite(STDOUT, 'Support user already exists. No changes were applied.' . PHP_EOL);
        exit(0);
    }

    $insert = $pdo->prepare(
        'INSERT INTO `users` (`client_id`, `username`, `name`, `mobile`, `role`, `password_hash`, `is_active`)
         VALUES (:client_id, :username, :name, :mobile, :role, :password_hash, 1)'
    );
    $insert->execute([
        'client_id' => 'support-' . bin2hex(random_bytes(8)),
        'username' => $username,
        'name' => $name,
        'mobile' => $mobile !== '' ? $mobile : null,
        'role' => $role,
        'password_hash' => password_hash($password, PASSWORD_DEFAULT),
    ]);

    fwrite(STDOUT, 'Database-backed developer support user created successfully.' . PHP_EOL);
} catch (PDOException $exception) {
    unset($exception);
    fail_support_setup('Database error while creating support user. No credentials were printed.');
} catch (Throwable $exception) {
    unset($exception);
    fail_support_setup('Support user setup failed safely. No credentials were printed.');
}