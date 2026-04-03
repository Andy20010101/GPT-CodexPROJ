import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.git/**',
      'src/artifacts/**',
      'artifacts/**',
      'tmp/**',
    ],
  },
});
