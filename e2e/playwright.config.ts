import { defineConfig, devices } from '@playwright/test';

const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI || executablePath ? 1 : undefined,
  reporter: 'list',
  outputDir: 'test-results',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: executablePath ? 'off' : 'retain-on-failure',
    ...devices['Desktop Chrome'],
    launchOptions: executablePath
      ? {
          executablePath,
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
        }
      : undefined,
  },
  webServer: {
    command: 'npm run dev:e2e',
    url: 'http://127.0.0.1:4173/__e2e/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
