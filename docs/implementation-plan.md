# Orchestration Extraction Plan

## Summary

Extract orchestration from PPDS into a standalone, reusable TypeScript tool with a Tauri + React dashboard. The key pain point is **workers don't report status programmatically** - the only visibility today is that terminal tabs exist.

---

## Architecture Overview

```
ppds-orchestration/
├── packages/
│   ├── core/                    # TypeScript library (session management)
│   │   ├── src/
│   │   │   ├── session/         # Port from PPDS SessionService.cs
│   │   │   ├── spawner/         # Port from PPDS WindowsTerminalWorkerSpawner.cs
│   │   │   ├── github/          # GitHub API integration
│   │   │   └── watcher/         # File watcher for real-time updates
│   │   └── package.json
│   │
│   ├── cli/                     # CLI tool: `orch spawn 123`
│   │   └── package.json
│   │
│   └── dashboard/               # Tauri + React app
│       ├── src-tauri/           # Rust backend
│       └── src/                 # React frontend
│
├── templates/
│   └── worker-prompt.md         # Generic worker prompt template
│
└── orchestration.config.json    # Per-project configuration
```

---

## Phase 1: Core Library (TypeScript port of PPDS)

### 1.1 Session State & Types

Port from `PPDS.Cli/Services/Session/SessionState.cs`:

```typescript
// packages/core/src/session/types.ts
interface SessionState {
  id: string;
  issueNumber: number;
  issueTitle: string;
  status: SessionStatus;
  branch: string;
  worktreePath: string;
  startedAt: string;           // ISO timestamp
  lastHeartbeat: string;       // ISO timestamp
  stuckReason?: string;
  forwardedMessage?: string;
  pullRequestUrl?: string;
  worktreeStatus?: WorktreeStatus;
}

type SessionStatus =
  | 'registered' | 'planning' | 'planning_complete'
  | 'working' | 'shipping' | 'reviews_in_progress'
  | 'pr_ready' | 'stuck' | 'paused' | 'complete' | 'cancelled';
```

### 1.2 Session Service

Port from `PPDS.Cli/Services/Session/SessionService.cs` (~1000 lines):

| PPDS Method | TypeScript Port |
|-------------|-----------------|
| `SpawnAsync` | `spawn(issueNumber)` |
| `ListAsync` | `list()` |
| `GetAsync` | `get(sessionId)` |
| `UpdateAsync` | `update(sessionId, status, reason?, prUrl?)` |
| `PauseAsync` | `pause(sessionId)` |
| `ResumeAsync` | `resume(sessionId)` |
| `CancelAsync` | `cancel(sessionId)` |
| `ForwardAsync` | `forward(sessionId, message)` |
| `HeartbeatAsync` | `heartbeat(sessionId)` |
| `GetWorktreeStatusAsync` | `getWorktreeStatus(sessionId)` |

**Key files to create:**
- `packages/core/src/session/session-service.ts`
- `packages/core/src/session/session-store.ts` (JSON file persistence)
- `packages/core/src/session/session-state.ts` (types)

### 1.3 Worker Spawner

Port from `PPDS.Cli/Services/Session/WindowsTerminalWorkerSpawner.cs`:

```typescript
// packages/core/src/spawner/worker-spawner.ts
interface WorkerSpawnRequest {
  sessionId: string;
  issueNumber: number;
  issueTitle: string;
  workingDirectory: string;
  promptFilePath: string;
  githubOwner: string;
  githubRepo: string;
}

interface WorkerSpawner {
  isAvailable(): boolean;
  spawn(request: WorkerSpawnRequest): Promise<void>;
}

// Windows Terminal implementation
class WindowsTerminalSpawner implements WorkerSpawner { ... }
```

### 1.4 File Watcher (NEW - solves status reporting)

The key insight: **workers write to JSON files, dashboard watches them**.

