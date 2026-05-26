# Release Checkpoint: Login Session Foundation

Suggested git tag: `login-session-foundation-before-auth-enforcement`

## Milestone Summary

This checkpoint records the minimal production-oriented login/session lifecycle before any hard CRUD auth enforcement or auto-sync rollout. The app can now obtain and store a backend bearer token when backend login is available, while preserving the existing offline-first local login fallback.

This checkpoint does not enable automatic sync, startup replay, polling, online/offline replay listeners, or global CRUD auth enforcement.

## Backend Login Lifecycle

Implemented endpoints:

- `POST /api/login.php`
- `GET /api/session.php`
- `POST /api/logout.php`

`login.php` behavior:

- validates `username`/`password`
- verifies passwords with `password_verify(...)` against `users.password_hash`
- rejects missing, invalid, inactive, or soft-deleted users safely
- creates an `api_auth_tokens` row on successful login
- stores only a SHA-256 hash of the bearer token server-side
- returns the bearer token once to the client
- returns safe actor metadata only
- never returns `password`, `Password`, or `password_hash`

`session.php` behavior:

- validates the presented bearer token
- returns safe actor/session metadata only
- does not return token bodies, password fields, payloads, or full sensitive records

`logout.php` behavior:

- revokes only the presented bearer token
- returns safe logout metadata
- does not mutate business data

## Frontend Token Lifecycle

Frontend behavior:

- token storage uses the existing auth token helper: `getAuthToken`, `setAuthToken`, and `clearAuthToken`
- `authRepository.validateUser(...)` attempts backend login first
- when backend login succeeds, the returned bearer token is stored through the token helper
- if backend login is unavailable, the existing local IndexedDB login fallback remains available
- `authRepository.logout()` clears the token and local login state, with best-effort backend logout
- `App` can restore a token-backed session through `session.php`
- session restoration does not call `syncEngine.processPending()` and does not replay queue rows

## Safety Boundaries

Still intentionally not enabled:

- hard CRUD auth enforcement
- auto-sync
- startup replay
- polling
- intervals
- online/offline replay listeners
- background replay
- transaction replay behavior changes

Current CRUD auth remains default-off/audit-only. `CRUD_AUTH_ENFORCEMENT` is still not enabled by default.

## Verified Results

- `test:auth:session` => `12 passed, 0 failed`
- `test:frontend:auth-token` => `18 passed, 0 failed`
- `test:crud:auth-audit` => `9 passed, 0 failed`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

## Rollback Value

This checkpoint is a clean point before any hard auth enforcement. If future auth enforcement breaks sync or login behavior, return to this state where:

- login/session token plumbing exists
- CRUD endpoints remain audit-only by default
- manual replay remains controlled
- auto-sync remains disabled

## Warning

Do not enable auto-sync from this checkpoint. Hard auth enforcement, token expiry handling, role/permission checks, queue auth failure handling, and staging verification must be completed first.