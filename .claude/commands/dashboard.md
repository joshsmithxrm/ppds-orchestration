# Dashboard Dev Server

Manage the dashboard development server.

## Usage

- `/dashboard start` - Start the Vite dev server
- `/dashboard stop` - Stop the dev server
- `/dashboard` (no args) - Check server status

## Instructions

Based on the argument provided ($ARGUMENTS), perform the appropriate action:

### If "start" or no argument with intent to start:
1. Start the Vite dev server in the background:
   ```bash
   cd packages/dashboard && npm run dev
   ```
2. Run this in the background so it doesn't block
3. The server runs on http://localhost:1420
4. Tell the user the server is starting and provide the URL

### If "stop":
1. Find and kill any process running on port 1420:
   ```bash
   # Windows
   netstat -ano | findstr :1420
   taskkill /PID <pid> /F
   ```
2. Confirm the server was stopped

### If checking status (no args):
1. Check if port 1420 is in use
2. Report whether the server appears to be running

## Notes

- This starts the Vite frontend dev server only (not full Tauri)
- For full Tauri dev (requires VS Build Tools): `npm run tauri:dev`
- The frontend will work standalone for UI development
