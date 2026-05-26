<?php

declare(strict_types=1);

function json_response($data, int $status = 200): void
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function success_response($data = null, int $status = 200): void
{
    json_response([
        'success' => true,
        'data' => $data,
    ], $status);
}

function error_response($message, int $status = 400, $details = null): void
{
    $payload = [
        'success' => false,
        'message' => $message,
    ];

    if ($details !== null) {
        $payload['details'] = $details;
    }

    json_response($payload, $status);
}

