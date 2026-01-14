# Serve

Build and serve the production site locally.

## Usage

`/serve`

## Process

1. Build the packages:
   ```bash
   npm run build
   ```
2. Start the production server:
   ```bash
   npm run start -w packages/web
   ```
3. Report the URL (e.g., http://localhost:3847)

## Notes

- Use this to test WebSocket real-time updates
- Full production build with all features enabled
