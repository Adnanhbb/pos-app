<?php

declare(strict_types=1);

function crud_list(PDO $pdo, string $table, array $columns = ['*'], bool $includeDeleted = false): array
{
    $columnSql = crud_columns_sql($columns);
    $sql = "SELECT {$columnSql} FROM " . crud_identifier($table);

    if (!$includeDeleted) {
        $sql .= ' WHERE is_deleted = 0';
    }

    $sql .= ' ORDER BY id DESC';

    $statement = $pdo->prepare($sql);
    $statement->execute();

    return array_map('crud_normalize_row', $statement->fetchAll());
}

function crud_get_by_id(PDO $pdo, string $table, string $id, array $columns = ['*'], bool $includeDeleted = false): ?array
{
    $columnSql = crud_columns_sql($columns);
    $sql = "SELECT {$columnSql} FROM " . crud_identifier($table) . ' WHERE id = :id';

    if (!$includeDeleted) {
        $sql .= ' AND is_deleted = 0';
    }

    $sql .= ' LIMIT 1';

    $statement = $pdo->prepare($sql);
    $statement->execute(['id' => $id]);
    $row = $statement->fetch();

    return $row ? crud_normalize_row($row) : null;
}

function crud_create(PDO $pdo, string $table, array $data, array $allowedFields): array
{
    $filtered = crud_filter_data($data, $allowedFields);

    if ($filtered === []) {
        throw new InvalidArgumentException('No valid fields were provided.');
    }

    $columns = array_keys($filtered);
    $placeholders = array_map(
        static fn (string $column): string => ':' . $column,
        $columns
    );

    $sql = 'INSERT INTO ' . crud_identifier($table)
        . ' (' . implode(', ', array_map('crud_identifier', $columns)) . ')'
        . ' VALUES (' . implode(', ', $placeholders) . ')';

    $statement = $pdo->prepare($sql);
    $statement->execute($filtered);

    return crud_get_by_id($pdo, $table, (string) $pdo->lastInsertId(), ['*'], true);
}

function crud_update(PDO $pdo, string $table, string $id, array $data, array $allowedFields): ?array
{
    $filtered = crud_filter_data($data, $allowedFields);

    if ($filtered === []) {
        throw new InvalidArgumentException('No valid fields were provided.');
    }

    $assignments = [];

    foreach (array_keys($filtered) as $column) {
        $assignments[] = crud_identifier($column) . ' = :' . $column;
    }

    $filtered['id'] = $id;

    $sql = 'UPDATE ' . crud_identifier($table)
        . ' SET ' . implode(', ', $assignments)
        . ' WHERE id = :id AND is_deleted = 0';

    $statement = $pdo->prepare($sql);
    $statement->execute($filtered);

    if ($statement->rowCount() === 0) {
        return crud_get_by_id($pdo, $table, $id);
    }

    return crud_get_by_id($pdo, $table, $id);
}

function crud_soft_delete(PDO $pdo, string $table, string $id): ?array
{
    $sql = 'UPDATE ' . crud_identifier($table)
        . ' SET is_deleted = 1, deleted_at = NOW()'
        . ' WHERE id = :id AND is_deleted = 0';

    $statement = $pdo->prepare($sql);
    $statement->execute(['id' => $id]);

    return crud_get_by_id($pdo, $table, $id, ['*'], true);
}

function crud_filter_data(array $data, array $allowedFields): array
{
    $filtered = [];

    foreach ($allowedFields as $field) {
        if (array_key_exists($field, $data)) {
            $filtered[$field] = $data[$field];
        }
    }

    return $filtered;
}

function crud_normalize_row(array $row): array
{
    if (array_key_exists('id', $row)) {
        $row['serverId'] = $row['id'];
    }

    return $row;
}

function crud_columns_sql(array $columns): string
{
    if ($columns === ['*']) {
        return '*';
    }

    return implode(', ', array_map('crud_identifier', $columns));
}

function crud_identifier(string $identifier): string
{
    if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $identifier)) {
        throw new InvalidArgumentException('Invalid SQL identifier.');
    }

    return '`' . $identifier . '`';
}

function crud_is_duplicate_key_error(PDOException $exception): bool
{
    return $exception->getCode() === '23000';
}

