import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@shared-types': r('../../packages/shared-types/src/index.ts'),
      '@shared-ipc': r('../../packages/shared-ipc/src/index.ts'),
      '@adapter-contract': r('../../packages/adapter-contract/src/index.ts'),
      '@market-sdk': r('../../packages/market-sdk/src/index.ts'),
    },
  },
  test: {
    include: ['src/**/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
