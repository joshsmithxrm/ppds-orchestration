# Test Spawn Worker

Test the spawn worker feature in the web dashboard.

## Usage

```
/test-spawn <mode> <issue>
```

### Modes

| Mode | Description |
|------|-------------|
| `mock` | Browser-only with mock data (fast, no prerequisites) |
| `live` | Full web app with real GitHub data |

### Examples

```bash
/test-spawn mock 2          # Test issue #2 with mock data
/test-spawn live 2          # Test issue #2 with real GitHub API
/test-spawn mock            # Mock mode, will prompt for issue
/test-spawn live            # Live mode, will prompt for issue
```

## Instructions

Based on the arguments provided ($ARGUMENTS), test the spawn worker feature.

### Step 1: Parse arguments

Parse $ARGUMENTS to extract:
- **mode**: First argument - either `mock` or `live`
- **issue**: Second argument - the GitHub issue number (optional, prompt if missing)

If only one argument is provided:
- If it's `mock` or `live`: use that mode, prompt for issue number
- If it's a number: default to `mock` mode with that issue number

### Step 2: Start the server

**For mock mode:**
```bash
# Check if Vite is running on port 5173
netstat -ano | findstr :5173
```

If not running, start the Vite dev server in the background:
```bash
npm run dev -w packages/web
```

**For live mode:**

First, verify prerequisites:
```bash
gh auth status
```

Ensure the packages are built:
```bash
npm run build
```

Then start the web app:
```bash
npm run dev -w packages/web
```

### Step 3: Open the dashboard

Use Playwright MCP to navigate to the dashboard:

1. Call `mcp__plugin_playwright_playwright__browser_navigate` with URL `http://localhost:5173`
2. Wait for the page to load (use `mcp__plugin_playwright_playwright__browser_wait_for` with 2-3 seconds)
3. Take a snapshot to verify the page loaded correctly

### Step 4: Click the Spawn Worker button

1. Call `mcp__plugin_playwright_playwright__browser_snapshot` to get the current page state
2. Find the "+ Spawn Worker" button in the header
3. Call `mcp__plugin_playwright_playwright__browser_click` on the button

### Step 5: Enter the issue number

1. Take a snapshot to verify the modal opened
2. Find the "GitHub Issue Number" input field
3. Call `mcp__plugin_playwright_playwright__browser_type` to enter the issue number
4. Take a snapshot to verify the input

### Step 6: Submit and verify

1. Click the "Spawn" button
2. Wait 2-3 seconds for the operation to complete
3. Take a final snapshot
4. Check for:
   - Modal closed (success)
   - New worker appears in "Active Workers" list
   - Or error message displayed (if spawn failed)

### Step 7: Report results

Summarize the test:
- **Mode**: mock or live
- **Issue**: The issue number tested
- **Result**: Success or failure
- **Session ID**: From console logs (mock) or file system (live)
- **Errors**: Any errors encountered
- **Screenshot**: Final state of dashboard

## Key Indicators

| Result | Mock Mode | Live Mode |
|--------|-----------|-----------|
| Success | Console: `[Mock] Spawned worker: session-X-timestamp` | New session folder in `~/.orchestration/{project}/sessions/` |
| Worker Title | `Mock Issue #N` | Real issue title from GitHub |
| Data Source | In-memory mock | Real file watcher |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 5173 in use | Stop existing server or let Vite auto-increment port |
| `orch` not found | Run `npm run build` first |
| GitHub auth error | Run `gh auth login` |
| Issue not found | Verify issue number exists in repo |

## Mode Comparison

| Feature | Mock Mode | Live Mode |
|---------|-----------|-----------|
| Speed | Fast (seconds) | Fast (seconds) |
| Prerequisites | Node.js only | Node.js + gh CLI |
| Data | Fake/mock | Real GitHub API |
| File watcher | Simulated | Real file system |
| Best for | UI testing | End-to-end testing |
