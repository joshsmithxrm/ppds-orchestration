# Claude Orchestration

A pattern for coordinating multiple Claude Code sessions working in parallel on a shared codebase.

## The Problem

You have a backlog of work. You want to:
1. **Design** - Make decisions about what to build
2. **Delegate** - Spawn autonomous workers on issues
3. **Review** - Get notified when PRs are ready, review them

You don't want to babysit workers. You want fire-and-forget until PR.

## The Pattern

```
                    ┌─────────────────────────────────────────┐
                    │           Orchestrator Session          │
                    │  (Human + Claude discussing strategy)   │
                    └─────────────────┬───────────────────────┘
                                      │
              ┌───────────────────────┼───────────────────────┐
              │                       │                       │
              ▼                       ▼                       ▼
     ┌────────────────┐     ┌────────────────┐     ┌────────────────┐
     │  Worker #123   │     │  Worker #124   │     │  Worker #125   │
     │  (Autonomous)  │     │  (Autonomous)  │     │  (Autonomous)  │
     │                │     │                │     │                │
     │ Issue → PR     │     │ Issue → PR     │     │ Issue → PR     │
     └────────────────┘     └────────────────┘     └────────────────┘
```

**Orchestrator**: Where you and Claude discuss priorities, review plans, and receive PR notifications.

**Workers**: Autonomous Claude sessions, each in its own git worktree, implementing a single issue and creating a PR.

## Key Principles

### 1. Workers Are Autonomous

Once spawned, workers should complete their task without intervention. They:
- Read the issue
- Explore the codebase
- Implement the solution
- Run tests
- Create a PR
- Handle CI failures and bot comments

If they can't proceed, they escalate (see [Human Gates](docs/human-gates.md)).

### 2. Coordination via Files

Workers don't talk to each other directly. They coordinate through:
- **Status files** in a shared location (e.g., `~/.orchestration/sessions/`)
- **Git** (branches, worktrees)
- **GitHub** (issues, PRs)

This is simple, debuggable, and survives restarts.

### 3. Human Reviews PRs, Not Process

You shouldn't monitor workers. You should:
- Get notified when PRs are ready
- Review the PR (code, not process)
- Merge or request changes

The orchestrator handles process. You handle judgment.

### 4. Escalation Over Guessing

When workers hit decisions they shouldn't make alone (security, architecture, unclear requirements), they stop and escalate rather than guess wrong.

## Getting Started

1. Read [Architecture](docs/architecture.md) for the conceptual model
2. Read [Parallel Orchestration](docs/parallel-orchestration.md) for how to coordinate workers
3. Read [Autonomous Worker](docs/autonomous-worker.md) for worker lifecycle
4. Read [Human Gates](docs/human-gates.md) for escalation patterns
5. See [Worker Prompt Template](templates/worker-prompt.md) for an example prompt

## Implementation

This repo contains the **conceptual pattern**. Implementation varies by:
- Language/toolchain (CLI tool, scripts, etc.)
- Platform (Windows Terminal, tmux, etc.)
- Project structure

The pattern is the same regardless of implementation.

## Philosophy

**Optimize for your flow state, not the system's elegance.**

The goal is: you design, workers implement, you review PRs. Anything that pulls you out of design mode is friction. Build only what you need to stay in flow.
