# Release Checkpoint: Auto-Sync Gate Design

Suggested git tag: `auto-sync-gate-designed-before-background-sync`

## Milestone Summary

The controlled auto-sync eligibility gate design is documented in [auto-sync-eligibility-gate.md](./auto-sync-eligibility-gate.md). This checkpoint records the finalized architecture before any background sync implementation exists.

The current system remains manual-first. Sync replay is still initiated through explicit manual/dev actions only.

## Eligibility Gate Exists

The gate defines the runtime checks and product rules that must pass before any future automatic sync, background sync, startup replay, polling, online/offline listener, or worker behavior can be considered.

The gate is default-deny: unknown, unhealthy, or unclassified states block automation.

## Required Checks

Future auto-sync eligibility requires all of the following to be healthy and known:

- auth: user/session is authenticated and actor metadata is safe to identify
- backend reachability: health and required API endpoints are reachable
- queue health: local `sync_queue` is readable and failed/malformed rows are within strict thresholds
- replay lock health: no stale `processing` replay locks or unexplained lock ownership issues
- reconciliation state: no unresolved dangerous local/backend inconsistencies
- hydration safety: no unsafe planner actions, unresolved conflicts, or unclassified manual-review rows
- manual replay baseline: recent manual replay succeeded with safe diagnostics
- POS safety: no active POS billing/cart transaction or unsaved transaction workflow
- operator controls: visible status, pause/disable, manual override, and safe error details exist

## Blocking Conditions

Auto-sync must be blocked by:

- missing or invalid auth
- unknown CRUD auth enforcement state
- unreachable backend
- failed queue rows above threshold
- malformed or orphaned queue rows
- stale replay locks
- transaction replay failures above threshold
- unresolved reconciliation conflicts
- duplicate local `serverId` values
- missing backend rows for local `serverId` values without review
- non-dev/test manual-review hydration rows
- pending unsafe hydration actions or possible conflicts
- active POS billing/cart session
- missing recent successful manual replay baseline
- missing operator-visible sync status or pause/disable control

## Phased Rollout Strategy

The documented rollout remains staged:

- Phase 0: manual only, current state
- Phase 1: dev-only one-click safe sync all
- Phase 2: throttled background low-risk CRUD only
- Phase 3: authenticated transaction replay background sync
- Phase 4: controlled hydration background sync

Each phase requires an explicit gate pass. Passing the low-risk CRUD replay gate does not imply transaction replay or hydration is eligible.

## Operator Visibility Expectations

Before any automatic behavior is allowed, the app should expose:

- current sync eligibility state
- blocked reasons
- last successful sync timestamp
- last attempted sync timestamp
- pending queue count
- failed queue count
- backend reachability state
- auth/enforcement state
- safe failed queue details
- auth error visibility
- pause/resume or disable control
- manual replay/manual override action

The UI must never show raw bearer tokens, passwords, payload bodies, full customer records, full user records, or auth/session secrets.

## No-Go Conditions

Do not enable auto-sync if any of the following remain true:

- no auth or unknown auth state
- no hydration diagnostics
- no hydration planner
- unresolved conflicts
- no reconciliation tooling
- no rollback/audit visibility
- stale replay locks
- failed queue rows above threshold
- transaction replay failures above threshold
- active POS transaction
- no operator-visible sync status
- no pause/disable control
- no bounded retry/backoff policy

## Current Manual-First Boundary

This checkpoint does not enable auto-sync.

Still not implemented:

- background sync
- startup replay
- polling
- online/offline listeners
- background workers
- automatic queue replay
- automatic hydration
- update hydration apply
- conflict resolution
- broad hydration merge behavior

Hydration apply remains extremely limited to explicit manual `createLocalFromRemote` actions. Update hydration and conflict resolution are still not implemented.

## Safety Statement

This is a documentation-only checkpoint. No frontend code, backend code, test code, sync engine behavior, replay behavior, hydration behavior, or auth behavior is changed by this document.
