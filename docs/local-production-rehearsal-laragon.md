# Local Production Rehearsal With Laragon

This checklist rehearses a production-like deployment locally with Laragon before real client hosting is available. It is documentation/checklist only: it does not deploy to real hosting, change runtime behavior, add CI/CD, or enable auto-sync.

## Purpose Of Local Rehearsal

The local rehearsal validates the deployment shape before hosting is known:

- package generation works
- frontend build output can be served as static files
- backend `api/` files can run under PHP/MySQL
- schema import order is understood
- health/login/session checks are repeatable
- low-risk CRUD sync can be verified manually
- manual replay and Developer Control Panel checks are understood
- backup/export/validation and rollback habits are practiced

This rehearsal is a confidence exercise, not a production deployment.

## How This Differs From Real Hosting

Laragon is local and forgiving compared to real hosting. Real hosting still needs:

- real domain and final public URL
- HTTPS/TLS certificate
- production MySQL credentials
- hosting PHP/MySQL versions and extensions
- secure server-side environment/config handling
- production CORS/frontend origin setup
- server backup scheduling and retention
- hosting log access and rollback process

A Laragon pass does not prove shared-hosting or VPS compatibility; it proves the package and operational sequence are ready to adapt.

## Laragon Folder Layout

Recommended local rehearsal layout:

```text
C:\laragon\www\jawad-bro-rehearsal\
  index.html
  assets\
  api\
```

Source package layout:

```text
deployment-package\
  frontend\
  api\
  docs\
  .env.production.example
  deployment-manifest.json
```

Do not copy the wrapper folder unless you intentionally want the app under `/deployment-package/`. Copy its contents into the rehearsal web root.

## Generate The Package

From the project root:

```powershell
npm.cmd run deployment:package
```

Expected output:

- package path: `deployment-package/`
- frontend files under `deployment-package/frontend/`
- backend files under `deployment-package/api/`
- manifest at `deployment-package/deployment-manifest.json`
- `deploymentPerformed: false`
- `uploadPerformed: false`
- `autoSyncEnabled: false`

## Copy Frontend Files

Rehearsal copy target:

```text
C:\laragon\www\jawad-bro-rehearsal\
```

Copy contents of:

```text
deployment-package\frontend\*
```

into the target web root. Confirm `index.html` and `assets/` exist in the target.

## Copy API Folder

Copy:

```text
deployment-package\api\
```

into:

```text
C:\laragon\www\jawad-bro-rehearsal\api\
```

Confirm these local URLs can exist after Laragon reload/restart:

- `http://localhost/jawad-bro-rehearsal/`
- `http://localhost/jawad-bro-rehearsal/api/health.php`

## Import `schema.sql`

Use Laragon/MySQL tooling such as phpMyAdmin, Adminer, HeidiSQL, or the MySQL CLI.

Suggested rehearsal order:

1. create a new rehearsal database, for example `jawad_bro_rehearsal`
2. create or select a local DB user
3. import `deployment-package/api/sql/schema.sql`
4. confirm core tables exist
5. confirm replay/audit/sales/payment/batch/cylinder tables exist where expected
6. do not import production data unless explicitly rehearsing backup handling

Do not run replay, repair, cleanup, archival, or hydration apply tools during schema import.

## Set Local Production-Like API Base URL

For a local build rehearsal, the production-like API base URL should point at the rehearsal API path:

```powershell
$env:VITE_API_BASE_URL="http://localhost/jawad-bro-rehearsal/api"
npm.cmd run build
```

For package rehearsal through `deployment:package`, ensure the package manifest records the intended public API URL used for that build. For real hosting, this must become the real HTTPS API URL.

## Configure Local Backend Database Access

Use `.env.production.example` as a checklist only. For Laragon rehearsal, configure DB settings according to the backend's supported local config path or environment handling.

Do not commit local DB passwords. Do not copy real `.env` files into public web roots.

## Test `health.php`

Open or request:

```text
http://localhost/jawad-bro-rehearsal/api/health.php
```

Expected:

- HTTP 200
- safe success/health response
- no PHP warnings/notices displayed publicly
- no secret values in response

## Test Login And Session

Rehearsal checks:

- `login.php` accepts a known local test/admin user
- invalid login fails safely
- bearer token is returned only once
- `session.php` returns safe actor/session metadata
- `logout.php` revokes the token
- no raw passwords/tokens appear in UI, network logs beyond the expected bearer response, PHP errors, or console output

## Test Low-Risk CRUD Sync

