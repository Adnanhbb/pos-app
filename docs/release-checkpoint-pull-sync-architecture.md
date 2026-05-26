# Release Checkpoint: Pull Sync Architecture

Suggested git tag: `pull-sync-architecture-before-implementation`

## Milestone Summary

This checkpoint records that the pull-sync, hydration, and conflict-resolution architecture has been designed before any implementation begins.

The design is captured in [pull-sync-hydration-conflict-architecture.md](./pull-sync-hydration-conflict-architecture.md). It explains why push/replay-only sync is not enough for multi-device correctness and why remote-to-local hydration must be solved before any auto-sync rollout.

## Architecture Status

Designed, not implemented:

- pull-sync architecture
- remote authoritative hydration strategy
- local/server versioning approach
- soft-delete propagation strategy
- conflict categories and policies
- entity-level vs transaction-level hydration boundaries
- bootstrap/new-device sync sequence
- pagination/windowing strategy
- operational retry/crash/auth-expiry considerations

## Key Decisions

- replay-only sync is insufficient for multi-device correctness
- backend-authoritative transaction replay remains the source of truth for stock, accounting, payments, batches, cylinders, and finalized transaction records
- hydration is required so other devices learn authoritative backend state
- conflicts must be detected explicitly rather than silently overwritten
- CRUD hydration must remain separate from transaction-derived hydration
- local offline writes and pending queue rows must be preserved

## Planned Phases

1. Read-only hydration diagnostics
2. Safe entity hydration
3. Soft-delete propagation
4. Conflict detection
5. Controlled background sync eligibility

## Still Not Implemented

- pull-sync endpoints
- frontend hydration services
- hydration apply logic
- conflict resolution UI
- automatic/background sync
- startup replay
- polling
- online/offline replay listeners
- background workers

## Safety Boundary

Auto-sync remains unsafe until hydration and conflict handling exist. Transaction replay can make the backend authoritative, but it does not by itself make every device converge.

This checkpoint is documentation-only and should be tagged before pull-sync implementation begins.