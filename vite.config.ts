import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

/** Writes sw.js with the list of this build's files, so the installed site works offline right away. */
function serviceWorker(): Plugin {
  return {
    name: 'durak-sw',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && f !== 'index.html' && !/\.woff$/.test(f))
      const source = readFileSync(new URL('./scripts/sw.template.js', import.meta.url), 'utf8').replace('__PRECACHE__', JSON.stringify(files.map((f) => `./${f}`)))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source })
    },
  }
}

// `--mode single` inlines everything into one HTML file for sharing as a single page.
// WEB_VERSION is set by the release workflow; over-the-air updates compare against it.
export default defineConfig(({ mode }) => ({
  base: './',
  define: { __WEB_VERSION__: JSON.stringify(process.env.WEB_VERSION ?? '0.0.0-dev') },
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react(), serviceWorker()],
  worker: { format: 'es' },
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    rollupOptions:
      mode === 'single'
        ? undefined
        : {
            output: {
              // Libraries change rarely: their own files stay cached across deploys.
              manualChunks: { react: ['react', 'react-dom'], motion: ['framer-motion'] },
            },
          },
  },
}))
