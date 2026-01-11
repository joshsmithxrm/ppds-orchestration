/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Dark mode color palette matching terminal/VS Code aesthetic
        dark: {
          bg: '#1e1e1e',
          surface: '#252526',
          border: '#3c3c3c',
          text: '#cccccc',
          muted: '#808080',
        },
      },
    },
  },
  plugins: [],
};
