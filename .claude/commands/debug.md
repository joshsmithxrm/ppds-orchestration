# Debug Dashboard

Autonomously test and fix the current feature using Playwright MCP tools.

## Usage

- `/debug` - Test current feature from conversation context
- `/debug <scenario>` - Test specific scenario

## Behavior

You are **FULLY AUTONOMOUS**. The user wants out of the loop.

- Start servers, build, test, fix, iterate - without asking
- Only report back when **FIXED** or **TRULY BLOCKED**
- Don't ask permission for rebuilds, retests, or fixes

## Instructions

### Phase 1: Setup

1. **Build the project** (in background):
   ```bash
   npm run build
   ```

2. **Start dev server** (in background):
   ```bash
   npm run dev -w packages/web
   ```

3. **Wait for server ready** - look for "ready in Xms" or similar in output

4. **Verify server** - navigate to http://localhost:5173

### Phase 2: Identify Test Target

From conversation context, identify:
- What feature/fix we're testing
- Success criteria (what "working" looks like)
- Failure indicators (what we're trying to fix)

If context is unclear, the user likely wants you to test whatever was just implemented or discussed.

### Phase 3: Execute Test Loop

Use Playwright MCP tools to test the feature:

**Common Playwright Selectors (Dashboard):**

| Element | Selector |
|---------|----------|
| Dashboard heading | `page.getByRole('heading', { name: 'Dashboard' })` |
| Spawn button | `page.getByRole('button', { name: /\+ Spawn Worker/i })` |
| Spawn dialog | `page.getByRole('heading', { name: 'Spawn Worker', exact: true })` |
| Repo dropdown | `page.getByRole('combobox')` |
| Issue input | `page.getByPlaceholderText('e.g., 5 or 1, 2, 3')` |
| Manual mode | `page.getByRole('button', { name: 'Manual' })` |
| Autonomous mode | `page.getByRole('button', { name: 'Autonomous' })` |
| Submit spawn | `page.getByRole('button', { name: /Spawn Worker/i, exact: true })` |
| Live Terminal | `page.getByRole('heading', { name: 'Live Terminal' })` |

**Test Flow:**
1. Navigate to dashboard
2. Perform actions to trigger the feature
3. Observe results (snapshots, console, network)
4. Compare against success criteria

### Phase 4: Fix Loop (if test fails)

1. **Capture diagnostic data:**
   - `browser_take_screenshot` - visual state
   - `browser_console_messages` - JS errors
   - `browser_network_requests` - API failures
   - Read server output file for backend logs

2. **Diagnose failure point:**
   - Where did it break?
   - What error messages?
   - What's different from expected?

3. **Read relevant source files**

4. **Make code fix**

5. **Rebuild:**
   ```bash
   npm run build
   ```

6. **Re-test** - back to Phase 3

7. **Repeat** until success OR blocked

### Phase 5: Report

**Only stop when:**

✅ **SUCCESS** - Feature works, all criteria met
- Report what was tested
- Confirm success criteria met
- Ask user to verify if needed

❌ **BLOCKED** - Can't fix autonomously
- Explain what's failing
- Show diagnostic data
- Describe what you tried
- Ask for user input/decision

## Key Principle

**Iterate silently. Don't ask permission. Fix and re-test.**

The user trusts you to figure it out. Only come back when done or truly stuck.

## Key Files

| File | Purpose |
|------|---------|
| `packages/web/src/App.tsx` | Main React app |
| `packages/web/src/pages/Dashboard.tsx` | Dashboard page |
| `packages/web/src/pages/SessionView.tsx` | Session detail page |
| `packages/web/src/components/Terminal.tsx` | Live terminal component |
| `packages/web/src/components/SpawnDialog.tsx` | Worker spawn dialog |
| `packages/web/server/index.ts` | Express backend |
| `packages/core/src/spawner/` | Worker spawning logic |

## Notes

- Dev server runs on port 5173 (Vite frontend) with backend on 3847
- Always use `npm run dev -w packages/web` to start both together
- WebSocket updates require the full dev server, not just Vite
- If browser gets stuck, use `browser_close` and re-navigate
