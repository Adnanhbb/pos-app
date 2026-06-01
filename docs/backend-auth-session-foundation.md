# Backend Auth And Session Foundation

This document records the current backend authentication/session foundation for future replay and API authorization. It is a foundation layer only; it does not enable auto-sync, background replay, polling, startup replay, or new frontend sync behavior.

## Current Auth Situation

The frontend now has a minimal backend token login/session flow while preserving the existing local IndexedDB/localStorage app gate. `authRepository` attempts backend login when available, stores a bearer token through the token helper, and falls back to local IndexedDB login when the backend is unavailable so offline-first behavior remains intact.

Backend replay has historically been invoked only by dev/test scripts calling PHP helpers directly. The new foundation adds a safe authentication shape for future replay endpoints and CRUD authorization without changing current UI behavior.

## Token Model

`api/lib/auth.php` supports bearer token authentication suitable for shared hosting:

- `Authorization: Bearer <token>` parsing
- environment replay worker token via `REPLAY_WORKER_TOKEN`
- optional `REPLAY_WORKER_ID` for environment token actor identity
- database-backed tokens in `api_auth_tokens`
- SHA-256 token hashes only; raw tokens are not stored in the database
- inactive, revoked, expired, or unknown tokens are rejected
- `last_used_at` is updated for accepted DB tokens

The token helper returns safe actor metadata only: actor type, actor id, role, source, and session id. It does not return the raw token.

## API Auth Tokens Table

Fresh schema includes `api_auth_tokens` with:

- `token_hash`
- `actor_type`
- `actor_id`
- `role`
- `label`
- `is_active`
- `expires_at`
- `last_used_at`
- `revoked_at`
- timestamps

Allowed replay roles are currently `replay`, `admin`, and `owner`. Allowed replay actor types are `replay_worker`, `user`, and `device`.

## Replay Authorization

`replayStoredTransactionAuthorized($pdo, $syncTransactionId, $authContext)` wraps the existing replay processor. It validates the auth context first. Unauthorized callers receive a safe result with `success: false`, `reason: unauthorized`, and no replay lock acquisition.

The existing `replayStoredTransaction($pdo, $syncTransactionId, $workerId)` remains available for current dev/test regression coverage. Replay semantics are not broadened by this foundation.

## Audit Attribution

`transaction_replay_audit` now supports optional attribution columns:

- `actor_type`
- `actor_id`
- `actor_role`
- `session_id`

When authorized replay is used, audit events are attributed to the replay actor. If an existing dev database has not applied the new columns yet, audit insertion falls back to the old shape rather than breaking replay tests.

Audit rows must never include raw tokens, passwords, payload bodies, or session secrets.

## CRUD Authorization Direction

CRUD endpoints are not auth-enforced yet. The auth helper is intended to be reused later for endpoint middleware so shared-hosting deployments can require either an authenticated user session or a scoped token before mutating server data.

This was intentionally left unenforced for now to avoid changing existing frontend/API behavior during the foundation step.

## Multi-Device Considerations

The `actor_type`/`actor_id` model is designed for future multi-device usage:

- `user` actors for normal authenticated users
- `device` actors for trusted devices
- `replay_worker` actors for controlled replay processors

The current login/session foundation binds frontend sessions to `user` actors in `api_auth_tokens`. Future work should add refresh-token or cookie-backed rotation, device labeling, expiration policy tuning, and role enforcement.

## Auto-Sync Status

Auto-sync remains disabled. This foundation does not add:

- startup replay
- intervals
- polling
- online/offline listeners
- background replay
- syncEngine behavior changes

Manual replay and dev/test replay remain the only replay invocation paths.

## Verified Test

`test:transactions:auth-foundation` verifies:

- unauthorized replay is rejected
- invalid bearer tokens are rejected
- authorized replay is accepted
- audit rows record actor metadata
- raw tokens are not leaked in safe outputs

## CRUD Optional Auth Audit Mode

CRUD endpoints now run in optional auth audit mode. This is preparation for future auth enforcement only; it does not block existing sync or API calls.

Covered endpoints:

- `units.php`
- `taxes.php`
- `discounts.php`
- `brands.php`
- `categories.php`
- `customers.php`
- `suppliers.php`
- `expenses.php`
- `settings.php`
- `users.php`
- `held.php`
- `items.php`

Behavior:

