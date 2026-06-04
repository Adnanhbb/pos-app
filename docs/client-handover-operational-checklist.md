# Client Handover Operational Checklist

This checklist is for final client handover readiness. It is documentation only.
It does not change POS behavior, transaction behavior, replay behavior,
restore/import behavior, sync behavior, or auto-sync status.

Auto-sync remains disabled. Manual replay remains explicit and operator-gated.

## Pre-Handover Checks

Authentication and access:

- Login works for the intended DB-backed admin user.
- Logout keeps the user on the login screen.
- Refresh after login restores the signed-in user correctly.
- Admin can open Settings and see the Sync Status tab.
- Admin cannot see the Developer Control Panel.
- Exact-role Dev can open the Developer Control Panel when support access is needed.
- Saleboy, staff, cashier, and manager roles cannot see Sync Status or Developer Control Panel.
- No password, token, hash, or raw session body is visible in the UI.

Daily POS workflows:

- POS Sale completes successfully.
- Purchase completes successfully.
- Customer Return completes successfully.
- Supplier Return completes successfully.
- Standalone Customer Payment works.
- Standalone Supplier Payment works.
- Invoice number/generation works.
- Invoice view, search, filter, and print are available.
- Invoice deletion/cancellation remains unavailable until safe reversal exists.
- Customer and supplier balances match expected test results.
- Item stock, batches, and cylinder effects match expected test results.

Reports and operational views:

- Core reports open without errors.
- Settings opens without errors.
- Sync Status shows client-friendly wording.
- Developer diagnostics remain Dev-only.
- No payload bodies, raw backend responses, passwords, tokens, or hashes are shown.

Backup and sync:

- IndexedDB backup export works.
- MySQL backup export works when backend is available.
- Backup validation passes with `ok: true`.
- Backup readiness audit passes with no missing IndexedDB stores.
- Sync Status is clean or every failed row has a documented support decision.
- Manual replay regression passes.
- Standalone payment replay regression passes.
- No auto-sync, background sync, polling, workers, listeners, or startup replay is enabled.

## Support And Recovery Checklist

If the app does not open:

- Check the browser URL first.
- Check whether Laragon/hosting is running.
- Check `api/health.php`.
- Check the browser console only for safe high-level errors; do not copy tokens or sensitive bodies.
- Do not clear browser data before backup/export review.

If browser data seems missing:

- Stop and ask support before using the app.
- Do not clear cache, reset the browser, or reinstall the browser.
- Check whether the user opened a different browser/profile.
- Export IndexedDB from the current profile if possible.
- Compare with the latest validated backup.

If backup validation fails:

- Do not rely on that backup for handover or recovery.
- Keep the failed file for support inspection.
- Create a fresh IndexedDB backup and MySQL backup if the app/database are still accessible.
- Run validation again and record the checksum.
- Do not edit backup JSON by hand.

If Sync Status has failed records:

- Do not clear browser data.
- Do not mark rows as synced manually.
- Do not replay repeatedly.
- Use `View issues` / `Download issue summary` from Settings.
- Admin should ask support to review business records.
- Dev may archive confirmed test/rehearsal business rows only with explicit confirmation.
- Real business rows must remain visible until fixed, replayed safely, or reviewed by support.

If a user forgets a password:

- Use the approved admin/support user-management path.
- Do not edit passwords directly in IndexedDB.
- Do not share the Dev support account password casually.
- Do not enable the frontend development backdoor in a client build.

If internet is unavailable:

- Continue only with workflows approved for offline use.
- Do not expect backend/MySQL changes until connectivity returns.
- Check Sync Status before closing the shop.
- Use manual sync only after the connection/API is stable.

If the server/API is unavailable:

- Check `api/health.php`.
- Check hosting/Laragon/MySQL status.
- Do not run replay while the API is unstable.
- Keep local backups before troubleshooting.
- Record any failed sync rows for support.

If the PC is replaced or Windows is reinstalled:

- Do not assume browser data will come back automatically.
- Locate the latest validated IndexedDB and MySQL backups.
- Restore/import application tooling is not implemented yet.
- Treat recovery as a support-led process.
- Do not replay old queues blindly after copying data.

## Client Daily Routine

At close of business:

- Check Settings -> Sync Status.
- If it says all data is synced, continue with backup.
- If records need attention, export/download the issue summary and contact support.
- Create an IndexedDB backup.
- Create a MySQL backup if backend/server was used.
- Validate the backup files.
- Store the backup files somewhere protected.

Important habits:

- Never clear browser data without a verified backup and support approval.
- Never reinstall the browser without a verified backup.
- Never delete backup files just because a new one was created.
- Never share backup files publicly.

## Client Weekly Routine

Once per week:

- Copy the latest validated backup to USB or trusted cloud storage.
- Record backup filenames and checksums.
- Run `backup:audit-readiness`.
- Confirm Sync Status has no unexplained failed rows.
- Confirm login/logout still works for the admin user.
- Confirm the support contact knows where backups are stored.

## Handover Go/No-Go

Go only if:

- TypeScript/build verification passes.
- Manual transaction replay regression passes.
- Standalone payment replay regression passes.
- Auth/session verification passes.
- Release verification passes.
- Sync verification passes.
- Laragon/local rehearsal copy passes when applicable.
- Backup validation passes.
- Backup readiness audit passes.
- Sync queue is clean or every failed row has a documented support decision.
- Authentication and role restrictions are verified.
- API/deployment configuration is known and correct.
- Auto-sync/background sync remains disabled.

No-go if:

- Backup validation fails.
- Backup readiness audit reports missing stores.
- Auth/session tests fail.
- Replay regression tests fail.
- Sync verification fails.
- There are unexplained failed sync rows.
- Login/logout/session restore is unreliable.
- Admin/staff role restrictions are broken.
- Deployment API URL, database credentials, HTTPS, or CORS are missing/unclear.
- Browser data was cleared without a verified backup.
- Any auto-sync, polling, worker, listener, startup replay, or background replay is enabled.

## Verification Commands

Use the actual package scripts:

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

The shorthand script names `test:transactions`, `test:auth`, `release`, `sync`,
and `rehearsal` do not exist in this package. Use the explicit commands above.
