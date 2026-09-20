import { defineConfig } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const testDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), "scrollweave-browser-"),
);
const executablePath =
  process.env.SW_BROWSER_PATH ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  ].find((p) => fs.existsSync(p));
export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 120000,
  expect: { timeout: 10000 },
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4101",
    viewport: { width: 1440, height: 1000 },
    launchOptions: executablePath ? { executablePath } : {},
    screenshot: "only-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:4101/api/state",
    reuseExistingServer: false,
    timeout: 30000,
    env: {
      PORT: "4101",
      SW_WORKSPACE: path.join(testDirectory, "initial"),
      SW_PROJECTS_DIR: path.join(testDirectory, "projects"),
      SW_LIBRARY_PATH: path.join(testDirectory, "library.json"),
    },
  },
});
