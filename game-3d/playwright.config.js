import { defineConfig, devices } from '@playwright/test';

// WebXR (mesmo emulado via IWER) só funciona em contexto seguro. O
// vite.config.js já serve https:// localmente via vite-plugin-mkcert
// (certificado autoassinado) — daí o ignoreHTTPSErrors abaixo, senão o
// Chromium do Playwright rejeita a conexão antes de qualquer teste rodar.
const PORT = 5183;
const BASE_URL = `https://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    ignoreHTTPSErrors: true,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
