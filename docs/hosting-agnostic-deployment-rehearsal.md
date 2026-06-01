# Hosting-Agnostic Deployment Rehearsal

This guide prepares exact deployment rehearsal steps before real hosting credentials are available. It is documentation only: it does not deploy, upload, configure hosting, add CI/CD, change runtime behavior, or enable auto-sync.

## Assumptions Before Hosting Is Available

- The final host, domain, public web root, and database credentials are not known yet.
- Deployment remains manual-first and rehearsal-only.
- The local deployment package is produced with `npm.cmd run deployment:package`.
- Real secrets are not committed and are not packaged.
- Auto-sync remains disabled; manual replay remains gated/auth-aware.
- Restore/import tooling is not implemented, so backup/export validation is readiness evidence, not a restore guarantee.

## Required Hosting Capabilities

Minimum hosting requirements:

- HTTPS/TLS with a valid certificate
- PHP with PDO MySQL enabled
- MySQL or MariaDB with transaction support
- ability to create/import a database
- ability to configure DB credentials outside public source when possible
- writable PHP logs or accessible hosting error logs
- ability to serve frontend static files and PHP API files
- CORS/config support for the selected frontend/API origin

Recommended operational capabilities:

- scheduled database backups
- off-host backup export/download
- staging environment or staging subdomain
- rollback support for frontend and backend files
- access to PHP version, MySQL version, and error logs

## Shared Hosting Deployment Layout

Typical shared hosting layout:

```text
public_html/
  index.html
  assets/
  api/
    health.php
    login.php
    session.php
    logout.php
    ...
```

Rehearsal mapping:

- upload `deployment-package/frontend/*` into the frontend document root, often `public_html/`
- upload `deployment-package/api/` into `public_html/api/` or the host's configured API folder
- configure database credentials through hosting environment variables or a protected config file
- never upload local `.env`, backups, release manifests, `node_modules`, logs, or `deployment-package/` as a parent folder unless the host explicitly requires that wrapper

## VPS Deployment Layout

Typical VPS layout:

```text
/var/www/app/current/frontend/
/var/www/app/current/api/
/var/www/app/shared/config/
/var/www/app/shared/logs/
```

A reverse proxy can serve frontend static files and route `/api` to PHP-FPM or Apache/PHP. Keep secrets in environment variables, a protected config directory, or host secret management, not in web-accessible source.

## Frontend Upload Location

Frontend upload source:

```text
deployment-package/frontend/
```

Expected target:

- shared hosting: public web root such as `public_html/`
- VPS: static root such as `/var/www/app/current/frontend/`

After upload, verify:

- `/index.html` loads over HTTPS
- asset paths resolve
- no mixed-content warnings occur
- frontend `VITE_API_BASE_URL` points to the selected production/staging API URL

## Backend `/api` Upload Location

Backend upload source:

```text
deployment-package/api/
```

Expected target:

- shared hosting: `public_html/api/` or equivalent
- VPS: `/var/www/app/current/api/` behind the web server/PHP runtime

After upload, verify:

- `/api/health.php` returns safe health output
- PHP errors are not displayed publicly
- PHP logs are available to the operator
- CORS allows the frontend origin only where appropriate

## MySQL Database Creation And Import Order

Rehearsal order:

1. create database
2. create database user with least practical privileges
3. configure credentials on host/server
4. import baseline schema from packaged SQL, currently under `deployment-package/api/sql/`
5. verify `schema_migrations` if migrations are present
6. verify required tables for CRUD, replay metadata, replay audit, sales/sale_items, payments, batches, and cylinders
7. run health/login checks before any manual replay

Do not run replay, cleanup, archival, repair, or hydration tools during schema import.

## Environment Variable And Config Setup

Required configuration decisions:

- `VITE_API_BASE_URL`: public API URL used by frontend build
- `DB_HOST`
- `DB_NAME`
- `DB_USER`
- `DB_PASS`
- `REPLAY_WORKER_TOKEN`
- `CRUD_AUTH_ENFORCEMENT`
- allowed frontend/CORS origin

Use `.env.production.example` as a checklist only. Real values must be entered into the hosting control panel, protected server config, or environment variables. Do not upload real `.env` files into public web roots.

## HTTPS/TLS Requirements

Before any login/session validation:

- HTTPS must be active for frontend and API
- HTTP should redirect to HTTPS when possible
- certificates must be valid and trusted
- API calls must not downgrade to HTTP
- browser dev tools should show no mixed-content warnings

## CORS/API Origin Setup

CORS should allow the selected frontend origin and avoid broad production wildcards.

Rehearsal checks:

- frontend origin can call `/api/health.php`
- login/session endpoints accept expected origin
- invalid origins are rejected or ignored according to host policy
- auth headers are allowed where needed

## First Admin/User Setup

Before production use:

- confirm at least one admin/Dev-capable user exists
- confirm passwords are hashed server-side in supported fields
- confirm login returns bearer token once
- confirm `session.php` returns safe actor/session metadata
- confirm logout revokes the token
- do not seed passwords through public files or logs

## Backup/Export Verification Before Upload

Before upload or schema import:

