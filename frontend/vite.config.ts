import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The app's own version, shown in the About dialog: APP_VERSION when set
// (the root Makefile passes its own VERSION through it), otherwise the
// git tag this checkout is at (`git describe --tags --always --dirty`),
// or "dev" when git isn't available.
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  try {
    return execSync('git describe --tags --always --dirty', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  // The libraries (React, react-zoom-pan-pinch, lucide-react) go to their own vendor-[hash].js: it stays under the
  // 500 kB chunk warning with the app, and a browser keeps it cached across app updates.
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: 'vendor', test: /node_modules/ }],
        },
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: 'http://localhost:8099',
        changeOrigin: true,
      },
    },
  },
})
