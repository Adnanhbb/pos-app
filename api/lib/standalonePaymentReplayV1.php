<?php

declare(strict_types=1);

require_once __DIR__ . '/transactionReplayProcessor.php';

/*
 * Narrow standalone payment replay bridge.
 *
 * This adapter accepts only standalone Customer/Supplier Payment replay v1
 * create contracts. Local IndexedDB ids are retained as correlation metadata
 * only; MySQL mutations use explicit backend customer/supplier server ids.
 */

class StandalonePaymentReplayV1Exception extends RuntimeException
{
}

function replayStoredStandaloneCustomerPaymentV1Authorized(PDO $pdo, int|string $syncTransactionId, array $authContext): array
{
    return replayStoredStandalonePaymentV1Authorized($pdo, $syncTransactionId, $authContext, 'customer');
}

function replayStoredStandaloneSupplierPaymentV1Authorized(PDO $pdo, int|string $syncTransactionId, array $authContext): array
{
    return replayStoredStandalonePaymentV1Authorized($pdo, $syncTransactionId, $authContext, 'supplier');
}

function replayStoredStandalonePaymentV1Authorized(
    PDO $pdo,
    int|string $syncTransactionId,
    array $authContext,
    string $partyType
): array {
    try {
        $auth = require_replay_auth_context($authContext);
    } catch (ApiAuthException $exception) {
        unset($exception);
        return [
            'success' => false,
            'reason' => 'unauthorized',
            'authorized' => false,
            'syncTransactionId' => (int) $syncTransactionId,
        ];
    }

    $workerId = replay_worker_id_from_auth_context($auth);
    setTransactionReplayAuditActor($auth);

    try {
        $result = replayStoredStandalonePaymentV1($pdo, $syncTransactionId, $workerId, $partyType);
        $result['authorized'] = true;
        return $result;
    } finally {
        setTransactionReplayAuditActor(null);
    }
}

