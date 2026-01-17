/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // PPDS brand colors - pure black theme
        'ppds-bg': '#000000',
        'ppds-card': '#0a0a0a',
        'ppds-header': '#000000',
        'ppds-surface': '#111111',  // borders, secondary surfaces
        'ppds-accent': '#25c2a0',
        'ppds-muted': '#8b949e',
        'ppds-ralph': '#a855f7',  // purple-500 - Ralph mode indicator
        // Status colors matching CLI
        'status-registered': '#6b7280',   // gray
        'status-planning': '#3b82f6',     // blue
        'status-working': '#22c55e',      // green
        'status-shipping': '#06b6d4',     // cyan
        'status-stuck': '#ef4444',        // red
        'status-paused': '#eab308',       // yellow
        'status-complete': '#22c55e',     // green
        'status-cancelled': '#6b7280',    // gray
      },
    },
  },
  plugins: [],
};
