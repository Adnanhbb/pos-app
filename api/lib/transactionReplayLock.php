<?php

declare(strict_types=1);

$__transactionReplayAuditActor = null;
$__transactionReplayAuditActorColumns = null;

function setTransactionReplayAuditActor(?array $actor): void
{
    global $__transactionReplayAuditActor;
    $__transactionReplayAuditActor = $actor === null ? null : [
        'actor_type' => isset($actor['actorType']) ? substr((string) $actor['actorType'], 0, 50) : null,
        'actor_id' => isset($actor['actorId']) ? substr((string) $actor['actorId'], 0, 150) : null,
        'actor_role' => isset($actor['actorRole']) ? substr((string) $actor['actorRole'], 0, 80) : null,
        'session_id' => isset($actor['sessionId']) && $actor['sessionId'] !== null ? substr((string) $actor['sessionId'], 0, 150) : null,
    ];
}

function getTransactionReplayAuditActor(): ?array
{
    global $__transactionReplayAuditActor;
    return $__transactionReplayAuditActor;
}

function transactionReplayAuditHasActorColumns(PDO $pdo): bool
{
    global $__transactionReplayAuditActorColumns;
    if ($__transactionReplayAuditActorColumns !== null) {
        return $__transactionReplayAuditActorColumns;
    }

    try {
        $statement = $pdo->query("SHOW COLUMNS FROM transaction_replay_audit LIKE 'actor_type'");
        $__transactionReplayAuditActorColumns = (bool) $statement->fetch();
    } catch (Throwable $exception) {
        unset($exception);
        $__transactionReplayAuditActorColumns = false;
    }

    return $__transactionReplayAuditActorColumns;
}


/*
 * Transaction replay lock primitives.
 *
 * These helpers only manage replay metadata on sync_transactions and safe audit
 * events in transaction_replay_audit. They do not inspect payload_json and do
 * not mutate stock, accounting, payments, batches, cylinders, sales, or items.
 */

function acquireReplayLock(PDO $pdo, int|string $syncTransactionId, string $workerId): array
{
    $id = (int) $syncTransactionId;
    $worker = trim($workerId);

    if ($id <= 0 || $worker === '') {
        return [
            'success' => false,
            'reason' => 'invalid_arguments',
        ];
    }

    $row = getReplayLockTransactionRow($pdo, $id);

    if ($row === null) {
        return [
            'success' => false,
            'reason' => 'not_found',
        ];
    }

    $statusBefore = (string) ($row['replay_status'] ?? '');
    $clientTransactionId = (string) ($row['client_transaction_id'] ?? '');

    $statement = $pdo->prepare(
        'UPDATE `sync_transactions`
         SET `replay_status` = :processing_status,
             `replay_attempts` = `replay_attempts` + 1,
             `locked_at` = NOW(),
             `locked_by` = :worker_id,
             `replay_started_at` = NOW(),
             `replay_error` = NULL
         WHERE `id` = :id
           AND `replay_status` IN (\'stored\', \'failed\')
           AND (`locked_by` IS NULL OR `locked_by` = \'\')
           AND `locked_at` IS NULL'
    );
    $statement->execute([
        'processing_status' => 'processing',
        'worker_id' => $worker,
        'id' => $id,
    ]);

    if ($statement->rowCount() !== 1) {
        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'lock_acquire_failed',
            $statusBefore,
            $statusBefore,
            'Replay lock was not acquired. Row is not in a lockable state or is already locked.'
        );

        return [
            'success' => false,
            'reason' => 'not_lockable',
            'statusBefore' => $statusBefore,
        ];
    }

    insertTransactionReplayAuditEvent(
        $pdo,
        $id,
        $clientTransactionId,
        'lock_acquired',
        $statusBefore,
        'processing',
        'Replay lock acquired. No replay was executed.'
    );

    return [
        'success' => true,
        'statusBefore' => $statusBefore,
        'statusAfter' => 'processing',
    ];
}

function releaseReplayLock(
    PDO $pdo,
    int|string $syncTransactionId,
    string $workerId,
    ?string $finalStatus = null,
    ?string $error = null
): array {
    $id = (int) $syncTransactionId;
    $worker = trim($workerId);

    if ($id <= 0 || $worker === '') {
        return [
            'success' => false,
            'reason' => 'invalid_arguments',
        ];
    }

    $allowedFinalStatuses = [null, 'stored', 'failed', 'rolled_back', 'committed'];
    if (!in_array($finalStatus, $allowedFinalStatuses, true)) {
        return [
            'success' => false,
            'reason' => 'invalid_final_status',
        ];
    }

    $row = getReplayLockTransactionRow($pdo, $id);

    if ($row === null) {
        return [
            'success' => false,
            'reason' => 'not_found',
        ];
    }

    $statusBefore = (string) ($row['replay_status'] ?? '');
    $clientTransactionId = (string) ($row['client_transaction_id'] ?? '');
    $statusAfter = $finalStatus ?? $statusBefore;

    if (($row['locked_by'] ?? null) !== $worker) {
        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'lock_release_failed',
            $statusBefore,
            $statusBefore,
            'Replay lock was not released because worker ownership did not match.'
        );

        return [
            'success' => false,
            'reason' => 'worker_mismatch',
            'statusBefore' => $statusBefore,
        ];
    }

    $statement = $pdo->prepare(
        'UPDATE `sync_transactions`
         SET `replay_status` = :replay_status,
             `locked_at` = NULL,
             `locked_by` = NULL,
             `replay_finished_at` = NOW(),
             `replay_error` = :replay_error
         WHERE `id` = :id
           AND `locked_by` = :worker_id'
    );
    $statement->execute([
        'replay_status' => $statusAfter,
        'replay_error' => $error,
        'id' => $id,
        'worker_id' => $worker,
    ]);

    if ($statement->rowCount() !== 1) {
        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            'lock_release_failed',
            $statusBefore,
            $statusBefore,
            'Replay lock release update failed. No replay was executed.'
        );

        return [
            'success' => false,
            'reason' => 'release_failed',
            'statusBefore' => $statusBefore,
        ];
    }

    insertTransactionReplayAuditEvent(
        $pdo,
        $id,
        $clientTransactionId,
        'lock_released',
        $statusBefore,
        $statusAfter,
        'Replay lock released. No replay was executed.'
    );

    return [
        'success' => true,
        'statusBefore' => $statusBefore,
        'statusAfter' => $statusAfter,
    ];
}

