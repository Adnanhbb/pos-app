# Release Checkpoint: Replay Auth Foundation

Suggested git tag: `replay-auth-foundation-before-crud-auth`

## Milestone Summary

This checkpoint records the backend replay auth/session foundation after it was implemented and verified, before CRUD endpoint auth enforcement and before any auto-sync rollout.

The foundation is intentionally narrow. It prepares replay authorization, token validation, worker identity, and replay audit attribution without changing current frontend sync behavior or replay semantics.

## Implemented Foundation

A shared backend auth helper exists in `api/lib/auth.php`.

Supported token sources:

- `REPLAY_WORKER_TOKEN`
- hashed rows in `api_auth_tokens`

Token behavior:

- bearer tokens are accepted through `Authorization: Bearer <token>`
- raw tokens are not stored in MySQL
- DB tokens are compared by SHA-256 hash
- inactive, expired, revoked, missing, or invalid tokens are rejected
- accepted DB tokens update `last_used_at`

## Authorized Replay Wrapper

Authorized replay is available through:

```php
replayStoredTransactionAuthorized($pdo, $syncTransactionId, $authContext)
```

Behavior:

- unauthorized replay is rejected before lock acquisition
- unauthorized replay does not increment `replay_attempts`
- authorized replay derives a safe replay worker identity from the auth context
- existing replay semantics remain in `replayStoredTransaction(...)`
- the wrapper is additive and does not change existing dev/test replay helpers

## Replay Audit Attribution

Replay audit attribution is supported with optional `transaction_replay_audit` columns:

- `actor_type`
- `actor_id`
- `actor_role`
- `session_id`

Audit attribution is safe metadata only. Raw tokens, passwords, payload bodies, customer/supplier bodies, item bodies, and auth/session secrets must not be logged.

## Explicitly Not Enforced Yet

The following are intentionally not implemented at this checkpoint:

- CRUD endpoint auth enforcement
- production login/session endpoint
- frontend auth/session token flow
- automatic sync
- startup replay
- online/offline replay listeners
- polling or intervals
- background replay
- frontend `syncEngine` behavior changes

## Verified Results

Latest verified results at this checkpoint:

- `test:transactions:auth-foundation` => `12 passed, 0 failed`
- `test:transactions:cylinder-mutation` => `46 passed, 0 failed`
- `test:transactions:locks` => `8 passed, 0 failed`
- `test:transactions:storage` => `22 passed, 0 failed`
- `test:sync:real-low-risk` => `39 passed, 0 failed`
- `test:sync:low-risk` => `79 passed, 0 failed`

## Rollback Value

This checkpoint is useful because it separates replay auth/session foundation from the next riskier phases:

- enforcing auth on CRUD endpoints
- adding production login/session handling
- wiring authenticated replay endpoints
- planning controlled auto-sync

If future auth enforcement breaks frontend workflows, this checkpoint identifies the last known state where replay auth primitives existed but CRUD endpoints remained unenforced and sync stayed manual.

## Safety Warning

Do not enable auto-sync from this state. Auth foundations are present, but CRUD auth enforcement, production session handling, pull/hydration, conflict handling, and controlled rollout rules are still separate future phases.
