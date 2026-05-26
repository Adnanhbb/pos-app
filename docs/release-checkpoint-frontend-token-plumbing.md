# Release Checkpoint: Frontend Token Plumbing

Suggested git tag: `frontend-token-plumbing-before-crud-auth-enforcement`

## Milestone Summary

This checkpoint records the frontend auth token plumbing foundation before any hard CRUD auth enforcement.

The frontend can now attach a bearer token to API calls when one is available, while backend CRUD endpoints remain in optional audit mode. This prepares the app for future authenticated CRUD/sync requests without changing current offline-first behavior.

## Implemented Frontend Token Helper

The frontend token helper provides:

- `getAuthToken()`
- `setAuthToken()`
- `clearAuthToken()`

The implementation is intentionally simple and replaceable. It is not a final production session model.

## API Client Behavior

`apiClient` reads the token at request time.

Current behavior:

- token exists => send `Authorization: Bearer <token>`
- token missing => send no auth header
- missing token still works because backend CRUD auth is audit-only
- invalid token still does not block CRUD yet because hard enforcement is deferred

## Password And Secret Safety

No passwords are stored by the token helper.

The frontend must not store:

- plaintext passwords
- backend replay worker secrets
- token hashes
- server session secrets

Replay worker tokens remain backend/service-only secrets and must not be embedded in frontend code.

## Offline-First Behavior

Offline IndexedDB writes remain unchanged.

Current local behavior is preserved:

- local creates/updates still write to IndexedDB
- sync queue creation is unchanged
- queued rows are not blocked by missing tokens at local write time
- backend auth status affects only remote API calls, not local offline persistence

## Manual Replay Diagnostics

The manual replay UI can safely surface future auth-related API errors:

- `401` => authentication required message
- `403` => insufficient permission message
- safe status/auth markers may be shown

The UI must not show payload bodies, passwords, raw tokens, customer/supplier full records, item bodies, or session secrets.

## Explicitly Not Implemented

The following remain intentionally not implemented:

- hard CRUD auth enforcement
- backend production login/session endpoint
- frontend login token exchange
- token refresh flow
- auto-sync
- startup replay
- online/offline replay listeners
- polling or intervals

## Verified Results

Latest verified results at this checkpoint:

- `test:frontend:auth-token` => `9 passed, 0 failed`
- `test:crud:auth-audit` => `9 passed, 0 failed`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

## Rollback Value

This checkpoint separates safe frontend token attachment from hard backend enforcement. If future enforcement causes sync failures, this checkpoint identifies the last known state where the frontend could send tokens but unauthenticated CRUD calls still worked under backend audit mode.

## Safety Warning

Do not enable hard CRUD auth or auto-sync from this state without backend login/session plumbing, token refresh behavior, role/permission tests, and manual replay auth-error recovery.
