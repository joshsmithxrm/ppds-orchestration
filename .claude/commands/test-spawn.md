# Test Spawn Worker

Test the spawn worker feature in the dashboard.

## Usage

- `/test-spawn <issue>` - Test spawning a worker for a specific issue (e.g., `/test-spawn 2`)
- `/test-spawn mock` - Test with mock data in browser-only mode
- `/test-spawn` - Interactive test (will prompt for issue number)

## Example

```
/test-spawn 2
/test-spawn mock
```

## Instructions

Based on the argument provided ($ARGUMENTS), test the spawn worker feature.

### Step 1: Determine test mode

- If argument is `mock` or empty: Use browser-only mode (Vite dev server)
- If argument is a number: Use Tauri mode for real CLI testing

### Step 2: Ensure the server is running

**For mock/browser mode:**
```bash
# Check if Vite is running on port 1420
netstat -ano | findstr :1420
```

If not running, start the Vite dev server in the background:
```bash
cd packages/dashboard && npm run dev
```

**For Tauri mode (real issue testing):**

First, ensure the CLI is built:
```bash
npm run build
```

Then start Tauri dev server:
```bash
cd packages/dashboard && npm run tauri:dev
```

Note: Tauri mode requires VS Build Tools and Rust toolchain.

### Step 3: Open the dashboard

Use Playwright MCP to navigate to the dashboard:

1. Call `mcp__plugin_playwright_playwright__browser_navigate` with URL `http://localhost:1420`
2. Wait for the page to load (use `mcp__plugin_playwright_playwright__browser_wait_for` with 2-3 seconds)
3. Take a snapshot to verify the page loaded correctly

### Step 4: Click the Spawn Worker button

1. Call `mcp__plugin_playwright_playwright__browser_snapshot` to get the current page state
2. Find the "+ Spawn Worker" button in the header
3. Call `mcp__plugin_playwright_playwright__browser_click` on the button

### Step 5: Enter the issue number

1. Take a snapshot to verify the modal opened
2. Find the "GitHub Issue Number" input field
3. Call `mcp__plugin_playwright_playwright__browser_type` to enter the issue number from $ARGUMENTS
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
- Whether the spawn was successful
- The new session ID (from console logs in mock mode)
- Any errors encountered
- Screenshot of the final state

## Key Indicators

| Result | What to Look For |
|--------|------------------|
| Success | Modal closes, new worker card appears with status "Registered" |
| Mock Success | Console shows `[Mock] Spawned worker: session-X-timestamp` |
| Validation Error | Yellow error message in modal |
| API Error | Red error message in modal |
| CLI Error | Error from `orch spawn` command in Tauri mode |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| Port 1420 in use | Stop existing server or use different port |
| `orch` not found | Run `npm run build` first |
| GitHub auth error | Run `gh auth login` |
| Issue not found | Verify issue number exists in repo |

## Notes

- In mock mode, spawned workers get fake data (`Mock Issue #N`)
- In Tauri mode, the CLI fetches real issue data from GitHub
- The file watcher automatically updates the dashboard when new sessions are created
- "Dev Mode" badge indicates browser-only mode (mock data)
