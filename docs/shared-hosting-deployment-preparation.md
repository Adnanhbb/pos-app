# Shared Hosting Deployment Preparation

This runbook prepares the first real shared-hosting upload. It does not perform
the upload, deploy files, import a real database, or configure real secrets.

## Hosting Information To Collect

Record these values in the private deployment handover record, not in Git:

- production frontend domain or subdomain
- whether the app is hosted at `/` or a public subfolder
- final HTTPS API URL
- hosting document root, commonly `public_html/`
- API target path, commonly `public_html/api/`
- PHP version and enabled extensions
- MySQL or MariaDB version
- database host, name, username, and password
- hosting method for environment variables or private PHP configuration
- SSL certificate status and renewal owner
- frontend CORS origin
- file-manager/SFTP account owner
- database backup and deployment rollback owner

Recommended server baseline: PHP 8.1 or newer with PDO MySQL and JSON support.
Confirm the host allows PHP authorization headers and the HTTP methods used by
the API: GET, POST, PUT, PATCH, DELETE, and OPTIONS.

## Domain And Folder Layout

For a same-domain root deployment:

```text
public_html/
  index.html
  assets/
  api/
```

- Copy `deployment-package/frontend/*` into `public_html/`.
- Copy `deployment-package/api/*` into `public_html/api/`.
- Build with `VITE_BASE_PATH=/`.
- Set `VITE_API_BASE_URL=https://<domain>/api`.

For a frontend subfolder, build with the exact leading/trailing slash:

```powershell
$env:VITE_API_BASE_URL="https://<domain>/<app-folder>/api"
$env:VITE_BASE_PATH="/<app-folder>/"
$env:VITE_ENABLE_DEV_BACKDOOR="false"
$env:VITE_ALLOW_OFFLINE_LOGIN="false"
npm.cmd run deployment:package
```

Do not upload a Laragon package. Its manifest intentionally contains localhost
and `/jawad-bro-rehearsal/`.

## Database Preparation

1. Create a dedicated production database and least-privilege database user.
2. Save credentials only in the hosting control panel or a private server
   configuration outside the public web root where supported.
3. Import `deployment-package/api/sql/schema.sql` once.
4. Confirm `schema_migrations` contains the expected migration records.
5. Confirm auth, replay, sales, payment, batch, and cylinder tables exist.
6. Do not import local IndexedDB backup JSON into MySQL.
7. Take a hosting database backup immediately after schema import.

Required server values:

```text
DB_HOST
DB_NAME
DB_USER
DB_PASS
CRUD_AUTH_ENFORCEMENT
REPLAY_WORKER_TOKEN
FRONTEND_ORIGIN
CORS_ALLOW_LOCAL=false
```

Start with the reviewed `CRUD_AUTH_ENFORCEMENT` policy from the production
checklist. Generate a strong replay worker token privately. Never place either
database credentials or the replay token in frontend files.

## CORS And HTTPS

- HTTPS is mandatory for the frontend and API.
- Set `FRONTEND_ORIGIN` to the exact HTTPS frontend origin.
- Multiple controlled origins may be comma-separated during a staged rollout.
- Keep `CORS_ALLOW_LOCAL=false` in production.
- Same-origin frontend and `/api` hosting normally needs no cross-origin header.
- Do not use wildcard production CORS with credentialed requests.
- Redirect HTTP to HTTPS only after the HTTPS endpoint is confirmed healthy.

## File Permissions

- Use normal read permissions for frontend assets and PHP source.
- Grant write permission only to directories that genuinely require it.
- Do not make the complete application tree world-writable.
- Keep private configuration and server logs outside `public_html` where the
  hosting provider permits it.
- Disable directory listing and PHP error display in production.

## Package Preparation And Local Gate

Set the real public build values locally without committing them:

```powershell
$env:VITE_API_BASE_URL="https://<production-domain>/api"
$env:VITE_BASE_PATH="/"
$env:VITE_ENABLE_DEV_BACKDOOR="false"
$env:VITE_ALLOW_OFFLINE_LOGIN="false"
npm.cmd run deployment:package
npm.cmd run hosting:verify-readiness
Remove-Item Env:VITE_API_BASE_URL
Remove-Item Env:VITE_BASE_PATH
Remove-Item Env:VITE_ENABLE_DEV_BACKDOOR
Remove-Item Env:VITE_ALLOW_OFFLINE_LOGIN
```

Inspect `deployment-package/deployment-manifest.json`. It must show:

- the intended HTTPS API URL and asset base path
- `deploymentPerformed: false`
- `uploadPerformed: false`
- `autoSyncEnabled: false`
- developer backdoor disabled
- offline login disabled unless separately approved
- no forbidden package paths

## Upload Order For The Future Deployment Task

Do not perform these steps until the package and backups are reviewed:

1. Export and validate IndexedDB.
2. Export and validate the current MySQL database if one exists.
3. Preserve the previous deployed frontend/API package.
4. Upload API files to the selected `/api` location.
5. Configure private server environment values.
6. Import/verify schema.
7. Check API health/login/session.
8. Upload frontend assets last.
9. Perform first-login and business smoke checks.

## First Endpoint Checks

Use HTTPS and do not print credentials or bearer tokens:

- `GET /api/health.php` returns a safe success response.
- unauthenticated `GET /api/session.php` rejects safely.
- invalid `POST /api/login.php` rejects without leaking fields.
- approved Admin and DB-backed Dev accounts can log in.
- logout revokes the session.

## Support User

Create the client-specific DB-backed support user through the approved command
after production database configuration is active:

```powershell
$env:SUPPORT_USER_USERNAME="<private-support-username>"
$env:SUPPORT_USER_PASSWORD="<private-strong-password>"
$env:SUPPORT_USER_ROLE="Dev"
npm.cmd run support:user:create
Remove-Item Env:SUPPORT_USER_PASSWORD
```

Do not use or enable the frontend development backdoor. Confirm the Developer
Control Panel remains exact-`Dev` only.

## Post-Upload Manual Validation

- login, logout, and refresh/session restore
- Admin and staff role restrictions
- low-risk backend-aware CRUD
- one approved, mapped rehearsal transaction through explicit manual replay
- second replay remains idempotent
- unsafe queue rows remain blocked
- backup export and validation
- invoice view/print availability
- Sync Status remains manual and auto-sync remains disabled

Do not use real customer stock/accounting data for deployment testing.

## Backup And Rollback

Before upload, retain:

- validated IndexedDB backup and checksum
- validated MySQL backup and checksum
- previous frontend/API package
- current database schema/version record
- deployment manifest and commit/tag reference

Rollback:

1. Stop further manual replay.
2. Preserve logs and current backups.
3. Restore the previous frontend/API files.
4. Do not restore MySQL unless the database owner confirms it is required.
5. Never overwrite browser IndexedDB or replay an old queue blindly.
6. Re-run health, login/session, backup, and sync-status checks.

## Go / No-Go

Go only when:

- `hosting:verify-readiness` passes
- manifest contains the real HTTPS API URL/base path
- SSL, CORS, PHP/PDO, database, backup, and rollback ownership are confirmed
- auth/session and manual replay gates pass
- no unexplained failed sync rows remain

No-Go when:

- the package contains localhost or placeholder production URLs
- real credentials appear in files or Git
- SSL/CORS/server environment is unknown
- backup validation or restore rehearsal fails
- developer backdoor or unapproved offline login is enabled
- auto-sync/background replay is present
- rollback ownership is unclear
