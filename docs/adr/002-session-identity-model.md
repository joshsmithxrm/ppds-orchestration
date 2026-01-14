# ADR-002: Session Identity and Multi-Issue Model

**Status:** Accepted
**Date:** 2025-01-13
**Context:** Session identification when handling single or multiple issues

## Context

Sessions need unique identifiers for:
- File storage (`work-{id}.json`)
- CLI commands (`orch update --id {id}`)
- Dashboard display
- Conflict detection (prevent duplicate sessions for same issue)

With the addition of multi-issue sessions (`orch spawn 1 2 3`), we need to decide how to identify sessions that span multiple issues.

## Decision

**Session ID = Primary Issue Number (first issue in the array)**

For a session working on issues 1, 2, 3:
- Session ID: `"1"`
- Session file: `work-1.json`
- Branch: `issues-1-2-3`
- Worktree: `{prefix}issues-1-2-3`

For a single-issue session (issue 42):
- Session ID: `"42"`
- Session file: `work-42.json`
- Branch: `issue-42`
- Worktree: `{prefix}issue-42`

## Alternatives Considered

### Option A: Compound Key (`"1-2-3"`)

```typescript
sessionId = issueNumbers.sort().join('-');
```

**Pros:**
- Unique for any combination of issues
- Order-independent (sorted)

**Cons:**
- Breaks existing single-issue sessions
- Harder to type in CLI (`orch update --id 1-2-3`)
- File names get long (`work-1-2-3-4-5.json`)

### Option B: UUID

```typescript
sessionId = randomUUID();
```

**Pros:**
- Guaranteed unique
- Decoupled from issue numbers

**Cons:**
- Not human-readable (`orch update --id a1b2c3d4-...`)
- Can't derive session from issue number
- Loses the intuitive "session for issue #42" mental model

### Option C: Primary Issue Number (Chosen)

```typescript
sessionId = issues[0].number.toString();
```

**Pros:**
- Simple and readable
- Backward compatible with single-issue sessions
- Easy CLI usage (`orch update --id 42`)
- Can still find all issues via session state

**Cons:**
- Two multi-issue sessions with same primary issue conflict
- Order matters (issues 1,2,3 vs 3,2,1 have different IDs)

## Rationale

We chose **primary issue number** because:

1. **Simplicity**: Most sessions are single-issue. Keep the common case simple.

2. **CLI ergonomics**: `orch update --id 42` is much easier than `--id 1-2-3` or `--id uuid`.

3. **Mental model**: "Session 42 is working on issue #42" is intuitive. Even for multi-issue, "Session 1 is working on issues #1, #2, #3" makes sense.

4. **Conflict detection**: Before spawning, we check if ANY issue in the set has an active session. This prevents the "same primary issue" conflict.

5. **Future flexibility**: The `workflowId` field (ADR-003) will handle complex multi-session scenarios.

## Data Model

```typescript
interface SessionState {
  id: string;              // Primary issue number as string
  issues: IssueRef[];      // All issues (min 1)
  // ... other fields
}

interface IssueRef {
  number: number;
  title: string;
  body?: string;
}
```

### Naming Conventions

| Issues | Session ID | Branch | Worktree |
|--------|-----------|--------|----------|
| [42] | "42" | `issue-42` | `{prefix}issue-42` |
| [1, 2, 3] | "1" | `issues-1-2-3` | `{prefix}issues-1-2-3` |

## Conflict Detection

Before spawning for issues `[1, 2, 3]`:

```typescript
for (const issue of issueNumbers) {
  if (activeSessionExists(issue.toString())) {
    throw Error(`Issue #${issue} already has an active session`);
  }
}
```

This prevents:
- Spawning issue #2 standalone when it's part of a combined session
- Spawning combined session when any issue is already active

## Consequences

### Positive

- Clean, readable session IDs
- Easy CLI usage
- Intuitive mental model
- Robust conflict detection

### Negative

- Must specify issues in consistent order for deterministic ID
- Primary issue has special significance (naming)

### Mitigations

- Document that first issue is "primary" for naming purposes
- UI can show all issues regardless of which is primary

## Related Decisions

- ADR-001: Worker Information Boundary
- ADR-003: Session Lifecycle States
