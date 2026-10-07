import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build loads from file:// inside Electron.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  test: { include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
