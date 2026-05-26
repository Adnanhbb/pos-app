# Deployment And Environment Hardening Strategy

This document defines the production deployment, environment configuration, operational hardening, and rollback architecture before deployment automation or CI/CD exists.

It is documentation/design only. It does not deploy anything, change runtime behavior, enable auto-sync, implement CI/CD, or add infrastructure automation.

## Shared Hosting Vs VPS Deployment Model

The project can run on shared hosting or a VPS, but the operational tradeoffs are different.

Shared hosting is acceptable for an early controlled rollout when:

- PHP/MySQL versions meet app requirements
- HTTPS is available and enforced
- scheduled backups are supported
- environment variables or secure config files can be managed safely
- PHP error logs are accessible to operators
- database size and request limits are understood

A VPS is preferred when the deployment needs:

- stronger control over PHP extensions and MySQL tuning
- process-level monitoring
- automated backups and retention policies
- reverse proxy controls
- rate limiting
- centralized logs
- CI/CD runners or deploy hooks
- stronger isolation between staging and production

Early production can start on shared hosting only if the system remains manual-first, auto-sync stays disabled, and operational visibility is proven.

## Recommended Production Topology

Recommended topology:

- static frontend assets served from HTTPS web hosting or CDN
- PHP API served from the same trusted domain or a dedicated API subdomain
- MySQL hosted close to the PHP runtime
- daily off-host database backups
- separate staging database and API path/domain
- separate production and staging environment configs

Preferred URL shape:

- frontend: `https://app.example.com/`
- API: `https://api.example.com/` or `https://app.example.com/api/`
- staging frontend/API on separate hostnames or clearly separated paths

Avoid mixing staging and production databases behind one API path.

## Frontend Build/Deployment Flow

Production frontend deployment should use a deterministic build:

```powershell
npm.cmd run build
```

Expected flow:

1. run TypeScript build and selected regression tests locally/staging
2. build static assets
3. deploy only the generated `dist/` contents
4. verify API base URL configuration
5. verify login/session flow
6. verify Settings developer diagnostics show expected environment state
7. verify no auto-sync/startup replay exists

The frontend must not include production secrets. Build-time config may include public API base URLs, but not bearer tokens, database passwords, worker secrets, or session secrets.

## Backend PHP Deployment Flow

Backend deployment should copy PHP API files and config safely:

- deploy `api/` files required by the selected release
- keep DB credentials outside public versioned source when host allows it
- verify PHP version and required extensions
- verify CORS configuration for production frontend origin
- verify `health.php` remains public and safe
- verify auth endpoints work over HTTPS
- verify CRUD auth enforcement flag state before rollout

Backend deployment must include a schema compatibility check before traffic is pointed at the new code.

## MySQL Operational Considerations

MySQL is authoritative for replayed transactional state.

Production requirements:

- regular full database backups
- clear backup retention policy
- schema migration tracking via `schema_migrations`
- enough storage headroom for replay/audit tables
- slow query monitoring where possible
- manual ability to inspect replay status and audit rows
- tested rollback plan before schema changes

Transaction replay depends on row locking and DB transactions. Production MySQL must support the required transaction isolation and locking behavior.

## Environment Variable Strategy

Production configuration should use environment variables where possible:

- `DB_HOST`
- `DB_NAME`
- `DB_USER`
- `DB_PASS`
- `REPLAY_WORKER_TOKEN`
- `CRUD_AUTH_ENFORCEMENT`
- allowed CORS/frontend origin values

If shared hosting cannot provide environment variables, use a host-managed config file outside the public web root where possible.

Do not commit production secrets to the repository.

## API Base URL Strategy

Frontend API base URL should be explicit per environment.

Development may default to local Laragon paths. Production must use a deliberate production API URL through `VITE_API_BASE_URL` or equivalent build/deploy configuration.

Rules:

- staging frontend must point to staging API
- production frontend must point to production API
- local development fallback must not leak into production builds
- API URL changes should be visible in release notes or deployment checklist

## Production Auth/Security Requirements

Before production exposure:

- login must use HTTPS only
- passwords must be verified through `password_verify`
- raw bearer tokens must be returned once and never logged
- `api_auth_tokens` must store token hashes only
- CRUD auth enforcement should be staged before production hard enforcement
- replay authorization must remain protected
- Settings developer diagnostics must never show raw tokens/passwords

Future production hardening should include:

- role/permission checks
- token expiration and rotation policy
- device/session management
- account lockout or throttling policy
- secure password reset flow

## HTTPS/TLS Requirements

Production must use HTTPS for frontend and API.

Required:

- valid TLS certificate
- HTTP redirected to HTTPS
- secure cookies if cookies are introduced later
- no mixed-content API calls
- no production login over plain HTTP

Bearer-token auth over plain HTTP is a no-go.

## Backup Scheduling Expectations

Backups should exist before production auto-sync is considered.

Minimum expectations:

- daily MySQL backup
- backup before schema migrations
- backup before auth enforcement changes
- backup before replay processor upgrades
- manual IndexedDB export option for affected devices before risky migration phases
- periodic validation/checksum records for generated backups
- off-host copy for production database backups

