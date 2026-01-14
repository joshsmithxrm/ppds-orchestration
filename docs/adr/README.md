# Architecture Decision Records

This directory contains Architecture Decision Records (ADRs) for ppds-orchestration.

ADRs document significant architectural decisions, their context, and rationale. They help future contributors understand why things are the way they are.

## Index

| ADR | Title | Status |
|-----|-------|--------|
| [001](001-worker-information-boundary.md) | Worker Information Boundary (Ralph Principle) | Accepted |
| [002](002-session-identity-model.md) | Session Identity and Multi-Issue Model | Accepted |
| [003](003-session-lifecycle-states.md) | Session Lifecycle States | Accepted |

## Core Principles

These ADRs establish the core architectural principles of the orchestration system:

1. **Workers have context, not history** (ADR-001)
   - Workers don't know they're in a loop
   - Orchestrator tracks all history
   - Enables clean restarts and fresh perspectives

2. **Simple session identity** (ADR-002)
   - Primary issue number = session ID
   - Human-readable, CLI-friendly
   - Robust conflict detection

3. **Stuck means stopped** (ADR-003)
   - Workers exit when stuck, don't poll
   - Fresh restart with forwarded guidance
   - Clean separation of concerns

## Adding New ADRs

When making significant architectural decisions:

1. Create a new file: `NNN-short-title.md`
2. Use the template structure from existing ADRs
3. Update this README's index
4. Include in the relevant PR

## Template

```markdown
# ADR-NNN: Title

**Status:** Proposed | Accepted | Deprecated | Superseded
**Date:** YYYY-MM-DD
**Context:** Brief context

## Context

What is the issue we're seeing that motivates this decision?

## Decision

What is the change we're proposing and/or doing?

## Rationale

Why is this the best choice among alternatives?

## Alternatives Considered

What other options did we consider?

## Consequences

### Positive
### Negative
### Mitigations

## Related Decisions
```