Use safe low-risk entities only:

- units
- taxes
- discounts
- brands
- categories
- customers/suppliers profile fields
- settings safe fields
- users safe fields
- held records

Suggested checks:

1. create a brand/unit in the UI while backend is reachable
2. confirm backend MySQL row appears
3. stop or disconnect the local API briefly
4. create another low-risk row locally
5. confirm pending queue count appears
6. restore the API
7. use manual replay only
8. confirm queue row completes and local row gets `serverId`

Do not test direct stock/accounting CRUD replay. Transactional replay must remain backend-authoritative.

## Test Manual Replay

In Settings Developer Sync Replay:

- refresh queue counts
- confirm auth/enforcement state is visible
- confirm POS activity state is idle
- run manual replay only on click
- confirm diagnostics show processed/succeeded/failed/skipped
- confirm no payload bodies, passwords, or tokens are displayed

Auto-sync must remain disabled. Do not add polling, listeners, workers, startup replay, or automatic retries.

## Test Developer Control Panel

Verify:

- admin/Dev roles can access the Developer Control Panel
- normal staff/saleboy cannot see advanced diagnostics
- sections render read-only status: System Health, Sync Status, Replay Status, Auth Status, Backup Status, Auto-sync Eligibility, POS Activity Status
- manual refresh works
- no direct DB editing, replay mutation controls, payload display, token display, or stock/accounting mutation tools appear

## Test Backup, Export, And Validation

Run rehearsal exports where applicable:

```powershell
npm.cmd run backup:indexeddb:export
npm.cmd run backup:mysql:export
npm.cmd run backup:validate -- backups/<backup-file>.json
```

Expected:

- backup files are generated locally under `backups/`
- sensitive fields are redacted/omitted
- validation reports `ok: true`
- checksums are recorded
- restore/import remains unimplemented

Do not upload backup files into the rehearsal web root.

## Test Release Verification

Run:

```powershell
npm.cmd run release:verify
```

Expected:

- build succeeds
- `dist/` exists with `index.html` and assets
- verifier errors: `0`
- verifier warnings: `0`
- localhost leakage matches: `0` for the verifier's production URL scenario

Vite may still print browser data or large chunk advisories; record them separately from verifier failures.

## Check No Localhost Leakage In Production Package

Inspect the package manifest and build output before real deployment:

- `deployment-manifest.json` records the intended API URL
- no accidental Laragon/local API URL is present when preparing a real-hosting package
- `.env.production.example` contains placeholders only
- no local `.env` files are included

For Laragon rehearsal, localhost URLs are expected only when intentionally building for the rehearsal target.

## Rollback Rehearsal

Practice rollback locally:

1. keep a copy of the previous rehearsal folder
2. keep a DB export/checksum before schema/data changes
3. replace current frontend/API files with the previous copy
4. restore the rehearsal DB only in a separate test database unless intentionally practicing restore
5. run health/login checks again
6. do not blindly replay stale queues after rollback

## Go/No-Go Checklist

Local rehearsal go conditions:

- package generation passes
- frontend loads from Laragon web root
- API health works
- schema import succeeds
- login/session/logout work safely
- low-risk CRUD sync works manually
- manual replay is gated and operator-triggered only
- Developer Control Panel is protected and read-only
- backup/export validation runs
- release verification passes
- no real secrets are copied into the web root
- auto-sync remains disabled

No-go conditions:

- PHP errors display publicly
- API cannot connect to MySQL
- login/session flow fails
- frontend points at wrong API URL
- generated package includes secrets or forbidden folders
- backup validation fails
- manual replay requires enabling auto-sync
- normal staff can access developer diagnostics

## Do Not Confuse This With Real Deployment

This Laragon rehearsal does not replace production rollout checks. Real hosting still requires:

- final domain and API URL
- SSL/TLS certificate and HTTPS enforcement
- real DB credentials configured securely
- production PHP/MySQL compatibility verification
- production CORS/frontend origin setup
- server environment/config management
- hosting backup/retention setup
- server log access
- rollback access on the host

Treat Laragon as a dress rehearsal for package structure and operator steps, not proof that the client host is ready.
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

## Minimum Practical Execution Steps

Use this compact sequence when you are ready to actually run the Laragon rehearsal.

### 1. Regenerate The Package For The Laragon API URL

The package command uses `VITE_API_BASE_URL`. For a Laragon rehearsal, set it before packaging so the copied frontend calls the local rehearsal API instead of the placeholder production URL:

