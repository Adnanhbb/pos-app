# Release Checkpoint: Authenticated Manual Replay Gate

Suggested git tag: `authenticated-manual-replay-gate-before-autosync`

## Milestone Summary

Settings Developer Sync Replay now has an authenticated manual replay gate before any call to `syncEngine.processPending()`.

This checkpoint records the manual replay auth boundary before any auto-sync, background replay, polling, listeners, background workers, startup replay, or automatic retry behavior exists.

## Manual Replay Gate Behavior

`Run Manual Replay` validates auth/enforcement before replay starts.

The gate checks current CRUD auth diagnostics and, when enforcement is enabled, validates the current token-backed session through the existing session flow.

## Enforcement ON

When CRUD auth enforcement is on:

- missing token blocks replay safely
- invalid or expired session blocks replay safely
- valid session allows manual replay

Blocked replay does not call `syncEngine.processPending()`.

## Enforcement OFF / Audit Mode

When CRUD auth enforcement is off:

- manual replay remains allowed
- the UI reports the `enforcementDisabled` diagnostic state
- auth diagnostics remain visible for operator awareness

This preserves the current default audit-only behavior.

## Enforcement Unknown

When enforcement state is unknown:

- manual replay is blocked safely
- a safe auth status message is shown
- no replay is started

## UI Diagnostics

Settings Developer Sync Replay now shows:

- last replay auth gate state
- gate result
- session validation timestamp
- safe auth message/status

The UI never displays:

- raw bearer tokens
- passwords
- sensitive session bodies
- payload bodies
- full auth/session records

## Retry Boundary

No automatic retry loop was added. Users must explicitly click the manual replay action again after resolving auth/session issues.

## Verified Results

Latest verification:

- `test:frontend:auth-token` => 27 passed, 0 failed
- `test:crud:auth-enforcement` => 14 passed, 0 failed
- `test:sync:real-low-risk` => 39 passed, 0 failed
- `test:sync:low-risk` => 79 passed, 0 failed

## Safety Boundary

This checkpoint is documentation-only.

Still not added:

- auto-sync
- background replay
- polling
- online/offline listeners
- background workers
- startup replay
- automatic retry loops
- hydration apply automation
- replay semantic changes
