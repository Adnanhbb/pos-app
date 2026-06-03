<?php

declare(strict_types=1);

require_once __DIR__ . '/../config/cors.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../lib/request.php';
require_once __DIR__ . '/../lib/response.php';
require_once __DIR__ . '/../lib/auth.php';
require_once __DIR__ . '/../lib/finalizedPurchaseReplayV1.php';

try {
    if (get_request_method() !== 'POST') {
        error_response('Method not allowed.', 405);
    }

    $pdo = get_pdo();
    $auth = require_replay_request_auth($pdo);
    $body = get_json_body();
    $clientTransactionId = trim((string) ($body['clientTransactionId'] ?? ''));

    if ($clientTransactionId === '') {
        error_response('Validation failed.', 422, [
            'clientTransactionId' => 'This field is required.',
        ]);
    }

    $statement = $pdo->prepare(
        'SELECT `id`
         FROM `sync_transactions`
         WHERE `client_transaction_id` = :client_transaction_id
         LIMIT 1'
    );
    $statement->execute(['client_transaction_id' => $clientTransactionId]);
    $syncTransactionId = (int) (($statement->fetch()['id'] ?? 0));

    if ($syncTransactionId <= 0) {
        error_response('Stored transaction was not found.', 404);
    }

    $result = replayStoredFinalizedPurchaseV1Authorized($pdo, $syncTransactionId, $auth);
    if (($result['success'] ?? false) !== true) {
        $reason = (string) ($result['reason'] ?? 'finalized_purchase_replay_failed');
        $status = $reason === 'unauthorized' ? 401 : ($reason === 'not_found' ? 404 : 422);
        error_response('Finalized Purchase replay was rejected safely.', $status, [
            'reason' => $reason,
            'syncTransactionId' => $syncTransactionId,
            'clientTransactionId' => $clientTransactionId,
        ]);
    }

    success_response([
        'syncTransactionId' => (int) $result['syncTransactionId'],
        'clientTransactionId' => (string) $result['clientTransactionId'],
        'purchaseReplayContract' => 'finalizedPurchaseReplay',
        'payloadVersion' => 1,
        'replayStatus' => (string) ($result['replayStatus'] ?? ''),
        'alreadyCommitted' => ($result['alreadyCommitted'] ?? false) === true,
        'businessMutationsApplied' => ($result['businessMutationsApplied'] ?? false) === true,
        'purchaseId' => isset($result['purchaseId']) ? (int) $result['purchaseId'] : null,
        'invoiceNo' => isset($result['invoiceNo']) ? (string) $result['invoiceNo'] : null,
        'saleItemsInserted' => isset($result['saleItemsInserted']) ? (int) $result['saleItemsInserted'] : 0,
        'batchesCreated' => isset($result['batchesCreated']) ? (int) $result['batchesCreated'] : 0,
    ]);
} catch (ApiAuthException $exception) {
    unset($exception);
    unauthorized_response('Unauthorized replay request.');
} catch (Throwable $exception) {
    unset($exception);
    error_response('Server error.', 500);
}