function replayStoredStandalonePaymentV1(
    PDO $pdo,
    int|string $syncTransactionId,
    string $workerId,
    string $partyType
): array {
    $id = (int) $syncTransactionId;
    $worker = trim($workerId);
    $party = standalonePaymentV1Party($partyType);

    if ($id <= 0 || $worker === '') {
        return ['success' => false, 'reason' => 'invalid_arguments'];
    }

    $existingRow = getReplayProcessorTransactionRow($pdo, $id);
    if ($existingRow === null) {
        return ['success' => false, 'reason' => 'not_found'];
    }

    try {
        normalizeStoredStandalonePaymentV1Payload($existingRow, $party);
    } catch (Throwable $exception) {
        return [
            'success' => false,
            'reason' => standalonePaymentV1InvalidReason($party),
            'syncTransactionId' => $id,
            'clientTransactionId' => (string) ($existingRow['client_transaction_id'] ?? ''),
            'error' => $exception->getMessage(),
        ];
    }

    $terminalResult = skipReplayTerminalStateIfNeeded($pdo, $id, $existingRow);
    if ($terminalResult !== null) {
        $terminalResult['standalonePaymentReplayContract'] = standalonePaymentV1ContractName($party);
        $terminalResult['payloadVersion'] = 1;
        $terminalResult['partyType'] = $party;
        return $terminalResult;
    }

    $lock = acquireReplayLock($pdo, $id, $worker);
    if (($lock['success'] ?? false) !== true) {
        return [
            'success' => false,
            'reason' => $lock['reason'] ?? 'lock_not_acquired',
            'syncTransactionId' => $id,
            'lock' => $lock,
        ];
    }

    $transactionStarted = false;
    $clientTransactionId = (string) ($existingRow['client_transaction_id'] ?? '');

    try {
        $pdo->beginTransaction();
        $transactionStarted = true;

        $row = getReplayProcessorTransactionRowForUpdate($pdo, $id);
        if ($row === null) {
            throw new StandalonePaymentReplayV1Exception('Stored transaction row was not found during standalone Payment replay.');
        }

        $clientTransactionId = (string) ($row['client_transaction_id'] ?? '');
        $normalized = normalizeStoredStandalonePaymentV1Payload($row, $party);
        $normalized['syncTransactionId'] = $id;
        $eventPrefix = standalonePaymentV1EventPrefix($party);

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            $eventPrefix . '_validation_started',
            'processing',
            'processing',
            'Standalone Payment v1 replay validation started before any business mutation.'
        );

        validateStandalonePaymentV1DatabaseState($pdo, $normalized);
        $mutationResult = applyStandalonePaymentV1Mutation($pdo, $id, $clientTransactionId, $normalized);

        insertTransactionReplayAuditEvent(
            $pdo,
            $id,
            $clientTransactionId,
            $eventPrefix . '_replay_completed',
            'processing',
            'processing',
            'Standalone Payment v1 replay business mutations completed atomically.'
        );

        $pdo->commit();
        $transactionStarted = false;

        $release = releaseReplayLock($pdo, $id, $worker, 'committed', null);
        if (($release['success'] ?? false) !== true) {
            return [
                'success' => false,
                'reason' => 'release_failed_after_replay',
                'syncTransactionId' => $id,
                'clientTransactionId' => $clientTransactionId,
            ];
        }

        return [
            'success' => true,
            'syncTransactionId' => $id,
            'clientTransactionId' => $clientTransactionId,
            'standalonePaymentReplayContract' => standalonePaymentV1ContractName($party),
            'payloadVersion' => 1,
            'partyType' => $party,
            'replayStatus' => 'committed',
            'alreadyCommitted' => false,
            'businessMutationsApplied' => true,
            'paymentId' => (int) $mutationResult['paymentId'],
            'partyId' => (int) $mutationResult['partyId'],
            'amount' => (float) $mutationResult['amount'],
            'clientPaymentId' => (string) $normalized['clientPaymentId'],
        ];
    } catch (Throwable $exception) {
        if ($transactionStarted && $pdo->inTransaction()) {
            $pdo->rollBack();
        }

        try {
            insertTransactionReplayAuditEvent(
                $pdo,
                $id,
                $clientTransactionId,
                standalonePaymentV1EventPrefix($party) . '_replay_failed',
                'processing',
                'failed',
                'Standalone Payment v1 replay failed. Any business mutations were rolled back.'
            );
        } catch (Throwable $auditException) {
            unset($auditException);
        }

        $release = releaseReplayLock($pdo, $id, $worker, 'failed', $exception->getMessage());

        return [
            'success' => false,
            'reason' => $exception instanceof StandalonePaymentReplayV1Exception
                ? standalonePaymentV1InvalidReason($party)
                : 'standalone_payment_replay_failed',
            'syncTransactionId' => $id,
            'clientTransactionId' => $clientTransactionId,
            'error' => $exception->getMessage(),
            'release' => $release,
        ];
    }
}

