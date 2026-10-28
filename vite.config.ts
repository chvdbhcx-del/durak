import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `--mode single` inlines everything into one HTML file for sharing as a single page.
// WEB_VERSION is set by the release workflow; over-the-air updates compare against it.
export default defineConfig(({ mode }) => ({
  base: './',
  define: { __WEB_VERSION__: JSON.stringify(process.env.WEB_VERSION ?? '0.0.0-dev') },
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  build: { outDir: mode === 'single' ? 'dist-single' : 'dist' },
}))
