<?php

declare(strict_types=1);

require_once __DIR__ . '/../config/cors.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../lib/request.php';
require_once __DIR__ . '/../lib/response.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/manualItemOpeningStockMapping.php';

try {
    if (get_request_method() !== 'POST') {
        error_response('Method not allowed.', 405);
    }

    $pdo = get_pdo();
    require_replay_request_auth($pdo);
    $result = mapManualItemOpeningStock($pdo, get_json_body());

    success_response([
        'mappingContract' => 'manualItemOpeningStockMapping',
        ...$result,
    ]);
} catch (ApiAuthException $exception) {
    unset($exception);
    unauthorized_response('Unauthorized mapping request.');
} catch (ManualItemOpeningStockMappingException $exception) {
    error_response('Manual item/opening-stock mapping was rejected safely.', 422, [
        'reason' => $exception->getMessage(),
    ]);
} catch (Throwable $exception) {
    unset($exception);
    error_response('Server error.', 500);
}
