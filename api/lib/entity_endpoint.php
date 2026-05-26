<?php

declare(strict_types=1);

require_once __DIR__ . '/auth_audit.php';

function handle_entity_crud_endpoint(array $config): void
{
    $table = (string) $config['table'];
    $allowedFields = $config['allowedFields'];
    $requiredOnCreate = $config['requiredOnCreate'] ?? [];
    $entityLabel = $config['entityLabel'] ?? ucfirst($table);
    $method = get_request_method();
    $id = get_query_id();

    try {
        $pdo = get_pdo();
        initialize_optional_crud_auth_audit($pdo, $table . '.php', $method);

        if ($method === 'GET') {
            if ($id !== null) {
                $row = crud_get_by_id($pdo, $table, $id);

                if ($row === null) {
                    error_response($entityLabel . ' not found.', 404);
                }

                success_response(normalize_entity_response($row, $config));
            }

            success_response(array_map(
                static fn (array $row): array => normalize_entity_response($row, $config),
                crud_list($pdo, $table)
            ));
        }

        if ($method === 'POST') {
            $body = normalize_entity_payload(get_json_body(), $config);
            $errors = require_fields($body, $requiredOnCreate);

            if ($errors !== []) {
                error_response('Validation failed.', 422, $errors);
            }

            $row = crud_create($pdo, $table, $body, $allowedFields);
            success_response(normalize_entity_response($row, $config), 201);
        }

        if ($method === 'PUT' || $method === 'PATCH') {
            if ($id === null) {
                error_response($entityLabel . ' id is required.', 400);
            }

            $existing = crud_get_by_id($pdo, $table, $id);

            if ($existing === null) {
                error_response($entityLabel . ' not found.', 404);
            }

            $body = normalize_entity_payload(get_json_body(), $config);

            foreach ($requiredOnCreate as $field) {
                if (array_key_exists($field, $body)) {
                    $errors = require_fields($body, [$field]);

                    if ($errors !== []) {
                        error_response('Validation failed.', 422, $errors);
                    }
                }
            }

            $row = crud_update($pdo, $table, $id, $body, $allowedFields);

            if ($row === null) {
                error_response($entityLabel . ' not found.', 404);
            }

            success_response(normalize_entity_response($row, $config));
        }

        if ($method === 'DELETE') {
            if ($id === null) {
                error_response($entityLabel . ' id is required.', 400);
            }

            $existing = crud_get_by_id($pdo, $table, $id);

            if ($existing === null) {
                error_response($entityLabel . ' not found.', 404);
            }

            $row = crud_soft_delete($pdo, $table, $id);
            success_response(normalize_entity_response($row, $config));
        }

        error_response('Method not allowed.', 405);
    } catch (InvalidArgumentException $exception) {
        error_response($exception->getMessage(), 400);
    } catch (PDOException $exception) {
        if (crud_is_duplicate_key_error($exception)) {
            error_response('Duplicate client_id', 409);
        }

        error_response('Database error.', 500);
    } catch (Throwable $exception) {
        error_response('Server error.', 500);
    }
}

function normalize_entity_payload(array $body, array $config): array
{
    if (array_key_exists('localId', $body) && !array_key_exists('client_id', $body)) {
        $body['client_id'] = $body['localId'] === null ? null : (string) $body['localId'];
    }

    if (array_key_exists('client_id', $body) && $body['client_id'] !== null) {
        $body['client_id'] = (string) $body['client_id'];
    }

    foreach (($config['aliases'] ?? []) as $source => $target) {
        if (array_key_exists($source, $body) && !array_key_exists($target, $body)) {
            $body[$target] = $body[$source];
        }

        unset($body[$source]);
    }

    foreach (($config['trimFields'] ?? []) as $field) {
        if (array_key_exists($field, $body) && is_string($body[$field])) {
            $body[$field] = trim($body[$field]);
        }
    }

    foreach (($config['numericFields'] ?? []) as $field) {
        if (array_key_exists($field, $body)) {
            $body[$field] = (float) $body[$field];
        }
    }

    foreach (($config['intFields'] ?? []) as $field) {
        if (array_key_exists($field, $body)) {
            $body[$field] = max(0, (int) $body[$field]);
        }
    }

    if (isset($config['normalizer']) && is_callable($config['normalizer'])) {
        $body = $config['normalizer']($body);
    }

    return $body;
}

function normalize_entity_response(?array $row, array $config): ?array
{
    if ($row === null) {
        return null;
    }

    foreach (($config['numericFields'] ?? []) as $field) {
        if (array_key_exists($field, $row)) {
            $row[$field] = (float) $row[$field];
        }
    }

    foreach (($config['intFields'] ?? []) as $field) {
        if (array_key_exists($field, $row)) {
            $row[$field] = (int) $row[$field];
        }
    }

    if (isset($config['responseNormalizer']) && is_callable($config['responseNormalizer'])) {
        $row = $config['responseNormalizer']($row);
    }

    return $row;
}



