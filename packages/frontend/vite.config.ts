import path from 'node:path';

import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import type { PluginOption, ResolvedConfig } from 'vite';
import { configDefaults, defineConfig } from 'vitest/config';

import { removeDevOnlyPublicAssets } from './tools/remove-dev-public-assets';

function stripDevOnlyPublicAssets(): PluginOption {
  let resolvedConfig: ResolvedConfig | undefined;

  return {
    apply: 'build',
    configResolved(config) {
      resolvedConfig = config;
    },
    async closeBundle() {
      if (!resolvedConfig) {
        return;
      }

      const outDir = path.resolve(resolvedConfig.root, resolvedConfig.build.outDir);
      await removeDevOnlyPublicAssets(outDir);
    },
    name: 'strip-dev-only-public-assets',
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), stripDevOnlyPublicAssets()],
  build: {
    // Minimum supported browsers (see README §浏览器兼容性):
    //   Chrome 90 / Firefox 85 / Safari 14.1 / Edge 90  (all released 2021)
    // Rationale: covers all required APIs (WebCrypto, WebAuthn, IndexedDB, ES2020+)
    // without polyfills. Ed25519 falls back to @noble/ed25519 on older WebCrypto stacks.
    target: ['chrome90', 'firefox85', 'safari14.1', 'edge90'],
  },
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    testTimeout: 20_000,
    exclude: [...configDefaults.exclude, 'e2e/**', 'playwright.config.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/__tests__/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
        'src/**/*.d.ts',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/styles/**',
      ],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
