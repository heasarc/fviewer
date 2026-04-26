import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  }
})