- bearer token is parsed when present
- valid tokens resolve safe actor metadata
- missing tokens are marked `absent`
- invalid tokens are marked `invalid`
- requests are not rejected yet
- JSON response bodies keep the existing success/error shape
- safe dev visibility is exposed through response headers:
  - `X-Auth-Audit-Mode: optional`
  - `X-Auth-Status: absent|valid|invalid`
  - `X-Auth-Actor-Type` when valid
  - `X-Auth-Actor-Id` when valid
  - `X-Auth-Actor-Role` when valid

A safe PHP `error_log` audit entry can include endpoint, method, auth status, and actor metadata when valid. Payload bodies, passwords, raw tokens, customer/supplier bodies, item bodies, and session secrets must not be logged.

Hard CRUD auth enforcement remains a future phase. Auto-sync remains disabled.

Verified test:

- `test:crud:auth-audit` verifies absent, valid, and invalid auth requests all still work while exposing safe auth status.

Checkpoint reference: [release-checkpoint-crud-auth-audit-mode.md](./release-checkpoint-crud-auth-audit-mode.md)

## Frontend Auth Token Plumbing

The frontend API client now has minimal bearer-token plumbing while backend CRUD auth remains audit-only.

Current behavior:

- `src/api/authToken.ts` provides `getAuthToken()`, `setAuthToken()`, and `clearAuthToken()`.
- token storage is intentionally simple and replaceable.
- `apiClient` reads the token at request time.
- when a token exists, API requests include `Authorization: Bearer <token>`.
- when no token exists, requests continue without an auth header.
- no passwords are stored by the token helper.
- existing local IndexedDB writes and queue creation remain unchanged.

Manual replay diagnostics can now surface future auth failures safely:

- `401` is shown as an authentication-required message.
- `403` is shown as an insufficient-permission message.
- diagnostics include safe status/auth markers only, not payloads or tokens.

Backend CRUD endpoints remain in optional audit mode. Hard CRUD auth enforcement is still deferred, and auto-sync remains disabled.

Checkpoint reference: [release-checkpoint-frontend-token-plumbing.md](./release-checkpoint-frontend-token-plumbing.md)

## Configurable CRUD Auth Enforcement Flag

CRUD auth can now be hard-enforced behind a backend config flag:

```text
CRUD_AUTH_ENFORCEMENT=true
```

Default behavior is off. When the flag is missing, empty, `false`, or `off`, CRUD endpoints remain in audit mode:

- missing auth is allowed and marked `absent`
- invalid auth is allowed and marked `invalid`
- valid auth is allowed and safe actor metadata is exposed
- dev headers still show auth status

When the flag is on, protected CRUD endpoints reject missing or invalid auth with safe `401` JSON responses. Valid auth proceeds. Response bodies do not include tokens, payload bodies, passwords, or record details.

`health.php` remains public and is not protected by this flag.

This flag prepares enforcement testing only. It is not enabled by default, and auto-sync remains disabled.

Checkpoint reference: [release-checkpoint-crud-auth-enforcement-flag.md](./release-checkpoint-crud-auth-enforcement-flag.md)

## Dev-Only Auth Diagnostics In Settings

The Settings page Developer Sync Replay section now shows safe auth diagnostics for development/operator visibility before any auth enforcement rollout.

Displayed metadata:

- token present: yes/no
- backend auth enforcement: on/off/unknown
- backend auth status: absent/valid/invalid/unknown
- last replay auth status: none/401/403 when applicable
- safe actor type/id/role when backend returns valid actor headers

The UI never displays raw bearer tokens, passwords, payload bodies, or full records. This is not a login UI and does not enable auth enforcement.

Checkpoint reference: [release-checkpoint-auth-diagnostics-visibility.md](./release-checkpoint-auth-diagnostics-visibility.md)

## Login, Logout, And Session Lifecycle

Minimal backend auth endpoints now exist:

- `POST /api/login.php`
- `POST /api/logout.php`
- `GET /api/session.php`

`login.php` validates `username`/`password` against `users.password_hash` using `password_verify(...)`. It rejects inactive, soft-deleted, missing, or invalid users with a safe `401`/validation response and never returns `password`, `Password`, or `password_hash`.

On successful login, the backend creates a new `api_auth_tokens` row with:

- SHA-256 token hash only
- `actor_type = user`
- `actor_id = users.id`
- `role = users.role`
- session id from the token row
- optional expiry controlled by `AUTH_TOKEN_TTL_SECONDS` with a 30-day default

The raw bearer token is returned once to the frontend login flow and is not stored in plaintext by the backend. `logout.php` revokes only the presented bearer token and returns safe logout metadata. `session.php` validates the presented bearer token and returns safe actor metadata only.

