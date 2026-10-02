import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:8769',
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
    launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
  },
  webServer: {
    command: 'python3 -B -m http.server 8769 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8769',
    reuseExistingServer: false,
  },
});