function getReplayLockTransactionRow(PDO $pdo, int $syncTransactionId): ?array
{
    $statement = $pdo->prepare(
        'SELECT `id`, `client_transaction_id`, `replay_status`, `replay_attempts`, `locked_at`, `locked_by`
         FROM `sync_transactions`
         WHERE `id` = :id
         LIMIT 1'
    );
    $statement->execute([
        'id' => $syncTransactionId,
    ]);
    $row = $statement->fetch();

    return $row ?: null;
}

function insertTransactionReplayAuditEvent(
    PDO $pdo,
    int $syncTransactionId,
    string $clientTransactionId,
    string $eventType,
    ?string $statusBefore,
    ?string $statusAfter,
    string $message
): void {
    $actor = getTransactionReplayAuditActor();

    if ($actor !== null && transactionReplayAuditHasActorColumns($pdo)) {
        $statement = $pdo->prepare(
            'INSERT INTO transaction_replay_audit
                (sync_transaction_id, client_transaction_id, event_type, status_before, status_after, message, actor_type, actor_id, actor_role, session_id)
             VALUES
                (:sync_transaction_id, :client_transaction_id, :event_type, :status_before, :status_after, :message, :actor_type, :actor_id, :actor_role, :session_id)'
        );
        $statement->execute([
            'sync_transaction_id' => $syncTransactionId,
            'client_transaction_id' => $clientTransactionId,
            'event_type' => $eventType,
            'status_before' => $statusBefore,
            'status_after' => $statusAfter,
            'message' => $message,
            'actor_type' => $actor['actor_type'] ?? null,
            'actor_id' => $actor['actor_id'] ?? null,
            'actor_role' => $actor['actor_role'] ?? null,
            'session_id' => $actor['session_id'] ?? null,
        ]);
        return;
    }

    $statement = $pdo->prepare(
        'INSERT INTO transaction_replay_audit
            (sync_transaction_id, client_transaction_id, event_type, status_before, status_after, message)
         VALUES
            (:sync_transaction_id, :client_transaction_id, :event_type, :status_before, :status_after, :message)'
    );
    $statement->execute([
        'sync_transaction_id' => $syncTransactionId,
        'client_transaction_id' => $clientTransactionId,
        'event_type' => $eventType,
        'status_before' => $statusBefore,
        'status_after' => $statusAfter,
        'message' => $message,
    ]);
}
