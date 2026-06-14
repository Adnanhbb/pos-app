<?php

declare(strict_types=1);

/*
 * Runtime configuration lookup for shared hosting.
 *
 * Environment variables take precedence. api/config/private.php is an
 * optional, gitignored fallback for hosts that do not expose PHP environment
 * variables. The private file must return an associative array.
 */
function app_private_config(): array
{
    static $loaded = false;
    static $config = [];

    if ($loaded) {
        return $config;
    }

    $loaded = true;
    $path = __DIR__ . '/private.php';
    if (!is_file($path)) {
        return $config;
    }

    $loadedConfig = require $path;
    if (!is_array($loadedConfig)) {
        throw new RuntimeException('Private configuration is invalid.');
    }

    foreach ($loadedConfig as $key => $value) {
        if (!is_string($key) || (!is_scalar($value) && $value !== null)) {
            throw new RuntimeException('Private configuration is invalid.');
        }
        $config[$key] = $value;
    }

    return $config;
}

function app_config_value(string $key, mixed $default = null): mixed
{
    $environmentValue = getenv($key);
    if ($environmentValue !== false && trim((string) $environmentValue) !== '') {
        return $environmentValue;
    }

    foreach ([$_ENV, $_SERVER] as $source) {
        if (array_key_exists($key, $source) && trim((string) $source[$key]) !== '') {
            return $source[$key];
        }
    }

    $privateConfig = app_private_config();
    if (array_key_exists($key, $privateConfig)) {
        return $privateConfig[$key];
    }

    return $default;
}
