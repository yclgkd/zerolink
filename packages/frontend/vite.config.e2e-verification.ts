import path from 'node:path';

import type { Plugin } from 'vite';
import { defineConfig, mergeConfig } from 'vite';

import baseConfig from './vite.config';

const e2eKeyPath = path.resolve(__dirname, 'src/release/public-key.e2e.ts');

function swapPublicKeyModule(): Plugin {
  return {
    enforce: 'pre',
    name: 'e2e-swap-public-key',
    resolveId(source, importer) {
      if (!importer) return null;
      // Match any import that resolves to the production public-key module
      if (source.endsWith('/release/public-key') || source.endsWith('/release/public-key.ts')) {
        return e2eKeyPath;
      }
      return null;
    },
  };
}

// E2E verification build: swaps the production public key module with a
// test-only key pair so Playwright tests can sign valid manifests.
export default mergeConfig(
  baseConfig,
  defineConfig({
    plugins: [swapPublicKeyModule()],
  })
);
