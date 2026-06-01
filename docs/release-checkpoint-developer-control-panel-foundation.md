# Release Checkpoint: Developer Control Panel Read-Only Foundation

Suggested git tag: `developer-control-panel-readonly-foundation`

This checkpoint records the implemented read-only Developer Control Panel foundation before any dangerous actions, mutation tools, runtime endpoints, or background behavior are added.

## Milestone Summary

`src/DeveloperControlPanel.tsx` now exists as the initial protected developer-support-only operational visibility surface.

The panel is read-only and focused on safe diagnostics. It does not trigger replay, hydrate data, repair data, mutate database rows, restore/import backups, or start any automatic/background sync behavior.

## Access Protection

Current access approach:

- Dashboard entry is visible only to exact role `Dev`.
- The component self-guards unauthorized roles if rendered directly.
- The panel is hidden from `saleboy` and normal staff navigation.
- Current protection is UI-level foundation and should be backed by role-enforced backend endpoints before future sensitive server-side diagnostics are exposed.

## Implemented Sections

The initial panel includes these read-only sections:

- System Health
- Sync Status
- Replay Status
- Auth Status
- Backup Status
- Auto-sync Eligibility
- POS Activity Status

## Read-Only Behavior

Current behavior:

- manual refresh only
- no polling
- no listeners
- no workers
- no startup replay
- no automatic replay
- no auto-sync
- no hydration apply
- no restore/import
- no repair tools
- no cleanup tools
- no direct DB editing
- no stock/accounting mutation tools

## Sensitive Data Boundaries

The panel does not display:

- `payload_json`
- `response_json`
- raw bearer tokens
- token hashes
- passwords
- password hashes
- session secrets
- cart contents
- customer/payment detail bodies
- item rows or invoice bodies in diagnostic cards

## CLI-Only Boundaries

Backend replay/audit/lock detail remains CLI-only in this foundation:

- backend failed replay counts
- replay audit details
- replay lock details
- backend replay transaction detail
- live backup file discovery and validation beyond documented checkpoint metadata

The panel labels these areas as CLI-only instead of adding new backend runtime endpoints.

## Verification

Verified command:

```powershell
npx.cmd tsc -b
```

Result: passed.

## Next Phase Guardrails

Before adding any dangerous action to the panel:

1. keep read-only reports separate from mutation tools
2. require dry-run planning before apply
3. require explicit confirmation for apply
4. add backend role enforcement for server-side diagnostics/actions
5. add audit/checkpoint records for mutating actions
6. continue hiding advanced internals from normal staff

No dangerous action should appear in the panel without the established report -> dry-run plan -> explicit apply -> audit/checkpoint flow.