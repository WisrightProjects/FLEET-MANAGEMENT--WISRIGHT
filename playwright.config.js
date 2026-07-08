// playwright.config.js — Fleet Management QA Suite

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 8000 },
  fullyParallel: false,   // Run sequentially so backend isn't hammered
  retries: 1,
  workers: 1,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'on-failure' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.BASE_URL || 'http://localhost:5000',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'on-first-retry',
    extraHTTPHeaders: {
      'Content-Type': 'application/json',
      'Token': 'fleet-secret-2024',  // Device auth token from backend .env
    },
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],
});
