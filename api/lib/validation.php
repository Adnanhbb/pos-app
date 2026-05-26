<?php

declare(strict_types=1);

function require_fields(array $data, array $fields): array
{
    $errors = [];

    foreach ($fields as $field) {
        if (!array_key_exists($field, $data)) {
            $errors[$field] = 'This field is required.';
            continue;
        }

        $value = $data[$field];

        if ($value === null || (is_string($value) && trim($value) === '')) {
            $errors[$field] = 'This field cannot be empty.';
        }
    }

    return $errors;
}