```powershell
$env:VITE_API_BASE_URL="http://localhost/jawad-bro-rehearsal/api"
npm.cmd run deployment:package
npm.cmd run rehearsal:local-production
```

Check `deployment-package/deployment-manifest.json` and confirm:

```json
"VITE_API_BASE_URL": "http://localhost/jawad-bro-rehearsal/api"
```

If the manifest still shows `https://api.example.com`, regenerate the package with the environment variable above before copying files into Laragon.

### 2. Create The Laragon Web Root

Create this folder if it does not exist:

```text
C:\laragon\www\jawad-bro-rehearsal\
```

Copy only the contents of `deployment-package/frontend/` into that folder:

```text
C:\laragon\www\jawad-bro-rehearsal\index.html
C:\laragon\www\jawad-bro-rehearsal\assets\
C:\laragon\www\jawad-bro-rehearsal\images\
```

Do not copy `deployment-package/` as a parent wrapper into the web root.

### 3. Copy The API Folder

Copy the packaged API folder to:

```text
C:\laragon\www\jawad-bro-rehearsal\api\
```

Expected first endpoint:

```text
http://localhost/jawad-bro-rehearsal/api/health.php
```

Test `health.php` before opening the frontend.

### 4. Create Or Select The Local MySQL Database

The packaged backend currently defaults to these local DB settings if environment variables are not supplied:

```text
DB_HOST=localhost
DB_NAME=jawad_bro
DB_USER=root
DB_PASS=
```

For an isolated rehearsal database, create `jawad_bro_rehearsal` in Laragon/MySQL and configure `DB_NAME=jawad_bro_rehearsal` through Laragon/Apache environment handling or a local-only config adjustment in the rehearsal copy. Do not commit local credentials or local config edits.

Import:

```text
deployment-package\api\sql\schema.sql
```

Then verify the schema before doing UI checks.

### 5. First URLs To Test

Test in this order:

1. `http://localhost/jawad-bro-rehearsal/api/health.php`
2. `http://localhost/jawad-bro-rehearsal/`
3. login/session/logout flow from the app or API client
4. create one low-risk CRUD record, such as a brand or unit
5. confirm the MySQL row exists
6. use Settings Developer Sync Replay only for queued/offline rows
7. open Developer Control Panel as admin/Dev and confirm read-only status

### 6. Before And After Checks

Before copying into Laragon:

```powershell
npx.cmd tsc -b
npm.cmd run deployment:package
npm.cmd run rehearsal:local-production
npm.cmd run release:verify
```

After copying into Laragon, manually verify:

- frontend loads from `http://localhost/jawad-bro-rehearsal/`
- API health endpoint returns safe success output
- login/session works
- low-risk CRUD sync works while backend is reachable
- manual replay remains click-only
- Developer Control Panel remains admin/Dev-only and read-only
- auto-sync remains disabled

### 7. Current Package Readiness Note

The latest generated rehearsal report passes, but it warns that packaged CORS config includes local origins. That is acceptable for Laragon rehearsal. Before real hosting upload, replace/review those CORS origins with the real HTTPS frontend/API domain.

## Safe Laragon Automation Runner

A local-only setup/check runner exists:

```powershell
npm.cmd run rehearsal:laragon
```

Default behavior:

- uses `http://localhost/jawad-bro-rehearsal/api` unless `--api-url=<url>` or `LARAGON_REHEARSAL_API_URL` is provided
- regenerates `deployment-package/` with that `VITE_API_BASE_URL`
- runs `npm.cmd run rehearsal:local-production`
- checks the expected Laragon target path
- checks safe endpoints: `health.php`, `login.php`, `session.php`
- writes `laragon-rehearsal-run-report.json` and `laragon-rehearsal-run-report.md`
- does not copy files unless `--copy` is provided

To copy the package into the default Laragon rehearsal folder after verification:

```powershell
npm.cmd run rehearsal:laragon -- --copy
```

To override the API URL or target folder:

```powershell
npm.cmd run rehearsal:laragon -- --api-url=http://localhost/jawad-bro-rehearsal/api --target=C:\laragon\www\jawad-bro-rehearsal
```

The runner never uploads to real hosting, never enables auto-sync, never mutates IndexedDB/MySQL/replay queues/stock/accounting/auth tokens/business data, and never runs restore/import/rollback actions.

Still manual:

- creating/importing the local MySQL rehearsal database
- visual UI verification
- invoice print verification
- login with a known local admin/test user
- low-risk CRUD test data creation
- manual replay approval
- accounting/business validation review
- rollback approval
