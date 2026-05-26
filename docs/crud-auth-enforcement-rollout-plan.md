# CRUD Auth Enforcement Rollout Plan

This document defines how to move from optional CRUD auth audit mode to hard CRUD auth enforcement safely. It is a plan only. No enforcement is implemented by this document.

## Current Audit-Mode Behavior

Current CRUD auth behavior is optional audit mode:

- endpoints parse bearer auth when present
- missing auth is marked `absent`
- valid auth is marked `valid` and exposes safe actor metadata
- invalid auth is marked `invalid`
- requests are still allowed for now
- JSON response shapes remain unchanged
- safe dev headers expose auth status for verification
- safe PHP `error_log` entries may record endpoint, method, auth status, and actor metadata
- payloads, passwords, raw tokens, token hashes, session secrets, and full records are not logged

This mode exists to observe and test auth plumbing without breaking current sync.

## Target Enforcement Behavior

The target behavior is hard authorization for backend CRUD endpoints:

- missing or invalid auth returns `401 Unauthorized`
- authenticated users without permission return `403 Forbidden`
- valid actors with sufficient permission proceed
- every write operation records safe actor attribution where practical
- auth failures use the existing JSON error shape: `success: false`, `message`, optional safe `details`
- response bodies never include tokens, password hashes, raw passwords, or session secrets

Enforcement should be introduced gradually and gated by environment/config flags before becoming production default.

## Endpoints In Scope

CRUD endpoints in scope:

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

Additional endpoints that require separate treatment:

- `transactions.php`: already has replay/storage idempotency concerns and should follow replay auth requirements, not generic CRUD rules alone
- `health.php`: should remain public or support a separate private health mode

## Temporary Exemptions

Recommended temporary exemptions:

- `health.php`: public readiness check
- local development can keep audit mode through an explicit config flag
- initial staging can allow reads while enforcing writes, if needed for migration testing

Avoid permanent exemptions for write endpoints.

## Role And Permission Model Proposal

Suggested roles:

- `owner`: full access, including settings and users
- `admin`: CRUD access to operational entities, limited user management if desired
- `manager`: CRUD access to low-risk catalog/profile entities and reports
- `cashier`: limited POS-facing writes; no settings/users/admin mutation
- `replay`: service/replay actor for sync/replay flows
- `device`: scoped device token, usually tied to a user/branch later

Suggested permission groups:

- `catalog:read/write`: units, taxes, discounts, brands, categories
- `party:read/write`: customers, suppliers
- `expense:read/write`: expenses
- `settings:read/write`: settings
- `user:read/write`: users/staff
- `held:read/write`: held carts
- `item-profile:read/write`: safe item profile fields only
- `transaction:store/replay`: transaction ingestion/replay flows

Permissions should be enforced by endpoint, method, and operation risk. `DELETE` should require stronger permission than `GET` for most entities.

## Frontend Token Storage Considerations

Preferred direction:

- use short-lived access tokens with refresh/session support when possible
- avoid localStorage for long-lived high-privilege secrets
- consider HttpOnly secure cookies for production web deployments if shared hosting supports the session model cleanly
- if bearer tokens must be stored client-side, keep scopes narrow and expiration short
- never store plaintext passwords after login
- never store replay-worker secrets in frontend code

The current frontend local login remains as an offline fallback, while minimal backend login/session plumbing now exists. Hard enforcement is still deferred until role permissions, expiry handling, and staging validation are complete.

## Offline-First Implications

Offline writes should continue to work locally even when backend auth is required.

Expected offline behavior:

- local IndexedDB write succeeds according to existing local app permissions
- sync queue row is created locally
- no backend request is attempted while offline/unreachable
- queued sync later includes valid auth/session metadata when replayed
- if auth is missing or expired at replay time, the queue item should fail or remain pending with a safe auth error
- the local record should not be deleted or silently rolled back only because remote auth expired

This preserves offline-first behavior while making server sync authorization explicit.

## Queued Sync Authentication

Future queued sync requests should authenticate with the current user/device session or a scoped sync token.

Required behavior:

- `entityApi` should attach auth headers when available
- `syncEngine.processPending()` should classify `401` and `403` as auth failures
- auth failures should be safe diagnostics, not payload dumps
- queue items should not be marked done after auth failure
- manual replay UI should display safe auth messages
- retry should wait until auth is refreshed or the user signs in again

Replay-worker tokens must not be embedded in frontend code. They are backend/service secrets only.

## Expired Token Behavior

When a token expires:

- direct online CRUD should receive `401 Unauthorized`
- queued replay should stop or skip remaining rows if every row requires the same expired token
- queue diagnostics should include safe metadata: queue id, entity, operation, auth failure message
- manual replay UI should show that authentication is required or expired
- no payload bodies/passwords/customer records should be shown
- the app should guide the user to re-authenticate before retrying

Do not repeatedly hammer the backend with expired credentials, especially before auto-sync exists.

## Manual Replay UI Auth Errors

The Settings developer replay panel should eventually show auth failures safely:

- processed/succeeded/failed/skipped counts
- safe error summary: queue id, entity, operation, status code, short message
- no payload body
- no token
- no password
- no full record details

Auth failure examples:

- `Authentication required. Sign in again before replaying pending sync.`
- `You do not have permission to sync this entity.`

## Migration And Staging Plan

Recommended staging approach:

1. Keep optional audit mode on all environments while token plumbing is built.
2. Add frontend token/session plumbing behind a feature flag.
3. Run staging with auth headers present but enforcement disabled.
4. Enable hard enforcement on dev/staging only.
5. Start with low-risk read endpoints.
6. Add low-risk write endpoints.
7. Add users/settings only after role checks are proven.
8. Add transaction storage/replay auth separately with replay-specific tests.
9. Only then consider production enforcement.

## Test Matrix Before Enforcement

Minimum tests before hard enforcement:

- unauthenticated `GET` behavior for each endpoint
- unauthenticated `POST/PUT/PATCH/DELETE` rejection for each endpoint
- valid token accepted for each endpoint/method
- invalid token rejected for each endpoint/method
- expired token rejected
- insufficient role returns `403`
- owner/admin role succeeds where expected
- cashier/manager role fails where expected
- malformed JSON still returns `400`, not auth-shaped errors when auth is valid
- duplicate `client_id` still returns `409` when auth is valid
- users endpoint never returns password/password_hash
- low-risk sync suite passes with auth headers
- real syncEngine replay handles auth success
- real syncEngine replay handles auth failure without marking queue rows done
- manual replay UI displays auth failure safely

## Rollback Plan

Rollback should be explicit and low-risk:

- keep a config flag to return endpoints to audit mode
- keep optional auth audit headers available during rollback
- do not delete queue rows after enforcement failures
- do not mark failed auth queue rows as done
- preserve local IndexedDB rows
- document any rows that failed due to auth during the rollout

If production enforcement causes sync failures, disable hard enforcement and return to audit mode while investigating.

## No-Go Conditions

Do not enable hard CRUD auth if any of these are true:

- frontend backend-token/session plumbing is broken or unavailable in the target environment
- tokens cannot be refreshed or reissued safely
- queue replay cannot attach auth headers
- manual replay UI cannot display auth errors safely
- low-risk sync tests fail with auth enabled
- users/settings permission model is unclear
- role mapping is not tested
- production shared-hosting session behavior is unverified
- rollback flag/process is missing
- auto-sync is being considered before auth is stable

## Recommended Phases

### Phase 1: Audit Mode

Status: done.

CRUD endpoints parse auth when present and expose safe auth status, but do not block requests.

### Phase 2: Frontend Token Plumbing

Status: foundational token plumbing and minimal login/session lifecycle are implemented. The frontend can store bearer tokens, call backend login/session/logout, attach auth headers when available, and preserve offline local login fallback. Keep backend enforcement disabled during this phase while refresh-token/session-hardening and permissions are designed.

### Phase 3: Enforce Auth On Dev/Staging Only

Enable hard auth in dev/staging behind a config flag. Verify all CRUD endpoints and sync flows with real tokens.

### Phase 4: Enforce CRUD Read/Write Permissions

Apply role/permission checks endpoint-by-endpoint. Start with low-risk catalog entities, then parties/expenses/held/items, then settings/users.

### Phase 5: Controlled Auto-Sync Eligibility

Only after auth is stable, sync errors are safe, queue retry behavior is correct, and pull/hydration/conflict rules are defined should controlled auto-sync eligibility be reconsidered.

## Why Auto-Sync Remains Disabled

Auto-sync remains disabled because hard auth enforcement changes failure modes. Expired tokens, role failures, and session loss must be handled predictably before any background process is allowed to replay queue rows.

Manual replay remains the safer control point until auth, retry behavior, diagnostics, and recovery are proven.

Checkpoint reference: [release-checkpoint-frontend-token-plumbing.md](./release-checkpoint-frontend-token-plumbing.md)

## Enforcement Flag

Hard CRUD auth enforcement should be introduced through the backend flag:

```text
CRUD_AUTH_ENFORCEMENT=true
```

The default must remain off until staging and frontend token plumbing are verified. When off, endpoints stay in optional audit mode. When on, protected CRUD endpoints reject missing or invalid auth and allow valid auth.

`health.php` remains public.

Checkpoint reference: [release-checkpoint-crud-auth-enforcement-flag.md](./release-checkpoint-crud-auth-enforcement-flag.md)

## Implemented Login/Session Foundation

The current foundation now includes `login.php`, `logout.php`, and `session.php`:

- login validates hashed user passwords and issues bearer tokens backed by `api_auth_tokens`.
- logout revokes the presented token.
- session returns safe actor metadata for a valid bearer token.
- frontend token storage is simple and replaceable.
- no plaintext passwords are stored.
- no hard CRUD auth enforcement is enabled by default.

Future refresh-token considerations:

- add refresh or rotation before long-lived production deployments.
- consider HttpOnly cookies if the hosting environment supports them safely.
- keep replay-worker secrets out of frontend code.
- make expired-token queue behavior explicit before auto-sync.
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