```typescript
// packages/core/src/watcher/session-watcher.ts
interface SessionWatcher {
  watch(sessionsDir: string): void;
  on(event: 'update', callback: (session: SessionState) => void): void;
  on(event: 'add', callback: (session: SessionState) => void): void;
  on(event: 'remove', callback: (sessionId: string) => void): void;
}
```

Uses `chokidar` to watch `~/.orchestration/{project}/sessions/*.json`.

---

## Phase 2: CLI Tool

Simple CLI that wraps the core library:

```bash
orch spawn 123              # Spawn worker for issue #123
orch list                   # List all sessions
orch get 123                # Get session details
orch update --id 123 --status working
orch forward 123 "guidance"
orch cancel 123
orch dashboard              # Launch dashboard
```

**Key files:**
- `packages/cli/src/index.ts`
- `packages/cli/src/commands/*.ts`

---

## Phase 3: Dashboard (Tauri + React)

### 3.1 Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Orchestration Dashboard                                     [project name] │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌─ BACKLOG ─────────────────┐  ┌─ ACTIVE WORKERS ──────────────────────┐  │
│  │                           │  │                                        │  │
│  │  Ready (5)                │  │  #123 Add export       [WORKING] 80%   │  │
│  │  ├ #456 Auth flow   [→]   │  │  45m | 3 files (+42, -5)               │  │
│  │  ├ #457 Update UI   [→]   │  ├──────────────────────────────────────┤  │
│  │  └ #458 Fix tests   [→]   │  │  #124 Plugin deploy   [PLANNING] 20%   │  │
│  │                           │  │  12m | Exploring codebase              │  │
│  │  Blocked (2)              │  ├──────────────────────────────────────┤  │
│  │  └ #500 Needs design      │  │  #125 TUI refresh     [STUCK]          │  │
│  │                           │  │  Reason: Auth decision needed          │  │
│  │  [+ Create Issue]         │  │  [Send Guidance: _______________] [→]  │  │
│  └───────────────────────────┘  └────────────────────────────────────────┘  │
│                                                                              │
│  ┌─ READY FOR REVIEW ───────────────────────────────────────────────────────┤
│  │  PR #45 → Issue #120  ✅ CI Passed  [Open PR] [Approve] [Request Δ]     │
│  │  PR #46 → Issue #121  ✅ CI Passed  [Open PR] [Approve] [Request Δ]     │
│  └──────────────────────────────────────────────────────────────────────────┘
└──────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Key Components

| Component | Purpose |
|-----------|---------|
| `BacklogPanel` | GitHub issues organized by state, spawn button |
| `WorkerCard` | Individual worker status, progress, actions |
| `WorkerList` | Grid of active workers |
| `ReviewQueue` | PRs awaiting human review |
| `StuckWorkerAlert` | Prominent display + guidance input |
| `IssueDetailModal` | View issue, link to GitHub, spawn worker |

### 3.3 Real-Time Updates

```typescript
// Dashboard subscribes to file changes
const watcher = new SessionWatcher();
watcher.watch('~/.orchestration/ppds/sessions');
watcher.on('update', (session) => {
  dispatch({ type: 'SESSION_UPDATED', payload: session });
});
```

---

## Phase 4: Solve Worker Status Reporting

### 4.1 The Problem

Workers are Claude Code sessions that should call `ppds session update` but often don't. The only visibility is terminal tabs existing.

### 4.2 Solution: Multi-Source Activity Detection

1. **Explicit updates** - Worker calls `orch update --id 123 --status working`
2. **Git activity inference** - Watch worktree for commits, file changes
3. **Heartbeat fallback** - Infer "active" if worktree modified recently

```typescript
async function inferWorkerActivity(session: SessionState): Promise<'active' | 'stale' | 'unknown'> {
  // Check git log for recent commits
  const lastCommit = await git.log(session.worktreePath, { n: 1 });
  const commitAge = Date.now() - new Date(lastCommit.date).getTime();

  // Check file modification times
  const planFile = path.join(session.worktreePath, '.claude', 'worker-plan.md');
  const planAge = Date.now() - fs.statSync(planFile).mtimeMs;

  const mostRecentActivityMs = Math.min(commitAge, planAge);

  if (mostRecentActivityMs < 60_000) return 'active';
  if (mostRecentActivityMs < 300_000) return 'unknown';
  return 'stale';
}
```