Frontend lifecycle:

- `src/api/authSession.ts` calls `login.php`, `logout.php`, and `session.php`.
- `authRepository.validateUser(...)` attempts backend login first and stores the returned token through `setAuthToken(...)`.
- if backend login is unavailable, the existing local IndexedDB login fallback remains available.
- `authRepository.logout()` calls backend logout best-effort, clears the bearer token, and clears local login state.
- app startup may restore the UI session from an existing token via `session.php`, but it does not invoke sync replay.

This is not hard CRUD enforcement. It does not add auto-sync, intervals, online/offline listeners, startup replay, or background replay.

Verified tests:

- `test:auth:session` => `12 passed, 0 failed`
- `test:frontend:auth-token` => `18 passed, 0 failed`
Checkpoint reference: [release-checkpoint-login-session-foundation.md](./release-checkpoint-login-session-foundation.md)

## Dev/Staging CRUD Auth Enforcement Validation

A dev/staging-only validation flow now exercises hard CRUD auth enforcement without enabling it by default.

Validated behavior when `CRUD_AUTH_ENFORCEMENT` is enabled in a controlled PHP test server:

- authenticated CRUD requests with a valid bearer token succeed
- missing-token CRUD requests receive safe `401` responses
- invalid-token CRUD requests receive safe `401` responses
- `health.php` remains public
- response bodies and diagnostics do not leak raw tokens, passwords, payload bodies, or full records

Offline-first validation:

- local IndexedDB writes still succeed without a token
- pending `sync_queue` rows can still be created locally without a token
- manual replay against an auth-enforced backend returns safe auth diagnostics instead of marking the row done
- the replay diagnostic includes safe `401`/`authError` metadata
- the queue row remains not-done with a safe authentication-required message

Frontend safety expectations:

- `401` maps to an authentication-required message
- `403` maps to an insufficient-permission message
- manual replay does not silently auto-logout the user
- manual replay does not start retry loops
- duplicate clicks are blocked while replay is running
- no auto-sync, startup replay, intervals, or online/offline replay listeners are added

This validation flow is for dev/staging readiness only. `CRUD_AUTH_ENFORCEMENT` remains default-off/audit-only until explicitly enabled in a controlled environment.

Verified results:

- `test:crud:auth-enforcement` validates enforcement on/off behavior plus offline queue/auth-failure diagnostics.
- `test:frontend:auth-token` validates frontend auth failure handling and no token leakage.
Checkpoint reference: [release-checkpoint-crud-auth-enforcement-validation.md](./release-checkpoint-crud-auth-enforcement-validation.md)

## Manual Replay Auth Gate

Settings Developer Sync Replay now uses the existing token/session foundation as a manual replay gate.

- enforcement on: missing token or invalid/expired session blocks replay before `syncEngine.processPending()`
- enforcement on: valid session allows manual replay
- enforcement off/audit-only: replay remains allowed with `enforcementDisabled` diagnostics
- enforcement unknown: replay blocks safely

The UI shows only safe gate state, result, message, and session validation timestamp. It does not display raw bearer tokens, passwords, sensitive session bodies, payload bodies, or full auth/session records.

This does not add auto-sync, background replay, polling, listeners, startup replay, or automatic retry loops.

## Database-Backed Developer Support Access

Client handover support access uses a normal `users` database row with role `Dev` or the existing lowercase `admin` role. The same `login.php` endpoint verifies `users.password_hash` with `password_verify(...)`, and the same token/session lifecycle applies. Only users with exact role `Dev` can access the protected read-only Developer Control Panel. Lowercase `admin` and normal staff roles remain excluded.

Create a missing support account during controlled client setup with environment-injected credentials:

```powershell
$env:SUPPORT_USER_USERNAME="<client-specific-support-username>"
$env:SUPPORT_USER_PASSWORD="<enter-secret-privately>"
$env:SUPPORT_USER_ROLE="Dev"
npm.cmd run support:user:create
Remove-Item Env:SUPPORT_USER_PASSWORD
```

The setup helper creates the account only when missing, uses `password_hash(..., PASSWORD_DEFAULT)`, and never prints the password, hash, or token. Existing inactive or deleted accounts require manual review instead of automatic replacement.

The legacy frontend shortcut is retained only for explicitly opted-in local development with `VITE_ENABLE_DEV_BACKDOOR=true`. Its default is `false`, and deployment packaging/rehearsal verification reject an enabled client package. Rehearsal, staging, and production builds must use database-backed login.