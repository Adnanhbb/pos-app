<?php

declare(strict_types=1);

/*
 * Optional API auth audit mode for CRUD endpoints.
 *
 * By default this does not enforce authentication. It parses a bearer token
 * when one is present, resolves safe actor metadata when valid, emits safe
 * response headers for dev/test visibility, and writes a safe PHP error_log
 * entry. Set CRUD_AUTH_ENFORCEMENT=true/on/1 to reject missing or invalid
 * auth for protected CRUD endpoints.
 */

require_once __DIR__ . '/auth.php';

function optional_api_auth_context(PDO $pdo): array
{
    $token = get_bearer_token_from_request();

    if ($token === null || trim($token) === '') {
        return [
            'authStatus' => 'absent',
            'authenticated' => false,
        ];
    }

    $auth = authenticate_api_bearer_token($pdo, $token);

    if (($auth['authenticated'] ?? false) === true) {
        return [
            'authStatus' => 'valid',
            'authenticated' => true,
            'actorType' => (string) ($auth['actorType'] ?? ''),
            'actorId' => (string) ($auth['actorId'] ?? ''),
            'actorRole' => (string) ($auth['actorRole'] ?? ''),
            'sessionId' => isset($auth['sessionId']) && $auth['sessionId'] !== null ? (string) $auth['sessionId'] : null,
            'source' => isset($auth['source']) ? (string) $auth['source'] : null,
        ];
    }

    return [
        'authStatus' => 'invalid',
        'authenticated' => false,
        'reason' => (string) ($auth['reason'] ?? 'invalid_bearer_token'),
    ];
}

function initialize_optional_crud_auth_audit(PDO $pdo, string $endpoint, string $method): array
{
    $context = optional_api_auth_context($pdo);
    $context['enforcementEnabled'] = is_crud_auth_enforcement_enabled();

    attach_optional_auth_audit_headers($context);
    log_optional_auth_audit($endpoint, $method, $context);

    if (should_reject_crud_request_for_auth($context)) {
        reject_crud_request_for_auth($context);
    }

    return $context;
}

function is_crud_auth_enforcement_enabled(): bool
{
    $raw = getenv('CRUD_AUTH_ENFORCEMENT');

    if ($raw === false || trim((string) $raw) === '') {
        $raw = $_SERVER['CRUD_AUTH_ENFORCEMENT'] ?? $_ENV['CRUD_AUTH_ENFORCEMENT'] ?? '';
    }

    $value = strtolower(trim((string) $raw));
    return in_array($value, ['1', 'true', 'on', 'yes', 'enabled', 'enforced'], true);
}

function should_reject_crud_request_for_auth(array $context): bool
{
    if (($context['enforcementEnabled'] ?? false) !== true) {
        return false;
    }

    return ($context['authStatus'] ?? 'absent') !== 'valid';
}

function reject_crud_request_for_auth(array $context): void
{
    $status = (string) ($context['authStatus'] ?? 'absent');
    $message = $status === 'invalid' ? 'Invalid authentication token.' : 'Authentication required.';
    $details = [
        'authStatus' => $status,
        'enforcement' => 'enabled',
    ];

    if (function_exists('error_response')) {
        error_response($message, 401, $details);
    }

    http_response_code(401);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'success' => false,
        'message' => $message,
        'details' => $details,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function attach_optional_auth_audit_headers(array $context): void
{
    if (headers_sent()) {
        return;
    }

    $status = sanitize_auth_header_value((string) ($context['authStatus'] ?? 'absent'));
    $enforcement = !empty($context['enforcementEnabled']) ? 'enabled' : 'disabled';
    header('X-Auth-Audit-Mode: optional');
    header('X-Auth-Enforcement: ' . $enforcement);
    header('X-Auth-Status: ' . $status);

    if ($status === 'valid') {
        header('X-Auth-Actor-Type: ' . sanitize_auth_header_value((string) ($context['actorType'] ?? '')));
        header('X-Auth-Actor-Id: ' . sanitize_auth_header_value((string) ($context['actorId'] ?? '')));
        header('X-Auth-Actor-Role: ' . sanitize_auth_header_value((string) ($context['actorRole'] ?? '')));
    }
}

function log_optional_auth_audit(string $endpoint, string $method, array $context): void
{
    $entry = [
        'event' => 'crud_auth_audit',
        'mode' => 'optional',
        'enforcement' => !empty($context['enforcementEnabled']) ? 'enabled' : 'disabled',
        'endpoint' => basename($endpoint),
        'method' => strtoupper($method),
        'authStatus' => (string) ($context['authStatus'] ?? 'absent'),
    ];

    if (($context['authStatus'] ?? null) === 'valid') {
        $entry['actorType'] = (string) ($context['actorType'] ?? '');
        $entry['actorId'] = (string) ($context['actorId'] ?? '');
        $entry['actorRole'] = (string) ($context['actorRole'] ?? '');
    }

    if (($context['authStatus'] ?? null) === 'invalid') {
        $entry['reason'] = (string) ($context['reason'] ?? 'invalid_bearer_token');
    }

    error_log(json_encode($entry, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
}

function sanitize_auth_header_value(string $value): string
{
    $value = preg_replace('/[^a-zA-Z0-9_.:@-]+/', '-', $value) ?? '';
    return substr(trim($value, '-'), 0, 150);
}