### 4.3 Enhanced Worker Prompts

Add explicit status checkpoints to the worker prompt template:

```markdown
## Status Reporting (REQUIRED)

Report status at EACH phase:

| Phase | Command |
|-------|---------|
| Starting | `orch update --id {ID} --status planning` |
| Plan ready | `orch update --id {ID} --status planning_complete` |
| Implementing | `orch update --id {ID} --status working` |
| Stuck | `orch update --id {ID} --status stuck --reason "description"` |
| PR created | (automatic via /ship) |

**CRITICAL:** If you don't report status, the orchestrator may consider you stale.
```

---

## Phase 5: Worker Context Files

### 5.1 File Structure in Worktree

Each worker worktree has these files:

```
{worktree}/
├── session-context.json     # STATIC - written once at spawn, never changes
├── session-state.json       # DYNAMIC - updated by orchestrator for messages
└── .claude/
    └── session-prompt.md    # Human-readable workflow instructions
```

### 5.2 session-context.json (Static Identity)

Written once at spawn time. Skills and workers read this for identity.

```json
{
  "sessionId": "123",
  "issueNumber": 123,
  "issueTitle": "Add export button",
  "github": {
    "owner": "joshsmithxrm",
    "repo": "power-platform-developer-suite"
  },
  "branch": "issue-123",
  "worktreePath": "C:/VS/ppds-issue-123",
  "commands": {
    "update": "orch update --id 123",
    "heartbeat": "orch heartbeat --id 123"
  },
  "spawnedAt": "2026-01-10T14:30:00Z"
}
```

**Who writes it:** Orchestrator at spawn time
**Who reads it:** Workers (for status updates), Skills (for GitHub context)
**When it changes:** Never (static)

### 5.3 session-state.json (Dynamic State)

Updated by orchestrator to communicate with workers.

```json
{
  "status": "working",
  "forwardedMessage": "Use JWT with 15-minute refresh window",
  "lastUpdated": "2026-01-10T15:45:00Z"
}
```

**Who writes it:** Orchestrator (via `orch forward`)
**Who reads it:** Workers (to check for guidance)
**When it changes:** When orchestrator forwards messages

### 5.4 How Skills Use Context

Skills read `session-context.json` for GitHub operations:

```typescript
// In /ship skill:
const ctx = JSON.parse(fs.readFileSync('session-context.json', 'utf8'));

await gh.pr.create({
  owner: ctx.github.owner,
  repo: ctx.github.repo,
  head: ctx.branch,
  base: 'main',
  title: `#${ctx.issueNumber}: ${ctx.issueTitle}`
});

