# Release Checkpoint: CRUD Auth Audit Mode

Suggested git tag: `crud-auth-audit-mode-before-enforcement`

## Milestone Summary

This checkpoint records the optional CRUD auth audit foundation before moving to hard CRUD auth enforcement.

CRUD endpoints now parse bearer authentication when present and expose safe audit visibility, but they intentionally do not block requests yet. This keeps existing low-risk sync, manual replay, and development workflows working while preparing for a future enforcement phase.

## Current Optional Auth Behavior

CRUD endpoints parse bearer auth if present.

Current outcomes:

- missing auth => `absent`
- valid auth => `valid` plus safe actor metadata
- invalid auth => `invalid`, but the request is still allowed for now

This is audit mode only. It is not access control yet.

## Exposed Dev Headers

CRUD responses can expose safe auth audit headers:

- `X-Auth-Audit-Mode`
- `X-Auth-Status`
- `X-Auth-Actor-Type`
- `X-Auth-Actor-Id`
- `X-Auth-Actor-Role`

These headers are for development/operator visibility and future auth rollout testing. They do not change the JSON response shape.

## Safe PHP Audit Logging

The optional auth audit helper writes safe PHP `error_log` entries with metadata such as:

- endpoint
- method
- auth status
- actor type, id, and role when valid

The audit log must not include:

- payload bodies
- passwords
- raw bearer tokens
- token hashes
- full customer/supplier records
- full item bodies
- session secrets

## Explicitly Deferred

The following remain deferred:

- hard CRUD auth enforcement
- production login/session endpoint
- frontend token/session wiring
- auto-sync
- startup replay
- intervals, polling, or online/offline listeners

## Verified Results

Latest verified results at this checkpoint:

- `test:crud:auth-audit` => `9 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`
- `test:sync:real-low-risk` => `39 passed, 0 failed`

## Rollback Value

This checkpoint identifies the last known state where CRUD endpoints support optional auth audit visibility but remain fully compatible with existing unauthenticated low-risk sync calls.

If future hard enforcement breaks sync or development workflows, return to this checkpoint and reintroduce enforcement endpoint-by-endpoint behind explicit rollout controls.

## Safety Warning

Do not enable hard CRUD auth globally without a frontend token/session plan, test coverage for every endpoint, and a recovery path for shared-hosting deployments.

Do not enable auto-sync from this state. Auth audit mode is only preparation, not a complete production authorization rollout.
