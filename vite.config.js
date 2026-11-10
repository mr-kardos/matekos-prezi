import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// "npm run build"      -> dist/      (used by Tauri, MathJax served locally)
// "npm run build:web"  -> dist-web/  (one self-contained HTML file for browser testing)
export default defineConfig(({ mode }) => ({
  base: './',
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },      // the app's own version (update notice)
  publicDir: mode === 'web' ? false : 'public',
  build: {
    target: 'es2021',
    outDir: mode === 'web' ? 'dist-web' : 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 5000,
    assetsInlineLimit: mode === 'web' ? 100_000_000 : 4096
  },
  plugins: mode === 'web' ? [viteSingleFile()] : []
}));
