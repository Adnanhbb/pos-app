# Release Candidate Client Handover Audit

This release-candidate audit prepares the project for tag/package review before
the first real client deployment. It is documentation and verification only. It
does not change POS behavior, transaction behavior, replay behavior, sync
behavior, restore/import behavior, or auto-sync status.

## Release Candidate Checklist

Pre-tag checks:

- working tree reviewed before tagging
- no production credentials or real `.env` files committed
- no raw backup files committed or packaged
- no `node_modules/`, `backups/`, `releases/`, `.git/`, logs, or
  `tsconfig.tsbuildinfo` in the deployment package
- no unintended source maps in the current deployment package
- deployment package manifest reviewed
- frontend build output included
- backend/API files included
- database schema files included
- client handover checklist included
- backup/disaster recovery guide included
- production deployment checklist included
- production readiness audit notes included
- localhost/Laragon URLs present only in intentional Laragon rehearsal package
  or documentation/config that is marked for real-hosting review

Verification gates:

- `npx.cmd tsc -b`
- `npm.cmd run test:transactions:manual-replay-regression`
- `npm.cmd run test:transactions:standalone-payment-manual-replay`
- `npm.cmd run test:auth:session`
- `npm.cmd run backup:audit-readiness`
- `npm.cmd run release:verify`
- `npm.cmd run sync:verify-existing`
- `npm.cmd run rehearsal:laragon -- --copy`

Go only when all verification gates pass and every failed sync row is clean,
resolved, archived with explicit support approval, or documented with a support
decision.

## Completed Systems

- local-first IndexedDB POS runtime remains the reference implementation
- backend replay endpoints exist for finalized Sale, finalized Purchase,
  finalized Customer Return, finalized Supplier Return, standalone Customer
  Payment, and standalone Supplier Payment
- replay remains manual, ready-gated, auth-gated, and idempotent
- Settings `Sync Status` provides admin-safe status and active-profile issue
  summaries
- Developer Control Panel remains exact-role `Dev` only
- database-backed Dev support access is documented
- deployment package dry-run tooling exists
- production build verifier exists
- Laragon rehearsal runner exists
- IndexedDB/MySQL export-only backup tools exist
- backup validator and backup readiness audit exist
- client handover and disaster recovery runbooks exist

## Intentionally Disabled Or Deferred

- auto-sync
- background sync
- polling replay
- online/offline listener replay
- startup replay
- service-worker/background-worker replay
- automatic hydration apply
- conflict auto-resolution
- broad multi-device automation
- restore/import apply tooling
- invoice cancellation/reversal
- payment update/delete replay
- automatic queue repair/archive

Deferred does not mean abandoned. These phases remain required for mature
multi-device production sync, but they must wait until production hardening,
backup/restore, auth rollout, and operational visibility are stable.

## Backup And Restore Status

Current backup tooling is export and validation only:

- IndexedDB export exists
- MySQL export exists
- backup validation exists
- backup readiness audit checks expected IndexedDB store coverage
- restore/import is not implemented

Do not promise one-click restore for client handover. Disaster recovery remains
support-led until a future quarantined restore planner and explicit apply flow
exist.

## Manual Replay Status

Manual replay is implemented for the current approved replay scopes only:

- finalized Sale
- finalized Purchase
- finalized Customer Return
- finalized Supplier Return
- standalone Customer Payment create
- standalone Supplier Payment create

Replay is not automatic. Unsafe rows remain blocked. Local IndexedDB ids are
correlation references only and must not be used as MySQL mutation ids.

## Package Audit Expectations

The generated `deployment-package/` should contain:

- `frontend/index.html`
- `frontend/assets/`
- `api/`
- `api/sql/schema.sql`
- `.env.production.example`
- `deployment-manifest.json`
- deployment, rehearsal, handover, backup/disaster-recovery, and production
  readiness docs

The generated package should not contain:

- real secrets
- real `.env` files
- raw backup files
- release manifests
- `node_modules/`
- `.git/`
- logs
- `tsconfig.tsbuildinfo`
- unintended source maps

## Known Remaining Real-Hosting Requirements

These remain open until the client host exists:

- final domain and public frontend URL
- final HTTPS API URL
- SSL/TLS certificate and owner
- shared-hosting or VPS PHP version
- MySQL/MariaDB version
- database host/name/user/password delivery method
- public web root and API upload path
- production CORS/frontend origin
- hosting environment variable or protected config mechanism
- server backup retention and off-host backup ownership
- PHP/server log access
- rollback procedure and approver
- first production admin/support user setup

## Go/No-Go Summary

Release-candidate package/tag review is safe only if:

- all listed verification gates pass
- package manifest reports no forbidden paths
- release verifier reports zero errors
- backup readiness audit reports no missing stores
- auth/session verification passes
- sync verification passes
- Laragon rehearsal copy passes
- production credentials are not committed
- restore/import remains unimplemented and documented
- auto-sync/background behavior remains disabled

No-go if:

- verification gates fail
- package includes secrets or local `.env` files
- package accidentally targets Laragon/local API for a real-hosting build
- backup readiness audit fails
- unexplained failed sync rows remain
- real-hosting HTTPS/CORS/DB/rollback details are unknown for actual upload
- any auto-sync, polling, listener, worker, startup replay, or background replay
  is enabled
