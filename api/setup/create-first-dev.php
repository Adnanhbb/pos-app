<?php

declare(strict_types=1);

/*
 * One-time CLI-only production Dev account creator.
 *
 * Run through Hostinger SSH/terminal, then remove this file from the server.
 * It never prints the password or password hash and is blocked from web access.
 */

require_once __DIR__ . '/../config/database.php';

function fail_first_dev_setup(string $message, int $exitCode = 1): never
{
    fwrite(STDERR, $message . PHP_EOL);
    exit($exitCode);
}

function prompt_value(string $label, bool $required = true): string
{
    fwrite(STDOUT, $label . ': ');
    $value = fgets(STDIN);
    if ($value === false) {
        fail_first_dev_setup('Input could not be read.');
    }

    $value = trim($value);
    if ($required && $value === '') {
        fail_first_dev_setup($label . ' is required.');
    }

    return $value;
}

function prompt_secret(string $label): string
{
    fwrite(STDOUT, $label . ': ');
    $canHide = DIRECTORY_SEPARATOR === '/' && function_exists('shell_exec');

    if ($canHide) {
        shell_exec('stty -echo');
    }

    try {
        $value = fgets(STDIN);
    } finally {
        if ($canHide) {
            shell_exec('stty echo');
        }
        fwrite(STDOUT, PHP_EOL);
    }

    if ($value === false || trim($value) === '') {
        fail_first_dev_setup($label . ' is required.');
    }

    return rtrim($value, "\r\n");
}

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$username = prompt_value('Dev username');
$name = prompt_value('Display name');
$mobile = prompt_value('Mobile (optional)', false);
$password = prompt_secret('Password');
$passwordConfirmation = prompt_secret('Confirm password');

if (!hash_equals($password, $passwordConfirmation)) {
    fail_first_dev_setup('Passwords do not match.');
}

if (strlen($password) < 12) {
    fail_first_dev_setup('Password must be at least 12 characters.');
}

try {
    $pdo = get_pdo();

    $existingDev = $pdo->query(
        "SELECT `id` FROM `users`
         WHERE `role` = 'Dev' AND `is_deleted` = 0
         LIMIT 1"
    )->fetch();

    if ($existingDev) {
        fail_first_dev_setup('An active Dev user already exists. No changes were applied.');
    }

    $duplicate = $pdo->prepare(
        'SELECT `id` FROM `users`
         WHERE LOWER(`username`) = LOWER(:username)
         LIMIT 1'
    );
    $duplicate->execute(['username' => $username]);

    if ($duplicate->fetch()) {
        fail_first_dev_setup('That username already exists. No changes were applied.');
    }

    $passwordHash = password_hash($password, PASSWORD_DEFAULT);
    if (!is_string($passwordHash) || $passwordHash === '') {
        fail_first_dev_setup('Password hashing failed. No changes were applied.');
    }

    $insert = $pdo->prepare(
        'INSERT INTO `users`
            (`client_id`, `username`, `name`, `mobile`, `role`, `password_hash`, `is_active`, `is_deleted`)
         VALUES
            (:client_id, :username, :name, :mobile, :role, :password_hash, 1, 0)'
    );
    $insert->execute([
        'client_id' => 'support-' . bin2hex(random_bytes(8)),
        'username' => $username,
        'name' => $name,
        'mobile' => $mobile !== '' ? $mobile : null,
        'role' => 'Dev',
        'password_hash' => $passwordHash,
    ]);

    fwrite(STDOUT, 'Database-backed Dev user created successfully. Remove this setup file from the server now.' . PHP_EOL);
} catch (PDOException $exception) {
    unset($exception);
    fail_first_dev_setup('Database error while creating the Dev user. No credentials were printed.');
} catch (Throwable $exception) {
    unset($exception);
    fail_first_dev_setup('Dev user setup failed safely. No credentials were printed.');
}
