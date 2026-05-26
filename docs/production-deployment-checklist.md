# Production Deployment Checklist

This checklist prepares a client production hosting rollout. It is operational preparation only: it does not deploy anything, enable auto-sync, change runtime sync behavior, or add CI/CD automation.

## Frontend Build Verification

- Confirm production API URL is set through `VITE_API_BASE_URL`.
- Run `npx.cmd tsc -b`.
- Run `npm.cmd run build` in staging before production upload.
- Confirm `dist/` assets are generated from the intended commit/tag.
- Confirm no production secrets are embedded in frontend build output.
- Confirm Developer Control Panel remains admin/Dev-only.

## Backend PHP Verification

- Confirm PHP version supports current backend code.
- Confirm required PHP extensions are enabled, especially PDO MySQL.
- Confirm `api/health.php` works and returns safe public output.
- Confirm `api/login.php`, `api/session.php`, and `api/logout.php` work over HTTPS.
- Confirm CRUD endpoint auth audit/enforcement headers behave as expected.
- Confirm PHP error display is disabled in production; safe logs should go to server logs.

## Database Migration Verification

- Confirm target database name/user are correct.
- Confirm schema migrations are applied exactly once.
- Confirm `schema_migrations` records expected migration ids.
- Confirm tables exist for low-risk CRUD, replay metadata, replay audit, sales/sale_items, payments, batches, and cylinders.
- Backup MySQL before applying schema changes.
- Do not run replay or cleanup tools during migration.

## Auth Enforcement Verification

- Confirm `CRUD_AUTH_ENFORCEMENT` intended state.
- Initial production recommendation: keep enforcement off/audit-only unless staging hard-enforcement passed.
- Confirm valid login returns bearer token once.
- Confirm `api_auth_tokens` stores token hashes only.
- Confirm invalid/missing auth is safe and does not leak sensitive details.
- Confirm raw tokens/passwords never appear in UI or logs.

## Backup/Export Verification

- Run an IndexedDB export where applicable:

```powershell
npm.cmd run backup:indexeddb:export
```

- Run a MySQL export where applicable:

```powershell
npm.cmd run backup:mysql:export
```

- Validate generated backup files:

```powershell
npm.cmd run backup:validate -- backups/<backup-file>.json
```

- Confirm validation reports `ok: true`.
- Confirm count mismatches are `0`.
- Confirm unsafe sensitive fields are `0`.
- Store backup checksums with deployment notes.
- Protect backup files because they still contain business data.
- Restore/import is not implemented; do not promise restore capability yet.

## Replay/Queue Health Verification

Run read-only diagnostics before rollout:

```powershell
npm.cmd run sync:report
npm.cmd run sync:report-reconciliation
npm.cmd run sync:report-transactions
npm.cmd run sync:report-replay-audit
npm.cmd run sync:report-stale-replay-locks
npm.cmd run sync:evaluate-auto-sync
```

- Confirm local queue health is understood.
- Confirm failed replay rows are classified or intentionally blocked.
- Confirm stale replay locks are absent or manually reviewed.
- Confirm auto-sync evaluator remains blocked or intentionally disabled.
- Do not replay automatically.

## HTTPS/TLS Verification

- Confirm frontend loads over HTTPS.
- Confirm API loads over HTTPS.
- Confirm HTTP redirects to HTTPS where possible.
- Confirm no mixed-content API calls occur.
- Confirm login/session/token flow is never used over plain HTTP.
- Confirm certificate expiration monitoring exists or is owned by hosting provider.

## Environment Variable Verification

- Confirm `.env.production.example` has been copied into the hosting provider's secure config system with real values.
- Confirm real secrets are not committed to source control.
- Confirm `VITE_API_BASE_URL` points to production API, not Laragon/local/staging.
- Confirm `DB_HOST`, `DB_NAME`, `DB_USER`, and `DB_PASS` are correct.
- Confirm `REPLAY_WORKER_TOKEN` is strong and unique.
- Confirm CORS/frontend origin settings match production frontend URL.

## Rollback Preparation

- Identify last known-good commit/tag.
- Record current deployment artifact/checkpoint.
- Backup database before deployment.
- Keep previous frontend build available if host supports quick rollback.
- Keep previous backend API files available if host supports quick rollback.
- Define who can approve rollback.
- Do not replay restored/stale queues blindly after rollback.

