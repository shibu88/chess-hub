import { defineConfig } from '@playwright/test';

// Browser tests against the Vite dev server. Engine searches are single-threaded
// WASM and CPU-heavy, so we run serially for reliable timing.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    headless: true,
  },
  webServer: {
    command: 'npm run dev',
    port: 5173,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
