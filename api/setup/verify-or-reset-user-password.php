<?php

declare(strict_types=1);

/*
 * CLI-only production user password verification/reset support.
 *
 * Run through hosting SSH/terminal and remove this file after the supervised
 * support task. It uses the same API runtime configuration and never prints a
 * password, password hash, token, or database credential.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

require_once __DIR__ . '/../config/database.php';

function fail_password_support(string $message, int $exitCode = 1): never
{
    fwrite(STDERR, $message . PHP_EOL);
    exit($exitCode);
}

function prompt_password_support_value(string $label): string
{
    fwrite(STDOUT, $label . ': ');
    $value = fgets(STDIN);
    if ($value === false) {
        fail_password_support('Input could not be read.');
    }

    return trim($value);
}

function prompt_password_support_secret(string $label): string
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

    if ($value === false) {
        fail_password_support('Secret input could not be read.');
    }

    return rtrim($value, "\r\n");
}

function print_password_support_result(string $label, string|int|bool $value): void
{
    if (is_bool($value)) {
        $value = $value ? 'true' : 'false';
    }

    fwrite(STDOUT, $label . ': ' . $value . PHP_EOL);
}

$username = prompt_password_support_value('Username');
if ($username === '') {
    fail_password_support('Username is required.');
}

try {
    $pdo = get_pdo();
    $statement = $pdo->prepare(
        'SELECT `id`, `role`, `is_active`, `is_deleted`, `password_hash`
         FROM `users`
         WHERE `username` = :username
         LIMIT 1'
    );
    $statement->execute(['username' => $username]);
    $user = $statement->fetch();

    print_password_support_result('Username found', $user !== false);
    if (!$user) {
        exit(2);
    }

    $storedHash = (string) ($user['password_hash'] ?? '');
    print_password_support_result('Role', (string) ($user['role'] ?? ''));
    print_password_support_result('Active', (int) ($user['is_active'] ?? 0) === 1);
    print_password_support_result('Deleted', (int) ($user['is_deleted'] ?? 0) !== 0);
    print_password_support_result('Password hash present', $storedHash !== '');
    print_password_support_result('Password hash length', strlen($storedHash));

    $verifyChoice = strtolower(prompt_password_support_value('Verify current password now? [y/N]'));
    if (in_array($verifyChoice, ['y', 'yes'], true)) {
        $currentPassword = prompt_password_support_secret('Current password');
        print_password_support_result(
            'Password verification passed',
            $storedHash !== '' && password_verify($currentPassword, $storedHash)
        );
        unset($currentPassword);
    } else {
        fwrite(STDOUT, 'Password verification skipped.' . PHP_EOL);
    }

    $resetConfirmation = prompt_password_support_value(
        'Type RESET to replace this user password, or press Enter to exit'
    );
    if ($resetConfirmation !== 'RESET') {
        fwrite(STDOUT, 'Password reset applied: false' . PHP_EOL);
        exit(0);
    }

    $newPassword = prompt_password_support_secret('New password');
    $newPasswordConfirmation = prompt_password_support_secret('Confirm new password');

    if (!hash_equals($newPassword, $newPasswordConfirmation)) {
        fail_password_support('Passwords do not match. No changes were applied.');
    }
    if (strlen($newPassword) < 12) {
        fail_password_support('Password must be at least 12 characters. No changes were applied.');
    }

    $newHash = password_hash($newPassword, PASSWORD_DEFAULT);
    unset($newPassword, $newPasswordConfirmation);

    if (!is_string($newHash) || $newHash === '') {
        fail_password_support('Password hashing failed. No changes were applied.');
    }

    $update = $pdo->prepare(
        'UPDATE `users`
         SET `password_hash` = :password_hash
         WHERE `id` = :id'
    );
    $update->execute([
        'password_hash' => $newHash,
        'id' => $user['id'],
    ]);
    unset($newHash);

    print_password_support_result('Password reset applied', $update->rowCount() === 1);
    fwrite(STDOUT, 'Remove this support script from the production server now.' . PHP_EOL);
} catch (PDOException $exception) {
    unset($exception);
    fail_password_support('Database operation failed safely. No secrets were printed.');
} catch (Throwable $exception) {
    unset($exception);
    fail_password_support('Password support operation failed safely. No secrets were printed.');
}
