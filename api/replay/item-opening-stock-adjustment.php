<?php

declare(strict_types=1);

require_once __DIR__ . '/../config/cors.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../lib/request.php';
require_once __DIR__ . '/../lib/response.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/mappedOpeningStockAdjustment.php';

try {
    if (get_request_method() !== 'POST') {
        error_response('Method not allowed.', 405);
    }

    $pdo = get_pdo();
    require_replay_request_auth($pdo);
    $result = adjustMappedOpeningStock($pdo, get_json_body());
    success_response($result);
} catch (ApiAuthException $exception) {
    unset($exception);
    unauthorized_response('Unauthorized replay request.');
} catch (MappedOpeningStockAdjustmentException $exception) {
    error_response($exception->getMessage(), 422);
} catch (Throwable $exception) {
    unset($exception);
    error_response('Server error.', 500);
}
