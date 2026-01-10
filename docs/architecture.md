# Architecture

Conceptual architecture for Claude-to-Claude orchestration.

## Overview

The system has three layers:

```
┌─────────────────────────────────────────────────────────────┐
│                      Human Layer                            │
│  - Strategic decisions                                      │
│  - Design approval                                          │
│  - PR review                                                │
└─────────────────────────────────┬───────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────┐
│                   Orchestrator Layer                        │
│  - Spawns workers                                           │
│  - Monitors status                                          │
│  - Relays escalations                                       │
│  - Reports PR readiness                                     │
└─────────────────────────────────┬───────────────────────────┘
                                  │
┌─────────────────────────────────▼───────────────────────────┐
│                     Worker Layer                            │
│  - Implements issues autonomously                           │
│  - Updates status                                           │
│  - Creates PRs                                              │
│  - Escalates when stuck                                     │
└─────────────────────────────────────────────────────────────┘
```

## Components

### Orchestrator Session

A Claude Code session where you discuss work with Claude. The orchestrator:

1. **Helps you plan** - Lists issues, discusses priorities, identifies parallelizable work
2. **Spawns workers** - Creates worktrees, starts Claude sessions with context
3. **Monitors status** - Reads status files, reports progress
4. **Relays escalations** - When workers get stuck, presents the decision to you
5. **Reports completion** - Notifies you when PRs are ready for review

The orchestrator is **stateless** - it reads status files on demand. If you restart the orchestrator session, it picks up where it left off by reading the files.

### Worker Sessions

Each worker is an autonomous Claude Code session that:

1. Receives context (issue number, title, body)
2. Explores the codebase
3. Creates a plan
4. Implements the solution
5. Runs tests
6. Creates a PR
7. Handles CI and bot feedback

Workers run in **isolated git worktrees** so they don't conflict with each other or the main branch.

### Status Files

Simple JSON files that track worker state:

```json
{
  "id": "123",
  "issueNumber": 123,
  "issueTitle": "Add export button",
  "status": "working",
  "branch": "issue-123",
  "worktreePath": "/path/to/project-issue-123",
  "startedAt": "2025-01-08T10:30:00Z",
  "lastHeartbeat": "2025-01-08T11:15:00Z",
  "stuckReason": null,
  "pullRequestUrl": null
}
```

Status files enable:
- **Restart resilience** - State survives process restarts
- **Debuggability** - You can inspect files directly
- **Simplicity** - No database, no IPC, just files

### Git Worktrees

Each worker gets its own worktree:

```
/project              # Main repo (orchestrator works here)
/project-issue-123    # Worker for issue 123
/project-issue-124    # Worker for issue 124
/project-issue-125    # Worker for issue 125
```

Worktrees enable:
- **Isolation** - Workers don't step on each other
- **Parallel branches** - Each worker has its own branch
- **Easy cleanup** - Remove worktree when done

## Status Lifecycle

```
Registered → Planning → Working → Complete
                ↓          ↓
              Stuck      Stuck
```

| Status | Meaning |
|--------|---------|
| `registered` | Worktree created, worker starting |
| `planning` | Worker exploring codebase, creating plan |
| `working` | Actively implementing |
| `stuck` | Needs human guidance |
| `complete` | PR created, ready for review |
| `cancelled` | Session cancelled |

## Coordination Flow

```
1. Human: "Let's work on issues 123, 124, 125"

2. Orchestrator: Creates worktrees, spawns workers
   - /project-issue-123 (worker starts)
   - /project-issue-124 (worker starts)
   - /project-issue-125 (worker starts)

3. Workers: Work autonomously, update status files

4. Orchestrator: (when asked) Reads status files, reports:
   "123 is working, 124 is stuck on auth decision, 125 has PR ready"

5. Human: "For 124, use token refresh with sliding expiration"

6. Orchestrator: Forwards guidance to 124's status file

7. Worker 124: Reads guidance, continues

8. Eventually: All workers complete, PRs ready for review
```

## Key Design Decisions

### Why File-Based Coordination?

- **Simple** - No services to run, no ports to manage
- **Debuggable** - `cat` a file to see state
- **Resilient** - Survives restarts, no state loss
- **Universal** - Works on any platform

### Why Stateless Orchestrator?

- **Restartable** - Close and reopen, state is in files
- **Recoverable** - Workers continue even if orchestrator crashes
- **Flexible** - Switch between orchestrator sessions freely

### Why Git Worktrees?

- **Isolation** - Each worker has independent working directory
- **Efficiency** - Share git objects, don't clone N times
- **Clean** - `git worktree remove` cleans up everything

## Implementation Notes

This architecture is **tool-agnostic**. You can implement it with:

- A CLI tool that manages sessions
- Shell scripts that spawn terminals
- A VS Code extension
- Any combination

The pattern is the same. The implementation adapts to your environment.
