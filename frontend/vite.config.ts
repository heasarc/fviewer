import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { playwright } from '@vitest/browser-playwright'; 

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // base: '/azoghbi/fviewer/',
  base: './',
  build: {
    // Output directly to the Python package folder
    outDir: '../fviewer/static',
    emptyOutDir: true,
    // Configure Rollup to NOT add hashes to files
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`
      }
    }
  },
  assetsInclude: ['**/*.fits'],  // for testing
  optimizeDeps: {
    include: ['wasm-cfitsio']
  },
  test: {
    // Enable browser mode
    browser: {
      enabled: true,
      provider: playwright(),
      headless: true, // Set to false if you want to visibly see the browser open
      instances: [
        { browser: 'chromium' }
      ]
    },
    // Pattern to find your tests
    include: ['tests/**/*.test.{ts,tsx}'],
  },
})