function normalizeStoredStandalonePaymentV1Payload(array $row, string $partyType): array
{
    try {
        $storedPayload = validateReplaySkeletonPayload($row);
    } catch (Throwable $exception) {
        throw new StandalonePaymentReplayV1Exception($exception->getMessage(), 0, $exception);
    }

    if (($storedPayload['transactionType'] ?? null) !== 'payment') {
        throw new StandalonePaymentReplayV1Exception('Only outer transactionType payment is supported.');
    }

    $transactionPayload = $storedPayload['payload'];
    if (($transactionPayload['partyType'] ?? null) !== $partyType) {
        throw new StandalonePaymentReplayV1Exception('Stored payment partyType does not match replay endpoint.');
    }

    validateStandalonePaymentV1Readiness(
        $storedPayload['replayReadiness'] ?? null,
        standalonePaymentV1ReadinessScope($partyType),
        'Stored transaction'
    );

    $contractKey = standalonePaymentV1ContractName($partyType);
    $contract = $transactionPayload[$contractKey] ?? null;
    if (!is_array($contract) || array_is_list($contract)) {
        throw new StandalonePaymentReplayV1Exception("Stored transaction is missing $contractKey v1 contract.");
    }

    if (($contract['payloadVersion'] ?? null) !== 1) {
        throw new StandalonePaymentReplayV1Exception('Only standalone Payment payloadVersion 1 is supported.');
    }
    if (($contract['operation'] ?? null) !== 'create') {
        throw new StandalonePaymentReplayV1Exception('Standalone Payment replay supports create only.');
    }
    if (($contract['partyType'] ?? null) !== $partyType) {
        throw new StandalonePaymentReplayV1Exception('Standalone Payment contract partyType is unsupported.');
    }
    if (($contract['clientTransactionId'] ?? null) !== ($storedPayload['clientTransactionId'] ?? null)) {
        throw new StandalonePaymentReplayV1Exception('Standalone Payment clientTransactionId does not match stored transaction.');
    }

    validateStandalonePaymentV1Readiness(
        $contract['replayReadiness'] ?? null,
        standalonePaymentV1ReadinessScope($partyType),
        'Standalone Payment contract'
    );

    $partyKey = $partyType === 'customer' ? 'customer' : 'supplier';
    $party = $contract[$partyKey] ?? null;
    if (!is_array($party) || array_is_list($party)) {
        throw new StandalonePaymentReplayV1Exception("Standalone Payment $partyKey mapping must be an object.");
    }

    $payment = $contract['payment'] ?? null;
    if (!is_array($payment) || array_is_list($payment)) {
        throw new StandalonePaymentReplayV1Exception('Standalone Payment payment details must be an object.');
    }

    $legacyPayment = $transactionPayload['payment'] ?? null;
    if (!is_array($legacyPayment) || array_is_list($legacyPayment)) {
        throw new StandalonePaymentReplayV1Exception('Stored standalone Payment is missing its payment row.');
    }

    $amount = standalonePaymentV1PositiveNumber($payment['amount'] ?? null, 'payment.amount');
    $paymentDate = standalonePaymentV1RequiredString($payment['paymentDate'] ?? null, 'payment.paymentDate');

    if (isset($legacyPayment['amount']) && abs((float) $legacyPayment['amount'] - $amount) > 0.000001) {
        throw new StandalonePaymentReplayV1Exception('Standalone Payment amount does not match stored payment row.');
    }
    if (isset($legacyPayment['paymentDate']) && trim((string) $legacyPayment['paymentDate']) !== $paymentDate) {
        throw new StandalonePaymentReplayV1Exception('Standalone Payment date does not match stored payment row.');
    }

    return [
        'partyType' => $partyType,
        'paymentTable' => $partyType === 'customer' ? 'customer_payments' : 'supplier_payments',
        'partyTable' => $partyType === 'customer' ? 'customers' : 'suppliers',
        'partyIdColumn' => $partyType === 'customer' ? 'customerId' : 'supplierId',
        'partyNameColumn' => $partyType === 'customer' ? 'customerName' : 'supplierName',
        'clientTransactionId' => (string) $storedPayload['clientTransactionId'],
        'clientPaymentId' => standalonePaymentV1RequiredString($contract['clientPaymentId'] ?? null, 'clientPaymentId'),
        'localPaymentId' => standalonePaymentV1RequiredId($contract['localPaymentId'] ?? null, 'localPaymentId'),
        'party' => [
            'serverId' => standalonePaymentV1RequiredId($party['serverId'] ?? null, "$partyKey.serverId"),
            'nameSnapshot' => standalonePaymentV1OptionalString($party['nameSnapshot'] ?? ''),
        ],
        'payment' => [
            'amount' => $amount,
            'paymentDate' => $paymentDate,
            'remarks' => standalonePaymentV1OptionalString($payment['remarks'] ?? ''),
            'invoiceNo' => standalonePaymentV1OptionalString($payment['invoiceNo'] ?? ''),
            'payableSnapshot' => standalonePaymentV1FiniteNumber($payment['payableSnapshot'] ?? null, 'payment.payableSnapshot'),
            'balanceSnapshot' => standalonePaymentV1FiniteNumber($payment['balanceSnapshot'] ?? null, 'payment.balanceSnapshot'),
        ],
    ];
}

