# Release Checkpoint: CRUD Auth Enforcement Flag Default Off

Suggested git tag: `crud-auth-enforcement-flag-default-off`

## Milestone Summary

This checkpoint records the configurable CRUD auth enforcement flag before enabling it in any environment.

The backend can now hard-enforce CRUD auth when explicitly configured, but the default behavior remains audit-only. This preserves existing low-risk sync and manual replay behavior while preparing for staged auth enforcement testing.

## Config Flag

The backend flag is:

```text
CRUD_AUTH_ENFORCEMENT
```

Default: off/audit-only.

Values treated as on:

- `1`
- `true`
- `on`
- `yes`
- `enabled`
- `enforced`

Missing, empty, false, or off-like values keep audit-only behavior.

## Behavior When Off

When `CRUD_AUTH_ENFORCEMENT` is off:

- missing auth is allowed and marked `absent`
- invalid auth is allowed and marked `invalid`
- valid auth is allowed and safe actor metadata is exposed
- existing CRUD sync behavior is preserved
- dev auth headers continue to show audit status

## Behavior When On

When `CRUD_AUTH_ENFORCEMENT` is on for protected CRUD endpoints:

- missing auth is rejected with safe `401`
- invalid auth is rejected with safe `401`
- valid auth proceeds
- response uses the existing JSON error shape
- auth errors include only safe metadata such as auth status and enforcement state

`health.php` remains public.

## Dev Headers

The auth audit/enforcement headers include:

- `X-Auth-Audit-Mode`
- `X-Auth-Enforcement`
- `X-Auth-Status`
- `X-Auth-Actor-Type`
- `X-Auth-Actor-Id`
- `X-Auth-Actor-Role`

`X-Auth-Enforcement` shows whether the request was handled with enforcement `enabled` or `disabled`.

## Safety Rules

Auth responses and logs must not leak:

- raw tokens
- token hashes
- payload bodies
- passwords
- password hashes
- full customer/supplier records
- full item bodies
- session secrets

## Verified Results

Latest verified results at this checkpoint:

- `test:crud:auth-audit` => `9 passed, 0 failed`
- `test:crud:auth-enforcement` => `9 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`
- `test:sync:real-low-risk` => `39 passed, 0 failed`

## Explicitly Not Enabled

This checkpoint does not enable hard enforcement by default.

Still not added:

- production CRUD auth enforcement
- auto-sync
- startup replay
- online/offline replay listeners
- polling or intervals
- transaction replay semantic changes

## Rollback Value

This checkpoint provides a safe rollback point before any environment enables CRUD auth enforcement. If staging or production enforcement blocks sync unexpectedly, turn the flag off and return to audit-only behavior.
