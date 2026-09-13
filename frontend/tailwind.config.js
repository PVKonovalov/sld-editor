/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          900: '#0d1117',
          800: '#12161d',
          700: '#1a1f2e',
          600: '#232a3b',
          500: '#2d3650',
        },
        accent: {
          DEFAULT: '#3b82f6',
          hover: '#2563eb',
        },
        state: {
          open: '#22c55e',
          closed: '#ef4444',
          warning: '#eab308',
        },
      },
    },
  },
  plugins: [],
}