```powershell
npm.cmd run backup:indexeddb:export
npm.cmd run backup:mysql:export
npm.cmd run backup:validate -- backups/<backup-file>.json
```

Record checksums and validation results in deployment notes. Backup files still contain business data and must not be uploaded into public hosting paths.

## Post-Upload Health Checks

Run from a browser or API client:

- frontend URL loads over HTTPS
- `/api/health.php` returns safe success output
- API base URL matches the deployed backend
- PHP error display is off
- server logs are available for diagnostics

## Post-Upload Login/Session Checks

Verify:

- valid login succeeds
- invalid login fails safely
- `session.php` returns safe actor/session metadata with bearer token
- `logout.php` revokes token
- raw tokens/passwords do not appear in UI, response logs, PHP logs, or browser console output

## Post-Upload CRUD Sync Checks

Initial checks should stay low-risk:

- create a low-risk CRUD record such as a brand/unit in a controlled account
- confirm backend row appears when backend is reachable
- confirm offline local write still works when backend is unreachable
- confirm queued row can be replayed manually after backend returns
- confirm no stock/accounting direct CRUD replay is introduced

## Manual Replay Check

Manual replay remains gated and operator-controlled:

- open Settings Developer Sync Replay as authorized admin/Dev
- refresh queue counts
- confirm auth/enforcement state is visible
- confirm POS activity state is idle
- run manual replay only if safe
- confirm diagnostics show processed/succeeded/failed/skipped without payload bodies

Do not enable automatic replay, background polling, online/offline listeners, workers, or startup replay.

## Developer Control Panel Check

Verify Developer Control Panel visibility:

- only DB-backed exact role `Dev` can access the read-only panel; admin and staff roles cannot see it
- normal staff/saleboy cannot see advanced sync internals
- System Health, Sync Status, Replay Status, Auth Status, Backup Status, Auto-sync Eligibility, and POS Activity Status are visible
- manual refresh only
- no direct DB editing, payload display, token display, or stock/accounting mutation tools

## Rollback Steps

Prepare rollback before upload:

1. record current commit/tag and package manifest
2. backup MySQL before schema changes
3. keep previous frontend files available
4. keep previous backend API files available
5. define rollback approver
6. restore previous files if health/login checks fail
7. do not blindly replay stale queues after rollback
8. re-run read-only diagnostics before resuming manual replay

## Go/No-Go Checklist

Go only if:

- HTTPS works
- API health works
- database schema is present
- login/session/logout work safely
- real secrets are configured outside source/package
- backup/export validation has been recorded
- Developer Control Panel remains protected
- auto-sync remains disabled
- manual replay is gated and idle POS state is confirmed
- rollback path is prepared

No-go if:

- hosting cannot provide HTTPS
- PHP/PDO MySQL is unsupported
- DB credentials must live in public source
- CORS/API origin is unknown
- backup validation has not been run
- failed replay/manual-review blockers are not understood
- active POS transaction state is unknown during replay checks
- auto-sync would need to be enabled to make deployment work

## When Hosting Becomes Available

Collect these details before adapting this rehearsal:

- domain and intended frontend URL
- hosting type: shared hosting, VPS, or other
- PHP version
- MySQL/MariaDB version
- database host/name/user/password delivery method
- public web root path
- API upload path
- SSL/TLS status and certificate owner
- whether environment variables are supported
- whether protected config files outside web root are supported
- CORS/frontend origin policy
- backup/snapshot capability
- rollback capability
- final `VITE_API_BASE_URL` decision

Record those values in a private deployment runbook, not in committed docs.
## Local Laragon Production-Like Rehearsal

A practical local rehearsal checklist exists at [local-production-rehearsal-laragon.md](./local-production-rehearsal-laragon.md). It simulates the future hosting deployment flow using Laragon: generate `deployment-package/`, copy frontend files, copy `api/`, import `schema.sql`, configure a local production-like API URL, test health/login/session/CRUD/manual replay/Developer Control Panel, run backup validation, run `release:verify`, check package leakage, and rehearse rollback.

This local rehearsal is not real deployment. Real hosting still requires domain, HTTPS/TLS, production DB credentials, CORS, server environment config, backup ownership, and host rollback access.

## Automated Read-Only Rehearsal Verifier

The boring/read-only parts of this checklist can be checked with:

```powershell
npm.cmd run rehearsal:local-production
```

The verifier inspects the local `deployment-package/` and source tree without deploying, uploading, mutating IndexedDB/MySQL, triggering replay, applying hydration, restoring/importing data, changing runtime behavior, or enabling auto-sync.

It writes generated local reports:

- `deployment-rehearsal-report.json`
- `deployment-rehearsal-report.md`

The report checks package structure, frontend build files, API files, `schema.sql`, `.env.production.example`, required docs/scripts, Developer Control Panel source, runtime localhost/dev URL leakage, auto-sync signals, obvious background sync startup code, and dangerous restore/import tooling. Report files are local generated artifacts and should not be committed.

Manual checks still required after a passing report:

- visual UI verification
- invoice print verification
- real accounting effect review
- real replay approval
- rollback approval
- real hosting credentials/domain/SSL/CORS/server environment checks
