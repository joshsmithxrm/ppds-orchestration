# ADR-001: Worker Information Boundary (Ralph Principle)

**Status:** Accepted
**Date:** 2025-01-13
**Context:** Session orchestration and worker lifecycle management

## Context

When orchestrating parallel Claude Code workers, we need to decide how much information each worker has about its context, history, and the orchestration system itself.

In "Ralph mode" (iterative loop), a worker may be spawned multiple times for the same session - first to plan, then to implement, then to fix issues from reviews. The question is: should the worker know it's in a loop?

## Decision

**Workers have context, not history.**

| Worker Sees (Context) | Worker Does NOT See (History) |
|----------------------|------------------------------|
| Issues assigned | How many times spawned |
| Current worktree state | Who wrote existing code |
| Forwarded guidance | Previous stuck reasons |
| Session file (write status) | Previous statuses |
| Branch name, PR URL | That a PR was "already" created |

The worker operates in "eternal present tense" - it sees the current state of the world and acts on it, without knowledge of previous iterations.

## Rationale

### Why Workers Shouldn't Know They're in a Loop

1. **Prevents cognitive loops**: A worker that knows "I tried this before and failed" might overthink or avoid approaches that could work this time with fresh eyes.

2. **Simplifies prompts**: We don't need complex state management in prompts ("if this is iteration 3, do X"). The worker just does its job.

3. **Natural behavior**: When a worker sees existing code in the worktree, it naturally builds on it. It doesn't need to know it wrote that code in a previous life.

4. **Cleaner restart semantics**: A "restart" is just a fresh spawn. The new worker sees the worktree state and any forwarded guidance, but has no baggage from the previous stuck state.

### Why Guidance is Allowed

Forwarded messages (`forwardedMessage` in session state) are the one piece of "history" workers see. This is intentional:

- The message is **directive**, not historical ("Use JWT tokens" vs "You asked about auth and I said use JWT")
- It appears as guidance from the orchestrator, not as memory of a previous iteration
- The worker doesn't know why the guidance exists, just that it should incorporate it

## Implementation

### Session Prompt Must NEVER Include

- "You may have worked on this before"
- "Previous iteration failed because..."
- "This is attempt N of..."
- "Check your previous work"
- History of status changes

### Session Prompt SHOULD Include

- Current issues and their descriptions
- Repository context (owner, repo, branch)
- Status reporting mechanism
- Forwarded guidance (if any) - phrased as current direction

### Orchestrator Responsibilities

The orchestrator (CLI, dashboard, watcher) tracks all history:
- Spawn count per session
- Status transitions with timestamps
- Previous stuck reasons
- All forwarded messages

This information is for operators, not workers.

## Consequences

### Positive

- Simpler worker behavior - no conditional logic based on iteration
- Cleaner prompt templates
- Workers naturally build on existing work
- Easier debugging - each iteration is independent

### Negative

- Can't give workers "learning" about what didn't work
- If same approach keeps failing, worker won't know to try something different
- Requires human intervention (via guidance) to redirect failing patterns

### Mitigations

- Forwarded messages let operators provide direction
- Session history visible in dashboard helps operators spot patterns
- Domain gates (stuck status) force human checkpoints

## Related Decisions

- ADR-002: Session Identity Model
- ADR-003: Session Lifecycle States
