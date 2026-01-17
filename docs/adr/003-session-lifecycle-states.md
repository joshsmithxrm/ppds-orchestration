# ADR-003: Session Lifecycle States

**Status:** Accepted
**Date:** 2025-01-13
**Context:** Managing worker session states and transitions

## Context

Workers go through various states during their lifecycle. We need to define:
1. What states exist
2. How transitions happen
3. What happens when a worker gets stuck
4. How to restart a stuck session

## Decision

### State Machine

```
registered ──► planning ──► planning_complete ──► working ──► shipping
     │             │               │                 │            │
     │             │               │                 │            ▼
     │             │               │                 │     reviews_in_progress
     │             │               │                 │            │
     │             │               │                 │            ▼
     │             │               │                 │        pr_ready
     │             │               │                 │            │
     │             │               │                 │            ▼
     │             ▼               ▼                 ▼         complete
     └─────────────────────► stuck ◄───────────────────────────────┘
                               │
                               ▼
                            [exit]
                               │
                     [restart with fresh worker]
                               │
                               ▼
                            working
```

### Terminal States

- **complete**: Work finished successfully, PR ready for human review
- **cancelled**: Human cancelled the session, cleanup performed

### Special State: stuck

When a worker hits a domain gate or fails repeatedly:
1. Worker sets `status: stuck` with `stuckReason`
2. **Worker exits** (does not poll or wait)
3. Session remains in stuck state
4. Human reviews reason
5. Human runs `orch restart` to spawn fresh worker
6. New worker continues work from preserved worktree state

## Key Decision: Stuck Workers Exit

### Why Workers Exit on Stuck

**Option A: Worker polls for guidance (Rejected)**
```
stuck ──► [poll every 30s] ──► [check for updates] ──► continue
```

Problems:
- Worker consumes resources while waiting
- Complex polling logic in prompt
- Worker timeout issues
- Harder to reason about state

**Option B: Worker exits, fresh restart (Chosen)**
```
stuck ──► [exit] ──► [human: orch restart] ──► [new worker]
```

Benefits:
- Clean separation: stuck = stopped
- No resource waste
- Aligns with Ralph principle (new worker, fresh context)
- Simple mental model
- Each "iteration" is independent

### Restart Flow

```bash
# 1. Worker gets stuck
orch list
# [!] #42 - STUCK - Auth decision needed: JWT or session tokens?

# 2. Human restarts (optionally after updating issue/context)
orch restart 42
# ✓ Session restarted
```

The new worker:
- Spawns in existing worktree (code preserved)
- Has fresh context from session-prompt.md
- Continues work from current state

## State Persistence

### Visible States

All states remain visible in `orch list` including `complete` and `cancelled`:

```
Active Sessions (2):
[*] #42 - WORKING (15m) - Add authentication
[!] #18 - STUCK (2h) - Refactor database layer

Completed Sessions (1):
[✓] #15 - COMPLETE (1d) - Fix login bug
```

### Action Restrictions

| Action | complete | cancelled | stuck | working |
|--------|----------|-----------|-------|---------|
| pause | ❌ | ❌ | ✓ | ✓ |
| cancel | ❌ | ❌ | ✓ | ✓ |
| restart | ❌ | ❌ | ✓ | ❌ |
| delete | ✓ | ✓ | ✓ | ✓ |

Rationale:
- Can't pause/cancel what's already done
- Can only restart stuck sessions (others are still running or done)
- Delete always allowed (removes from list, optionally keeps worktree)

## Status Reporting

Workers update status by writing to the session file directly:

```typescript
// Worker reads session-context.json to get sessionFilePath
// Worker updates session file:
{
  "status": "working",
  "lastHeartbeat": "2025-01-13T12:00:00Z"
}
```

This approach:
- Watcher detects changes via file system events
- Dashboard gets real-time updates via WebSocket
- No HTTP/API needed from worker

## Consequences

### Positive

- Simple mental model: stuck = stopped
- Clean restarts with fresh context
- No resource waste on stuck workers
- Easy to reason about state transitions
- Visible history of all sessions

### Negative

- Requires human intervention to restart stuck sessions
- Can't auto-retry (by design - domain gates need human decision)

### Future Considerations

- Workflow system (#19) may auto-restart stages in certain conditions
- Could add configurable auto-restart for non-domain-gate failures
- Metrics on stuck frequency could inform automation decisions

## Related Decisions

- ADR-001: Worker Information Boundary
- ADR-002: Session Identity Model
