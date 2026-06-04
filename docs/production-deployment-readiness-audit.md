# Production Deployment Readiness Audit

This audit records the client-handover deployment readiness state. It is
documentation and verification only. It does not deploy, upload, mutate
IndexedDB/MySQL, replay rows, restore/import data, change POS behavior, change
transaction behavior, change sync behavior, or enable auto-sync.

## Assets Inspected

- deployment package tooling: `scripts/create-deployment-package.mjs`
- release verification tooling: `scripts/verify-production-build.mjs`
- Laragon rehearsal tooling: `scripts/run-laragon-rehearsal.mjs`,
  `scripts/rehearse-local-production.mjs`
- environment examples: `.env.production.example`, `.env.example`
- frontend/API config: `vite.config.ts`, `src/api/config.ts`,
  `api/config/cors.php`, `api/config/database.php`
- deployment docs: `production-deployment-checklist.md`,
  `deployment-and-environment-hardening-strategy.md`,
  `hosting-agnostic-deployment-rehearsal.md`,
  `local-production-rehearsal-laragon.md`
- handover/recovery docs: `client-handover-operational-checklist.md`,
  `backup-disaster-recovery-handover.md`,
  `backup-restore-migration-strategy.md`
- sync/auth status docs: `sync-roadmap-and-status.md`,
  `backend-auth-session-foundation.md`

## Deployment Package Readiness

The dry-run deployment package command remains:

```powershell
npm.cmd run deployment:package
```

It builds frontend assets, copies `dist/` into `deployment-package/frontend/`,
copies `api/` into `deployment-package/api/`, includes `.env.production.example`,
includes public deployment/handover docs, and writes
`deployment-package/deployment-manifest.json`.

The package must exclude:

- `node_modules/`
- `backups/`
- `releases/`
- `.git/`
- local `.env` files
- logs
- `tsconfig.tsbuildinfo`

The package manifest must keep:

- `deploymentPerformed: false`
- `uploadPerformed: false`
- `autoSyncEnabled: false`
- `VITE_ENABLE_DEV_BACKDOOR: false`

For root-domain client hosting, build/package with:

```powershell
$env:VITE_API_BASE_URL="https://<client-api-domain-or-path>"
$env:VITE_BASE_PATH="/"
npm.cmd run deployment:package
Remove-Item Env:VITE_API_BASE_URL
Remove-Item Env:VITE_BASE_PATH
```

For subfolder hosting, set `VITE_BASE_PATH` to the public subfolder, including
leading and trailing slashes.

## Environment Configuration Readiness

`.env.production.example` is a placeholder checklist only. Real production
values must be owned by the client/server operator and configured through the
hosting control panel, protected server config, or environment variables.

Required real-hosting decisions:

- final HTTPS frontend URL
- final HTTPS API URL for `VITE_API_BASE_URL`
- frontend asset base path for `VITE_BASE_PATH`
- DB host/name/user/password
- strong `REPLAY_WORKER_TOKEN`
- production CORS/frontend origin
- `CRUD_AUTH_ENFORCEMENT` staged policy
- explicit `VITE_ALLOW_OFFLINE_LOGIN` device policy

Do not hardcode production secrets, domains, bearer tokens, replay tokens, or
database passwords into source files or packaged public files.

## Server Assumptions

Real hosting must provide:

- HTTPS/TLS for frontend and API before login/session use
- PHP with PDO MySQL support
- MySQL/MariaDB with transaction support
- ability to import `deployment-package/api/sql/schema.sql`
- private DB credential storage
- access to PHP/server logs
- backup/snapshot ownership
- rollback access for frontend and API files

The local Laragon rehearsal is useful for package shape and operator practice,
but it is not proof that shared hosting or VPS requirements are met.

## Security And Secrets

No production secret should be committed or packaged. The production package
should include `.env.production.example` only. Backup files remain sensitive
business data even after password/token redaction and must not be uploaded into
public hosting paths.

The legacy frontend developer shortcut must stay disabled in rehearsal,
package, staging, and production builds. Developer support access must use a
database-backed user with exact role `Dev`.

## Rollback And Recovery Readiness

Before uploading any client build:

1. record the source commit/tag and package manifest
2. export and validate IndexedDB where relevant
3. export and validate MySQL
4. preserve the previous frontend files
5. preserve the previous API files
6. confirm who can approve rollback
7. confirm API health/login checks after rollback
8. do not replay stale queues blindly after rollback

If frontend upload fails, restore the previous frontend files and re-check
asset loading/API URL. If API upload fails, restore the previous `api/` folder,
run `api/health.php`, and keep manual replay paused until health/login/session
checks pass.

Restore/import application tooling is not implemented. Disaster recovery is
currently backup/export/validation plus support-led recovery planning.

## Client Deployment Go/No-Go

Go only if:

- TypeScript build passes
- release verification passes
- transaction replay regression passes
- standalone payment replay regression passes
- auth/session verification passes
- backup readiness audit passes
- sync verification passes
- Laragon rehearsal copy passes where applicable
- backup validation passes and checksums are recorded
- Sync Status is clean or every failed row has a documented support decision
- HTTPS, CORS, DB credentials, API URL, and rollback path are known
- auto-sync/background behavior remains disabled

No-go if:

- production API URL points to local/Laragon/staging by mistake
- HTTPS is unavailable
- production CORS/frontend origin is unknown
- database credentials must be placed in public source
- backup validation or backup readiness audit fails
- auth/session tests fail
- replay regression tests fail
- sync verification fails
- unexplained failed sync rows remain
- rollback ownership is unknown
- any auto-sync, polling, worker, listener, startup replay, or background replay
  is enabled

## Remaining Real-Hosting Requirements

The following cannot be fully closed until the actual host is known:

- final domain and SSL/TLS certificate
- shared-hosting/VPS PHP version
- MySQL/MariaDB version
- public web root and API upload path
- production database credentials
- hosting CORS/environment variable mechanism
- hosting backup retention and off-host copy ownership
- log access and rollback procedure
- first production admin/support user setup

## Verification Commands

Use the explicit package scripts:

```powershell
npx.cmd tsc -b
npm.cmd run test:transactions:manual-replay-regression
npm.cmd run test:transactions:standalone-payment-manual-replay
npm.cmd run test:auth:session
npm.cmd run backup:audit-readiness
npm.cmd run release:verify
npm.cmd run sync:verify-existing
npm.cmd run rehearsal:laragon -- --copy
```

These checks do not enable auto-sync, polling, workers, listeners, startup
replay, background replay, restore/import, or deployment automation.