function validateStandalonePaymentV1Readiness($readiness, string $scope, string $label): void
{
    if (!is_array($readiness) || array_is_list($readiness)) {
        throw new StandalonePaymentReplayV1Exception("$label replayReadiness is missing.");
    }
    if (($readiness['scope'] ?? null) !== $scope || ($readiness['payloadVersion'] ?? null) !== 1) {
        throw new StandalonePaymentReplayV1Exception("$label replayReadiness contract is unsupported.");
    }
    if (($readiness['status'] ?? null) !== 'ready') {
        throw new StandalonePaymentReplayV1Exception("$label is not replay-ready.");
    }
    if (!isset($readiness['reasons']) || !is_array($readiness['reasons']) || $readiness['reasons'] !== []) {
        throw new StandalonePaymentReplayV1Exception("$label replayReadiness reasons must be empty.");
    }
}

function validateStandalonePaymentV1DatabaseState(PDO $pdo, array $normalized): void
{
    if (!replayTableExists($pdo, $normalized['paymentTable'])) {
        throw new StandalonePaymentReplayV1Exception('Payment ledger table is unavailable.');
    }

    standalonePaymentV1PartyRowForUpdate($pdo, $normalized);

    $statement = $pdo->prepare(
        "SELECT `id`
         FROM `{$normalized['paymentTable']}`
         WHERE `sync_transaction_id` = :sync_transaction_id
            OR `client_transaction_id` = :client_transaction_id
         LIMIT 1
         FOR UPDATE"
    );
    $statement->execute([
        'sync_transaction_id' => (int) ($normalized['syncTransactionId'] ?? 0),
        'client_transaction_id' => $normalized['clientTransactionId'],
    ]);

    if ($statement->fetch()) {
        throw new StandalonePaymentReplayV1Exception('Standalone Payment already has a backend payment row.');
    }
}

function applyStandalonePaymentV1Mutation(PDO $pdo, int $syncTransactionId, string $clientTransactionId, array $normalized): array
{
    $normalized['syncTransactionId'] = $syncTransactionId;
    $partyRow = standalonePaymentV1PartyRowForUpdate($pdo, $normalized);
    $partyId = (int) $partyRow['id'];
    $amount = (float) $normalized['payment']['amount'];
    $partyName = $normalized['party']['nameSnapshot'] !== ''
        ? $normalized['party']['nameSnapshot']
        : (string) ($partyRow['name'] ?? '');

    $newPaid = (float) ($partyRow['paid'] ?? 0) + $amount;
    $newBalance = (float) ($partyRow['balance'] ?? 0) - $amount;

    $paymentStatement = $pdo->prepare(
        "INSERT INTO `{$normalized['paymentTable']}`
            (`{$normalized['partyIdColumn']}`, `{$normalized['partyNameColumn']}`, `invoiceNo`, `amount`, `paymentDate`, `remarks`, `payableSnapshot`, `balanceSnapshot`, `sync_transaction_id`, `client_transaction_id`, `sale_id`, `source`)
         VALUES
            (:party_id, :party_name, :invoice_no, :amount, :payment_date, :remarks, :payable_snapshot, :balance_snapshot, :sync_transaction_id, :client_transaction_id, NULL, 'standalone_payment_replay')"
    );
    $paymentStatement->execute([
        'party_id' => $partyId,
        'party_name' => $partyName,
        'invoice_no' => $normalized['payment']['invoiceNo'],
        'amount' => $amount,
        'payment_date' => $normalized['payment']['paymentDate'],
        'remarks' => $normalized['payment']['remarks'],
        'payable_snapshot' => $normalized['payment']['payableSnapshot'],
        'balance_snapshot' => $normalized['payment']['balanceSnapshot'],
        'sync_transaction_id' => $syncTransactionId,
        'client_transaction_id' => $clientTransactionId,
    ]);

    $paymentId = (int) $pdo->lastInsertId();
    if ($paymentId <= 0) {
        throw new StandalonePaymentReplayV1Exception('Standalone Payment persistence did not return an id.');
    }

    $partyStatement = $pdo->prepare(
        "UPDATE `{$normalized['partyTable']}`
         SET `paid` = :paid,
             `balance` = :balance
         WHERE `id` = :id
           AND `is_deleted` = 0"
    );
    $partyStatement->execute([
        'paid' => $newPaid,
        'balance' => $newBalance,
        'id' => $partyId,
    ]);

    if ($partyStatement->rowCount() !== 1) {
        throw new StandalonePaymentReplayV1Exception('Standalone Payment party accounting update failed.');
    }

    return [
        'paymentId' => $paymentId,
        'partyId' => $partyId,
        'amount' => $amount,
    ];
}

