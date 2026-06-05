import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

const WORKSPACE_PKGS = [
  '@lolzteam/shared-ipc',
  '@lolzteam/shared-types',
  '@lolzteam/adapter-contract',
  '@lolzteam/market-sdk',
];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS })],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@shared-ipc': resolve('../../packages/shared-ipc/src'),
        '@shared-types': resolve('../../packages/shared-types/src'),
        '@lolzteam/shared-ipc': resolve('../../packages/shared-ipc/src/index.ts'),
        '@lolzteam/shared-types': resolve('../../packages/shared-types/src/index.ts'),
        '@lolzteam/adapter-contract': resolve('../../packages/adapter-contract/src/index.ts'),
        '@lolzteam/market-sdk': resolve('../../packages/market-sdk/src/index.ts'),
        '@adapter-contract': resolve('../../packages/adapter-contract/src'),
        '@market-sdk': resolve('../../packages/market-sdk/src'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: WORKSPACE_PKGS })],
    resolve: {
      alias: {
        '@shared-ipc': resolve('../../packages/shared-ipc/src'),
        '@shared-types': resolve('../../packages/shared-types/src'),
        '@lolzteam/shared-ipc': resolve('../../packages/shared-ipc/src/index.ts'),
        '@lolzteam/shared-types': resolve('../../packages/shared-types/src/index.ts'),
        '@lolzteam/adapter-contract': resolve('../../packages/adapter-contract/src/index.ts'),
        '@lolzteam/market-sdk': resolve('../../packages/market-sdk/src/index.ts'),
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          toolbar: resolve('src/preload/toolbar.ts'),
        },
        output: {
          format: 'cjs',
          entryFileNames: '[name].js',
        },
      },
    },
  },
  renderer: {
    root: resolve('src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '~': resolve('src/renderer'),
        '~styles': resolve('src/renderer/styles'),
        '@shared-ipc': resolve('../../packages/shared-ipc/src'),
        '@shared-types': resolve('../../packages/shared-types/src'),
        '@adapter-contract': resolve('../../packages/adapter-contract/src'),
        '@lolzteam/shared-ipc': resolve('../../packages/shared-ipc/src/index.ts'),
        '@lolzteam/shared-types': resolve('../../packages/shared-types/src/index.ts'),
        '@lolzteam/adapter-contract': resolve('../../packages/adapter-contract/src/index.ts'),
        '@lolzteam/market-sdk': resolve('../../packages/market-sdk/src/index.ts'),
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          api: 'modern-compiler',
          additionalData: `@use "~styles/tokens" as *;\n@use "~styles/mixins" as *;\n`,
          loadPaths: [resolve('src/renderer')],
        },
      },
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          toolbar: resolve('src/renderer/toolbar/index.html'),
        },
      },
    },
  },
});
