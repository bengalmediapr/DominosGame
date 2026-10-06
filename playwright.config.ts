import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testIgnore: '_*.spec.ts',
  // Each test renders a full 3D scene; on CPU-only machines parallel runs starve each other.
  workers: 1,
  timeout: 120_000,
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 1280, height: 800 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
  },
  webServer: { command: 'npm run build && npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true },
});