// Update status after PR creation
await exec(ctx.commands.update + ' --status pr_ready --pr "' + prUrl + '"');
```

### 5.5 How Workers Check for Messages

Workers periodically check `session-state.json`:

```typescript
// In worker prompt or as a skill:
const state = JSON.parse(fs.readFileSync('session-state.json', 'utf8'));
if (state.forwardedMessage) {
  console.log(`Guidance received: ${state.forwardedMessage}`);
  // Incorporate guidance and continue
}
```

### 5.6 Why Two Files?

| File | Purpose | Changes |
|------|---------|---------|
| `session-context.json` | Identity (who am I?) | Never |
| `session-state.json` | Communication (any messages?) | When orchestrator forwards |

This split prevents sync issues - static context can't go stale.

---

## Phase 6: Project Configuration

Projects opt-in via configuration:

```json
// orchestration.config.json (in project root)
{
  "version": "1.0",
  "project": {
    "github": {
      "owner": "joshsmithxrm",
      "repo": "power-platform-developer-suite"
    },
    "worktreeRoot": "..",
    "worktreePrefix": "ppds-issue-"
  },
  "worker": {
    "promptTemplate": ".claude/templates/worker-prompt.md",
    "statusCommand": "orch update"
  },
  "dashboard": {
    "sessionsDir": "~/.orchestration/{project}/sessions",
    "port": 3847
  }
}
```

---

## Phase 7: PPDS Migration

1. **Parallel operation** - PPDS keeps its implementation, new tool developed here
2. **Feature parity** - New tool matches PPDS session commands
3. **Integration** - PPDS configures to use `orch` instead of `ppds session`
4. **Cleanup** - Remove PPDS's built-in orchestration (or deprecate)

---

## Implementation Order

| Step | Deliverable | Status |
|------|-------------|--------|
| 1 | `packages/core` - Session types, store, basic CRUD | ✅ DONE |
| 2 | `packages/core` - Worker spawner (Windows Terminal) | ✅ DONE |
| 3 | `packages/cli` - Basic commands (spawn, list, update) | ✅ DONE |
| 4 | `packages/core` - File watcher | ✅ DONE |
| 5 | `packages/dashboard` - Tauri + React scaffold | ⬜ TODO |
| 6 | `packages/dashboard` - Worker list with real-time updates | ⬜ TODO |
| 7 | `packages/dashboard` - Backlog panel (GitHub issues) | ⬜ TODO |
| 8 | `packages/dashboard` - Stuck worker guidance flow | ⬜ TODO |
| 9 | `packages/dashboard` - PR review queue | ⬜ TODO |
| 10 | PPDS integration + migration | ⬜ TODO |

### Additional Items Discovered

| Item | Description | Status |
|------|-------------|--------|
| Tests | 46 tests for core + CLI | ✅ DONE |
| Trust bypass | Workers get trust prompt on new worktree directories | ⬜ TODO |
| CLI availability | Workers need `orch` command in PATH to report status | ⬜ TODO |

---

## Critical Files Reference

**From PPDS (to port):**
- `C:\VS\ppds\src\PPDS.Cli\Services\Session\SessionState.cs` - Data models
- `C:\VS\ppds\src\PPDS.Cli\Services\Session\SessionService.cs` - Core logic
- `C:\VS\ppds\src\PPDS.Cli\Services\Session\WindowsTerminalWorkerSpawner.cs` - Spawner
- `C:\VS\ppds\.claude\commands\orchestrate.md` - UX reference

**New files to create:**
- `packages/core/src/session/session-service.ts`
- `packages/core/src/session/session-store.ts`
- `packages/core/src/spawner/windows-terminal.ts`
- `packages/core/src/watcher/session-watcher.ts`
- `packages/cli/src/index.ts`
- `packages/dashboard/src/App.tsx`

---

## Verification Plan

1. **Core library works:**
   ```bash
   cd packages/core && npm test
   ```

2. **CLI spawns a worker:**
   ```bash
   orch spawn 1  # Uses issue #1 from this repo
   # Verify: Terminal tab opens, worktree created, session file written
   ```

3. **Dashboard shows real-time updates:**
   - Launch dashboard
   - Manually edit a session JSON file
   - Verify dashboard reflects change within 1 second

4. **Worker status updates flow through:**
   - Spawn worker
   - Worker calls `orch update --status working`
   - Dashboard shows "WORKING" status

5. **End-to-end workflow:**
   - View issue in backlog
   - Click "Spawn Worker"
   - Watch worker progress in dashboard
   - See PR in review queue when complete

---

## Key Design Decisions

1. **TypeScript over .NET** - Cross-platform, rich npm ecosystem, easier dashboard integration
2. **Tauri over Electron** - Lightweight, Rust backend handles file watching efficiently
3. **File-based coordination** - Simple, debuggable, compatible with existing PPDS format
4. **Multi-source activity detection** - Don't rely solely on workers calling update
5. **Configuration-first** - Projects opt-in with explicit config, not magic
6. **Two-file context split** - Static identity (`session-context.json`) + dynamic state (`session-state.json`) prevents sync issues and enables skill portability