Current export tools are manual/export-only and do not replace operational scheduled backups.

## Production Logging/Audit Expectations

Production logs must be useful without leaking sensitive data.

Log safely:

- endpoint/method
- auth status
- safe actor id/type/role
- replay status transitions
- queue/replay error categories
- validation failures by category

Never log:

- passwords
- raw bearer tokens
- token hashes
- payload bodies
- full customer/supplier/user records
- session secrets

## Replay/Audit Retention Expectations

Replay and audit history is part of idempotency and recovery.

Retention policy should define:

- how long `sync_transactions` rows are retained
- how archived dev/test rows are handled outside production
- how long `transaction_replay_audit` rows are retained
- when old audit rows may be exported/archived
- who can run cleanup/archive tools

Production should not delete replay/audit rows without an export and explicit retention policy.

## Production Replay Lock Considerations

Replay locks protect transaction processing.

Production needs:

- stale lock reporting
- operational guidance for manual lock recovery
- worker identity attribution
- alerting or dashboard visibility for stuck processing rows
- no blind lock release without investigation

Future background replay must refuse to run when stale lock counts exceed threshold.

## Production Storage Growth Considerations

Storage growth sources:

- `sync_transactions`
- `transaction_replay_audit`
- sales/sale_items
- payment ledgers
- item batches
- cylinder/customer-cylinder history
- local IndexedDB stores and backup files

Production operators need a storage monitoring and retention plan before enabling background sync or broad multi-device usage.

## Rate Limiting/Future Abuse Protection

Future production API hardening should include:

- login throttling
- replay endpoint rate limits
- CRUD write rate limits per actor/device
- payload size limits
- request body validation limits
- audit for suspicious invalid auth attempts

Shared hosting may require application-level limits if reverse proxy controls are unavailable.

## Safe Production Feature Flags

Feature flags/config gates should stay conservative:

- `CRUD_AUTH_ENFORCEMENT` default off until staged validation passes
- auto-sync default off
- background replay default off
- hydration apply default manual-only
- update hydration apply absent until conflict policy exists
- cleanup/archive apply requires explicit command or operator action

Flags should fail closed for risky behavior.

## Production Rollback Strategy

Rollback must handle code, schema, and data separately.

Rollback checklist:

1. identify last known-good checkpoint/tag
2. stop risky manual operations
3. backup current state before rollback when possible
4. roll back frontend assets
5. roll back backend PHP files
6. evaluate whether schema rollback is needed
7. verify auth/session behavior
8. run read-only sync/replay reports
9. avoid replaying restored or stale queues blindly

Database rollback is highest risk and must include reconciliation for writes that happened after the backup point.

## Upgrade/Migration Strategy

Production upgrades should be phased:

1. backup database
2. export/validate affected local IndexedDB devices where appropriate
3. apply schema migrations
4. deploy backend code
5. deploy frontend code
6. run health/auth/sync diagnostic checks
7. run targeted regression tests where practical
8. keep auto-sync disabled until verification passes

Schema changes should be additive when possible.

## Production Verification Checklist

Before marking a release healthy:

- HTTPS works for frontend and API
- `health.php` returns expected public response
- login/session/logout works
- CRUD auth enforcement flag has expected state
- Settings diagnostics show expected auth/enforcement/POS state
- low-risk CRUD create reaches backend when online
- offline CRUD write queues locally
- manual replay works or fails safely with diagnostics
- `sync:report` is healthy
- replay audit report is accessible to operators
- stale replay lock report is clear or understood
- backup export/validation commands are understood
- auto-sync remains disabled

## Disaster Recovery Expectations

Disaster recovery planning should include:

- latest database backup location
- checksum validation process
- restore rehearsal in staging
- DNS/API cutover notes
- admin/operator contacts
- rollback checkpoint/tag
- manual device reconciliation after backend restore
- queue quarantine policy after restore

Restoring production backend state while clients continue offline work requires a reconciliation phase before those clients sync again.

## Multi-Device Rollout Expectations

Multi-device rollout requires more than replay.

Before broad multi-device use:

- pull-sync/hydration must mature
- conflict detection must exist
- server-authoritative boundaries must be enforced
- auth/session/device visibility must exist
- duplicate replay protections must remain tested
- auto-sync gate must pass in staging

Replay-only sync is not enough for multi-device correctness.

## Mobile/Capacitor Deployment Considerations

If a mobile/Capacitor deployment is introduced:

- local storage persistence and backup behavior must be tested per platform
- token storage should move toward platform-secure storage
- offline queue behavior must be validated under app suspend/resume
- background sync must remain disabled until mobile-specific gates exist
- app updates must account for IndexedDB/schema migration risk
- device restore and lost-device procedures must be defined

Mobile must not bypass backend auth, replay locks, or auto-sync gates.

## What Must Remain Disabled Initially

Initially disabled in production:

- auto-sync
- background sync
- startup replay
- polling replay
- online/offline listener replay
- service worker/background worker replay
- automatic hydration
- update hydration apply
- conflict auto-resolution
- automatic queue repair
- automatic failed replay repair/archive

