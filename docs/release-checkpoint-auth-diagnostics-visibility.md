# Release Checkpoint: Auth Diagnostics Visibility

Suggested git tag: `auth-diagnostics-visibility-before-login-ui`

## Milestone Summary

This checkpoint records the dev-only auth diagnostics visibility added to the Settings Developer Sync Replay section before login UI, hard auth enforcement, or auto-sync work.

The diagnostics are visibility-only. They do not authenticate the user, do not enable backend enforcement, and do not start sync automatically.

## Settings Developer Sync Replay Diagnostics

The Settings Developer Sync Replay section now shows safe auth diagnostics:

- token present: yes/no
- backend auth enforcement: on/off/unknown
- backend auth status: absent/valid/invalid/unknown
- last replay auth status: none/401/403
- safe actor metadata when available:
  - actor type
  - actor id
  - actor role

## Safety Rules

The diagnostics must never display:

- raw bearer token
- passwords
- password hashes
- token hashes
- payload bodies
- full customer/supplier records
- full item bodies
- session secrets

## Explicitly Not Implemented

This checkpoint does not add:

- login UI
- backend login/session exchange
- auth enforcement by default
- auto-sync
- startup replay
- online/offline replay listeners
- polling or intervals

`CRUD_AUTH_ENFORCEMENT` remains default-off. Backend CRUD auth remains audit-only unless explicitly enabled in a controlled environment.

## Verified Results

Latest verified results at this checkpoint:

- `test:frontend:auth-token` => `12 passed, 0 failed`
- `test:crud:auth-audit` => `9 passed, 0 failed`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

## Rollback Value

This checkpoint separates safe auth diagnostics visibility from future login UI and hard enforcement. If future login or enforcement work introduces regressions, this checkpoint identifies the state where developers could inspect auth status safely without changing auth behavior.

## Safety Warning

Do not treat diagnostics as authentication. They are only display metadata for development/operator visibility.

Do not enable auto-sync from this state. Auth enforcement, login/session handling, token refresh, and safe retry behavior still need staged rollout.
