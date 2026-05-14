import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Vite plugin: remaps `.js`-suffixed relative imports to `.ts` files.
// The GA pipeline uses `.js` extensions for Node ESM compatibility, but the
// actual source files are `.ts`. This plugin intercepts those imports at
// resolve time so Vite can find and bundle the TypeScript sources directly.
const jsToTsResolver = {
  name: 'js-to-ts-resolver',
  async resolveId(source: string, importer: string | undefined) {
    if (source.startsWith('.') && source.endsWith('.js') && importer) {
      const tsSource = source.replace(/\.js$/, '.ts')
      const resolved = await this.resolve(tsSource, importer, { skipSelf: true })
      return resolved ?? null
    }
    return null
  },
}

export default defineConfig({
  plugins: [jsToTsResolver, react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@pipeline': path.resolve(__dirname, '../src'),
    },
  },
  define: {
    'process.env.NODE_ENV': JSON.stringify('development'),
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
