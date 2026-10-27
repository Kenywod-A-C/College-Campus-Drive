import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    // Compile-time constant: lets the bundler drop the mock backend and demo credentials from real builds.
    define: { __USE_MOCK__: JSON.stringify(env.VITE_USE_MOCK === 'true') },
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: 5173,
      // Flask backend: all REST calls go to /api/v1/* (override with VITE_DEV_PROXY_TARGET)
      proxy: { '/api': env.VITE_DEV_PROXY_TARGET ?? process.env.VITE_DEV_PROXY_TARGET ?? 'http://127.0.0.1:5000' },
    },
    // Service/unit tests run in node; page tests opt in to jsdom with a `// @vitest-environment jsdom` docblock.
    test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'], setupFiles: ['src/test/setup.ts'], css: false },
  };
});
