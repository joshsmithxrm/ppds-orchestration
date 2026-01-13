/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // PPDS brand colors (from ppds-docs branding)
        'ppds-bg': '#1e1e1e',
        'ppds-card': '#252525',
        'ppds-header': '#141414',
        'ppds-accent': '#25c2a0',
        'ppds-muted': '#8b949e',
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
