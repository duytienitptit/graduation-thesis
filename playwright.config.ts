import { defineConfig } from '@playwright/test';

export const API_PORT = 4100;
export const WEB_PORT = 3100;

// Its own API and web, so a running dev server keeps its bot and queue to itself:
// the bot is off, and images come from the fake provider.
const api = {
  API_PORT: String(API_PORT),
  WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
  TELEGRAM_ENABLED: 'false',
  IMAGE_PROVIDER: 'fake',
  QUEUE_PREFIX: 'e2e',
};

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: 'list',
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'pnpm --filter api build && pnpm --filter api start',
      url: `http://localhost:${API_PORT}/health`,
      env: api,
      timeout: 120_000,
      reuseExistingServer: false,
    },
    {
      command: `pnpm --filter web build && pnpm --filter web exec next start --port ${WEB_PORT}`,
      url: `http://localhost:${WEB_PORT}/login`,
      env: { NEXT_PUBLIC_API_URL: `http://localhost:${API_PORT}` },
      timeout: 180_000,
      reuseExistingServer: false,
    },
  ],
});