function standalonePaymentV1PartyRowForUpdate(PDO $pdo, array $normalized): array
{
    $statement = $pdo->prepare(
        "SELECT `id`, `name`, `payable`, `paid`, `balance`
         FROM `{$normalized['partyTable']}`
         WHERE `id` = :id
           AND `is_deleted` = 0
         LIMIT 1
         FOR UPDATE"
    );
    $statement->execute(['id' => (int) $normalized['party']['serverId']]);
    $row = $statement->fetch();

    if (!$row) {
        throw new StandalonePaymentReplayV1Exception('Mapped backend payment party does not exist.');
    }

    return $row;
}

function standalonePaymentV1Party(string $partyType): string
{
    $party = strtolower(trim($partyType));
    if (!in_array($party, ['customer', 'supplier'], true)) {
        throw new StandalonePaymentReplayV1Exception('Unsupported standalone Payment party type.');
    }

    return $party;
}

function standalonePaymentV1ContractName(string $partyType): string
{
    return $partyType === 'customer'
        ? 'standaloneCustomerPaymentReplay'
        : 'standaloneSupplierPaymentReplay';
}

function standalonePaymentV1ReadinessScope(string $partyType): string
{
    return $partyType === 'customer'
        ? 'standalone_customer_payment'
        : 'standalone_supplier_payment';
}

function standalonePaymentV1EventPrefix(string $partyType): string
{
    return $partyType === 'customer'
        ? 'standalone_customer_payment_v1'
        : 'standalone_supplier_payment_v1';
}

function standalonePaymentV1InvalidReason(string $partyType): string
{
    return $partyType === 'customer'
        ? 'invalid_standalone_customer_payment_contract'
        : 'invalid_standalone_supplier_payment_contract';
}

function standalonePaymentV1RequiredId($value, string $field): int
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new StandalonePaymentReplayV1Exception("Required standalone Payment field $field is missing.");
    }
    $id = (int) $value;
    if ($id <= 0 || (string) $id !== trim((string) $value)) {
        throw new StandalonePaymentReplayV1Exception("Required standalone Payment field $field is invalid.");
    }
    return $id;
}

function standalonePaymentV1RequiredString($value, string $field): string
{
    $string = trim((string) ($value ?? ''));
    if ($string === '') {
        throw new StandalonePaymentReplayV1Exception("Required standalone Payment field $field is missing.");
    }
    return $string;
}

function standalonePaymentV1OptionalString($value): string
{
    return trim((string) ($value ?? ''));
}

function standalonePaymentV1PositiveNumber($value, string $field): float
{
    $number = standalonePaymentV1FiniteNumber($value, $field);
    if ($number <= 0) {
        throw new StandalonePaymentReplayV1Exception("Required standalone Payment field $field must be greater than zero.");
    }
    return $number;
}

function standalonePaymentV1FiniteNumber($value, string $field): float
{
    if ($value === null || $value === '' || !is_numeric($value)) {
        throw new StandalonePaymentReplayV1Exception("Required standalone Payment field $field must be numeric.");
    }
    $number = (float) $value;
    if (!is_finite($number)) {
        throw new StandalonePaymentReplayV1Exception("Required standalone Payment field $field is invalid.");
    }
    return $number;
}
