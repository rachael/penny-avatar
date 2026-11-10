/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, loadEnv } from 'vite';
import { musePlugin } from './server/muse-plugin';

// OPENROUTER_API_KEY comes from your shell or from .env.local (git-ignored).
// It is read here, in Node, and never bundled into the page.
Object.assign(process.env, { ...loadEnv('development', process.cwd(), ''), ...process.env });

export default defineConfig({
  plugins: [iwsdkDev(), musePlugin(process.cwd())],
  // allowedHosts: the phone reaches this dev server through a cloudflared quick tunnel
  // (*.trycloudflare.com), which Vite would otherwise reject as an unknown Host.
  server: { host: '0.0.0.0', port: 8081, open: false, allowedHosts: ['.trycloudflare.com', 'localhost'] },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (its own three vs the app's super-three alias). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
