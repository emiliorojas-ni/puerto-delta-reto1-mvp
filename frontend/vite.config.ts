/// <reference types="vitest/config" />
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, transformWithEsbuild, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Compila src/service-worker.ts (fuente tipada) a dist/sw.js en la build de producción.
 * Inyecta un nombre de caché versionado y la lista de recursos del app shell
 * (index.html, manifest, iconos y los /assets/* con hash de esta build).
 */
function serviceWorkerPlugin(): Plugin {
  const swSource = fileURLToPath(new URL('./src/service-worker.ts', import.meta.url))
  return {
    name: 'puerto-delta-service-worker',
    apply: 'build',
    enforce: 'post',
    async writeBundle(options, bundle) {
      const assets = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map') && f !== 'sw.js')
        .map((f) => '/' + f.replace(/\\/g, '/'))
      const shell = [
        '/',
        '/index.html',
        '/manifest.webmanifest',
        '/icons/icon.svg',
        '/icons/icon-maskable.svg',
        '/icons/icon-192.png',
        '/icons/icon-512.png',
      ]
      const precache = Array.from(new Set([...shell, ...assets]))
      const version = Date.now().toString(36)
      const ts = await readFile(swSource, 'utf8')
      const replaced = ts
        .replace('__SW_VERSION__', version)
        .replace('"__PRECACHE_MANIFEST__"', JSON.stringify(precache))
      const out = await transformWithEsbuild(replaced, 'service-worker.ts', {
        loader: 'ts',
        format: 'iife',
        target: 'es2020',
        minify: true,
      })
      const outDir = options.dir ?? fileURLToPath(new URL('./dist', import.meta.url))
      await writeFile(join(outDir, 'sw.js'), out.code, 'utf8')
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [react(), serviceWorkerPlugin()],
  server: {
    port: 5173,
    proxy: {
      // Mismo origen para cookies de sesión y CSRF: no reescribir Origin/Host.
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
  preview: {
    port: 4173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
})