Manual, operator-visible actions remain the safe default.

## Auto-Sync Gating In Early Production

Auto-sync should remain gated behind the eligibility model:

- authenticated session required
- backend reachable
- queue health acceptable
- no stale replay locks
- reconciliation state acceptable
- hydration state acceptable
- no active POS transaction
- recent manual replay success
- operator-visible disable/pause control

Early production should use manual replay and read-only evaluator reports before any background behavior.

## Recommended First Production Rollout Constraints

Recommended first production rollout:

- one environment only, with staging rehearsed first
- limited operator/admin users
- manual replay only
- no auto-sync
- no background hydration
- CRUD auth enforcement staged cautiously
- daily database backups
- validated backup/export process
- clear rollback checkpoint
- operator knows how to read diagnostics

Do not roll out broad multi-device sync until hydration/conflict work matures.

## Operational Visibility Requirements Before Background Sync

Before enabling any background sync, operators need visibility into:

- auth/session state
- queue pending/failed counts
- replay failures
- stale locks
- reconciliation blockers
- hydration manual-review blockers
- POS active state
- last successful manual replay
- backend health
- backup freshness

Background sync without visibility is a no-go.

## Recommended Phased Rollout Plan

Phase 0: current manual-first architecture

- manual replay only
- read-only diagnostics
- export/validation backup tools
- no background behavior

Phase 1: staging deployment hardening

- staging domain/API/database
- staged CRUD auth enforcement
- backup and rollback rehearsal
- manual replay validation

Phase 2: constrained production launch

- limited users/devices
- manual replay only
- auto-sync disabled
- daily backups and operator diagnostics

Phase 3: production operational hardening

- log review process
- retention policy
- auth/session hardening
- storage growth monitoring
- recovery runbooks

Phase 4: controlled background eligibility pilot

- read-only gate pass required
- dev/staging first
- low-risk CRUD only
- explicit feature flag

Phase 5: mature multi-device sync

- hydration and conflict resolution mature
- background replay safely gated
- operator pause/resume controls
- tested disaster recovery and rollback
## Operational/Admin Tooling Reference

Production operational/admin tooling is designed separately in [production-operational-tooling-strategy.md](./production-operational-tooling-strategy.md).

Deployment hardening should not be considered complete until operators have safe visibility into replay health, queue health, auth/session state, backup validation, hydration/reconciliation, auto-sync eligibility, POS activity, deployment/environment status, replay audit events, stale locks, failed replay classifications, storage growth, and support workflows.

Initial production operations should remain read-only-first. Any future mutating admin action must require explicit confirmation and follow the established report -> dry-run plan -> apply -> audit/checkpoint pattern.
## Production Environment Template And Deployment Checklist

Production preparation assets now exist:

- `.env.production.example`
- [production-deployment-checklist.md](./production-deployment-checklist.md)

The environment template contains placeholders only and must not be committed with real secrets. The checklist covers frontend build verification, backend PHP verification, database migration verification, auth enforcement verification, backup/export validation, replay/queue health, HTTPS/TLS, environment variables, rollback, disaster recovery, admin access, mobile readiness, performance sanity checks, first rollout constraints, and post-deployment validation.

This is preparation-only. It does not deploy anything, enable auto-sync, change runtime sync behavior, or add CI/CD automation.
## Release Verification And Manifest Tooling

Lightweight release preparation commands now exist:

```powershell
npm.cmd run release:verify
npm.cmd run release:manifest
```

The verifier runs a local production build, checks `dist/`, verifies required operational docs/scripts/foundations, and scans for obvious localhost leakage. The manifest generator writes a JSON release artifact under `releases/` with git/app metadata, included docs/checklists, backup tooling status, sync architecture status, auth enforcement expectations, and known blockers/warnings placeholders.

This is verification/preparation only. It does not deploy, implement CI/CD, enable auto-sync, add background workers/listeners, trigger replay, or change runtime sync behavior.
Checkpoint reference: [release-checkpoint-production-build-verification.md](./release-checkpoint-production-build-verification.md)

The checkpoint records the current manual release verification baseline before deployment automation or client hosting rollout. `release:verify` passed with zero verifier errors/warnings and no localhost leakage matches; `release:manifest` generated `releases/release-manifest-2026-05-25T17-03-53-150Z.json`.

## Dry-Run Deployment Package Preparation

A local deployment package preparation command exists:

```powershell
npm.cmd run deployment:package
```

This command is preparation only. It runs a production build, creates a local `deployment-package/` folder, copies `dist/` output into `deployment-package/frontend/`, copies backend PHP files into `deployment-package/api/`, includes selected public deployment documentation under `deployment-package/docs/`, and writes `deployment-package/deployment-manifest.json`.

The package excludes `node_modules/`, `backups/`, `releases/`, `.git/`, logs, local environment files, and `tsconfig.tsbuildinfo`. It includes `.env.production.example` only. Real production secrets must be configured on the hosting provider or server and must never be packaged.

The manifest records `deploymentPerformed: false`, `uploadPerformed: false`, and `autoSyncEnabled: false`. Actual hosting upload remains manual and outside this repository tooling.
