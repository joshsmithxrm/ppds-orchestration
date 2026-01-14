# Dev

Start the development server with hot reload.

## Usage

`/dev`

## Process

1. Check if ports 5173/3847 are in use
2. Start the web dev server:
   ```bash
   npm run dev -w packages/web
   ```
3. Report the URL (http://localhost:5173)

## Notes

- Vite server: http://localhost:5173
- Express API: http://localhost:3847 (proxied by Vite in dev)
- WebSocket updates may not work in dev mode
