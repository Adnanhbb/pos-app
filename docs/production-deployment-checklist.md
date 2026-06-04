# Production Deployment Checklist

This checklist prepares a client production hosting rollout. It is operational preparation only: it does not deploy anything, enable auto-sync, change runtime sync behavior, or add CI/CD automation.

## Frontend Build Verification

- Confirm production API URL is set through `VITE_API_BASE_URL`.
- Run `npx.cmd tsc -b`.
- Run `npm.cmd run build` in staging before production upload.
- Confirm `dist/` assets are generated from the intended commit/tag.
- Confirm no production secrets are embedded in frontend build output.
- Confirm Developer Control Panel remains `Dev`-only. Normal `admin`, `saleboy`, staff, cashier, and manager roles must not see it.

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
- Confirm `VITE_ALLOW_OFFLINE_LOGIN` intended state. It defaults to `false`.
- Enable `VITE_ALLOW_OFFLINE_LOGIN=true` only after explicitly approving device-local offline access for this single-client deployment.
- Confirm an online backend credential rejection never falls back to local IndexedDB login.
- Confirm stale localStorage login markers do not restore authenticated UI when a reachable backend rejects the session.
- Record the current legacy risk: local offline fallback still compares the IndexedDB `Password` field. Keep offline access limited to approved client devices until a local salted-verifier migration exists.
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
npm.cmd run sync:review-issues
npm.cmd run sync:evaluate-auto-sync
```

- If the admin `Sync Status` tab shows failed rows but CLI review reports an
  empty queue, run the review against the live Chrome profile used by the
  Laragon/client session:

```powershell
npm.cmd run sync:review-issues -- --profile=chrome-profile-1
npm.cmd run sync:archive-issues:dry -- --profile=chrome-profile-1
```

- Use `--profile=chrome-default` instead if the app is running from Chrome's
  Default profile, or pass an exact path with `--user-data-dir="<path>"`.
- Prefer the in-app Settings `Sync Status` issue review/export when the browser
  profile is unclear. `View issues` and `Download issue summary` read from the
  running app's active IndexedDB context and include only safe metadata.
- Keep archive dry-run as the first step. Do not run apply until the candidate
  rows have been reviewed.
- Confirm local queue health is understood.
- Confirm failed local queue issues are reviewed before using any archive action.
- Confirm failed replay rows are classified or intentionally blocked.
- Confirm stale replay locks are absent or manually reviewed.
- Confirm auto-sync evaluator remains blocked or intentionally disabled.
- Run `npm.cmd run test:transactions:manual-replay-regression` before any
  release that changes finalized Sale, Purchase, Customer Return, Supplier
  Return, replay routing, replay auth, or transaction endpoint code.
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
- Confirm `VITE_ALLOW_OFFLINE_LOGIN` matches the approved client-device policy; do not inherit it accidentally from a rehearsal shell.
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

- Confirm a DB-backed `Dev` support user exists for Developer Control Panel access.
- Confirm normal staff cannot see Developer Control Panel.
- Confirm only the exact DB-backed `Dev` role can see Developer Control Panel.
- Confirm lowercase `admin` can see the Settings `Sync Status` tab.
- Confirm lowercase `admin` cannot see Developer Control Panel.
- Confirm `saleboy`, staff, cashier, and manager roles cannot see the Settings `Sync Status` tab.
- Confirm admin-facing Sync Status labels use client-friendly wording such as `All data is synced`, `Not sent yet`, `Could not sync`, `Needs attention`, `Last checked`, `Last sync attempt`, and `Sync Now`.
- Confirm admin-facing Sync Status does not show raw payloads, replay bodies, tokens, hashes, backend responses, queue internals, or developer diagnostics.
- Confirm failed queue issue review shows plain-language categories only.
- Confirm `Storage source`, `View issues`, and `Download issue summary` are
  present for Admin/Dev and read from the active app storage context.
- Confirm downloaded issue summaries omit full payload bodies, raw backend
  responses, tokens, passwords, hashes, and Admin-only exports omit Dev reason
  codes.
- Confirm `Archive selected` is explicit and only applies to failed stale CRUD rows; failed finalized transaction/payment rows must remain support-review-only.
- Confirm only exact-role `Dev` can archive confirmed test/rehearsal business
  rows, and only after checking the explicit confirmation.
- Confirm admin cannot archive business transaction/payment rows and still sees
  `Ask support to review`.
- Confirm Dev business-row archive stores `archivedAt`, `archivedReason`,
  `archivedFromStatus`, and `archivedByRole`, while preserving `status =
  archived`.
- Confirm archived queue rows are preserved with an archive status, not deleted and not counted as successfully synced.
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
- Login with the intended DB-backed account. Use exact role `Dev` only when verifying Developer Control Panel access.
- Confirm session restoration works after refresh.
- Create a low-risk CRUD row while backend is online and verify MySQL.
- Create a low-risk CRUD row while backend is unavailable in staging only and verify queue behavior.
- Run manual replay only when safe and explicitly intended.
- Run `npm.cmd run test:transactions:manual-replay-regression` in staging or
  local production rehearsal to confirm finalized Sale, Purchase, Customer
  Return, and Supplier Return replay remain ready-gated, idempotent, auth-gated,
  and manual-only.
- In Laragon/staging rehearsal, use only a clearly named low-risk lookup fixture for manual replay verification.
- Confirm the fixture remains pending before the explicit replay click, becomes done afterward, mirrors `serverId`, and is not duplicated by a second explicit replay click.
- Confirm a safely rejected low-risk fixture is reported through a safe summary and transitions to failed rather than remaining stranded in processing.
- Never use sales, sale items, payments, stock, accounting, batches, or cylinders as manual replay rehearsal fixtures.
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

## Dry-Run Deployment Package Preparation

A local deployment package preparation command exists:

```powershell
npm.cmd run deployment:package
```

This command is preparation only. It runs a production build, creates a local `deployment-package/` folder, copies `dist/` output into `deployment-package/frontend/`, copies backend PHP files into `deployment-package/api/`, includes selected public deployment documentation under `deployment-package/docs/`, and writes `deployment-package/deployment-manifest.json`.

The package excludes `node_modules/`, `backups/`, `releases/`, `.git/`, logs, local environment files, and `tsconfig.tsbuildinfo`. It includes `.env.production.example` only. Real production secrets must be configured on the hosting provider or server and must never be packaged.

The manifest records `deploymentPerformed: false`, `uploadPerformed: false`, and `autoSyncEnabled: false`. Actual hosting upload remains manual and outside this repository tooling.

## Hosting-Agnostic Deployment Rehearsal

Before real hosting is available, use [hosting-agnostic-deployment-rehearsal.md](./hosting-agnostic-deployment-rehearsal.md) as the manual rehearsal runbook. It defines shared-hosting and VPS layouts, frontend/API upload locations, MySQL import order, environment/config setup, HTTPS/CORS checks, first admin setup, post-upload health/login/CRUD/manual replay checks, Developer Control Panel checks, rollback steps, and go/no-go criteria.

The rehearsal guide is documentation-only and requires no hosting credentials. It does not deploy, upload, add CI/CD, change runtime behavior, or enable auto-sync.

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

## Warning Classification For Local Vs Real Hosting

The automated rehearsal report separates warnings from blockers:

- `[ACCEPTABLE LOCAL REHEARSAL]` means the reference is expected for Laragon/local checklist use and does not block the local rehearsal.
- `[REAL HOSTING REVIEW REQUIRED]` means the local rehearsal can pass, but a human must replace or approve the value before real hosting upload.
- Blocking failures are failed checks, not warnings.

Local CORS origins such as `localhost`, `127.0.0.1`, or Laragon paths are allowed only during Laragon rehearsal. Before real hosting deployment, CORS must be reviewed and updated to the production HTTPS frontend origin/API domain. Passing the local rehearsal does not mean the package is ready for real hosting upload.

## Database-Backed Developer Support Access

- Keep `VITE_ENABLE_DEV_BACKDOOR=false` for rehearsal, package, staging, and production builds.
- Use a client-specific database-backed support user with exact role `Dev` for Developer Control Panel access. Lowercase `admin` remains a normal client role and must not receive panel access.
- Create the support user only when missing during controlled client setup:

```powershell
$env:SUPPORT_USER_USERNAME="<client-specific-support-username>"
$env:SUPPORT_USER_PASSWORD="<enter-secret-privately>"
$env:SUPPORT_USER_ROLE="Dev"
npm.cmd run support:user:create
Remove-Item Env:SUPPORT_USER_PASSWORD
```

- Confirm the setup command reports only whether the account exists or was created. It must never print the password, password hash, or bearer token.
- Confirm the database-backed support user can login and access the protected Developer Control Panel.
- Treat `VITE_ENABLE_DEV_BACKDOOR=true` in any client package as a no-go condition.
## Packaged Developer Control Panel And Backup Tool Verification

`npm.cmd run sync:verify-existing` now verifies the copied Laragon frontend role boundary with isolated browser role state:

- only exact role `Dev` can see and open the read-only Developer Control Panel.
- `admin`, `saleboy`, staff, cashier, and manager roles cannot see the Developer Control Panel navigation entry.
- Backup Status is informational only.
- no restore/import/delete/apply/replay/export action buttons are exposed by the panel.
- a sentinel bearer token is never rendered in the panel.

The browser check does not use the disabled frontend backdoor and does not create real sessions. Run backup tooling separately through explicit CLI commands. Export writes backup files under `backups/`; validation reads backup JSON and computes SHA-256 checksums. Restore/import remains unimplemented.

## Invoice Cancellation Handover Safety

- Confirm invoice viewing, search, filtering, and printing remain available.
- Confirm invoice delete/cancel buttons are not exposed in the client UI.
- Treat invoice cancellation as temporarily disabled until a complete atomic reversal is implemented and verified for stock, batches, cylinders, customer/supplier balances, payments, and accounting.
- Do not perform manual IndexedDB or MySQL deletion as a workaround.