## Disaster Recovery Preparation

- Confirm database backup location and access.
- Confirm off-host backup copy exists for production data.
- Record latest backup checksums.
- Define restore rehearsal environment.
- Define DNS/API cutover contacts.
- Define client device reconciliation expectations after backend restore.
- Confirm restore/import application tooling is not implemented yet.

## Operational/Admin Access Verification

- Confirm admin/developer user exists.
- Confirm normal staff cannot see Developer Control Panel.
- Confirm admin/Dev role can see Developer Control Panel.
- Confirm panel does not show payloads, tokens, passwords, cart contents, or full sensitive records.
- Confirm dangerous tools are not exposed in the panel.
- Confirm manual replay remains gated and explicit.

## Mobile/Capacitor Readiness

- Confirm whether this release includes mobile/Capacitor deployment. If not, mark not applicable.
- Confirm mobile storage persistence behavior is tested before any mobile rollout.
- Confirm token storage expectations are defined.
- Confirm suspend/resume does not trigger replay.
- Confirm auto-sync remains disabled on mobile.
- Confirm IndexedDB/schema migration risk is understood per platform.

## Performance Sanity Checks

- Confirm frontend loads within acceptable time on target devices.
- Confirm dashboard and POS screens remain responsive.
- Confirm Developer Control Panel manual refresh is lightweight.
- Confirm backup exports are not run during busy POS hours unless necessary.
- Confirm MySQL table growth and audit table size are understood.
- Confirm PHP/API request limits are understood on shared hosting.

## First Production Rollout Constraints

Initial rollout constraints:

- limited users/devices
- manual replay only
- auto-sync disabled
- no polling/listeners/background workers/startup replay
- no automatic hydration
- no update hydration/conflict resolution
- dangerous tooling admin-only and mostly absent
- backup validation required before rollout
- support contact and rollback path known

## Post-Deployment Validation

After deployment:

- Open frontend over HTTPS.
- Confirm API health endpoint works.
- Login with admin/developer account.
- Confirm session restoration works after refresh.
- Create a low-risk CRUD row while backend is online and verify MySQL.
- Create a low-risk CRUD row while backend is unavailable in staging only and verify queue behavior.
- Run manual replay only when safe and explicitly intended.
- Confirm Developer Control Panel shows read-only status.
- Run backup validation for any generated deployment backup.
- Re-run read-only sync reports.
- Record final deployment notes and known blockers.

## Final Go/No-Go

Go only if:

- backup validation passed
- HTTPS is working
- auth/session behavior is verified
- API base URL is correct
- rollback path is known
- auto-sync is disabled
- operational/admin access is verified
- critical sync/replay blockers are understood

No-go if:

- production secrets are in source control
- API URL points to local/staging by mistake
- HTTPS is unavailable
- backup validation failed
- auth/session flow leaks sensitive details
- auto-sync/background behavior is enabled accidentally
- rollback path is unknown
## Release Verification And Manifest

Before packaging deployment notes, run:

```powershell
npm.cmd run release:verify
npm.cmd run release:manifest
```

`release:verify` runs a local production build with a safe `VITE_API_BASE_URL` value when one is not supplied, checks `dist/` output, scans for obvious localhost leakage, verifies required docs/checklists, verifies backup and validation scripts exist, verifies the Developer Control Panel foundation exists, and verifies auth/session foundation files exist.

`release:manifest` writes a JSON release manifest under `releases/` with timestamp, git metadata when available, app version, included docs/checklists, backup tooling status, sync architecture status summary, auto-sync status, auth enforcement expectations, and known blockers/warnings placeholders.

These commands are manual-first release preparation only. They do not deploy, enable auto-sync, add CI/CD, trigger replay, apply hydration, or change runtime sync behavior.
Checkpoint reference: [release-checkpoint-production-build-verification.md](./release-checkpoint-production-build-verification.md)

This checkpoint records that `release:verify` and `release:manifest` exist, production build verification passed, `dist/` contains `index.html` and assets, localhost leakage matches were `0`, verifier errors were `0`, verifier warnings were `0`, and the latest manifest was written to `releases/release-manifest-2026-05-25T17-03-53-150Z.json`.
