import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative asset paths so the build loads from file:// inside Electron.
  base: './',
  build: { outDir: 'dist', emptyOutDir: true },
  test: { include: ['src/**/*.test.ts'] },
});
