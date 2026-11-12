import { defineConfig } from 'vite';

// Plain JS, no framework. Engine files live in public/engine/ and are served
// as-is (never bundled/renamed), so the .js can find its .wasm by name.
export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: false,
  },
});
