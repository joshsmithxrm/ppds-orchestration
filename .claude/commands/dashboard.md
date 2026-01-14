# Dashboard Dev Server

Manage the web dashboard development server.

## Usage

- `/dashboard start` - Start the dev server
- `/dashboard stop` - Stop the dev server
- `/dashboard` (no args) - Check server status

## Instructions

Based on the argument provided ($ARGUMENTS), perform the appropriate action:

### If "start" or no argument with intent to start:
1. Start the web dev server in the background:
   ```bash
   npm run dev -w packages/web
   ```
2. Run this in the background so it doesn't block
3. The Vite server runs on http://localhost:5173
4. The Express API server runs on http://localhost:3847
5. Tell the user the server is starting and provide the URL (use 5173)

### If "stop":
1. Find and kill processes running on ports 5173 and 3847:
   ```bash
   # Windows
   netstat -ano | findstr :5173
   netstat -ano | findstr :3847
   taskkill /PID <pid> /F
   ```
2. Confirm the server was stopped

### If checking status (no args):
1. Check if ports 5173 and 3847 are in use
2. Report whether the servers appear to be running

## Notes

- The dev server runs both Vite frontend and Express backend concurrently
- Access the dashboard via http://localhost:5173 (Vite dev server)
- The backend API is at http://localhost:3847 but Vite proxies requests in dev mode
- WebSocket real-time updates may not work in dev mode; use production build for full testing
