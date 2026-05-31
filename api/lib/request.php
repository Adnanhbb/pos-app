<?php

declare(strict_types=1);

function get_json_body(): array
{
    $rawBody = file_get_contents('php://input');

    if ($rawBody === false || trim($rawBody) === '') {
        return [];
    }

    $decoded = json_decode($rawBody, true);

    if (!is_array($decoded)) {
        if (function_exists('error_response')) {
            error_response('Malformed JSON.', 400, [
                'json' => json_last_error_msg(),
            ]);
        }

        http_response_code(400);
        header('Content-Type: application/json; charset=utf-8');
        echo json_encode([
            'success' => false,
            'message' => 'Malformed JSON.',
            'details' => [
                'json' => json_last_error_msg(),
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        exit;
    }

    return $decoded;
}

function get_request_method(): string
{
    return strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
}

function get_query_id(): ?string
{
    if (!isset($_GET['id'])) {
        return null;
    }

    $id = trim((string) $_GET['id']);

    return $id === '' ? null : $id;
}

function get_query_flag(string $name): bool
{
    if (!isset($_GET[$name])) {
        return false;
    }

    return in_array(strtolower(trim((string) $_GET[$name])), ['1', 'true', 'yes', 'on'], true);
}