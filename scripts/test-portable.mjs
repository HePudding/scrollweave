import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

fs.mkdirSync('tmp', { recursive: true });
const dataRoot = fs.mkdtempSync(path.resolve('tmp/portable-smoke-'));
const executablePath = path.resolve(process.argv[2] || 'release/ScrollWeave-0.2.0-portable-x64.exe');
const env = { ...process.env, SW_DESKTOP_DATA: dataRoot };
delete env.ELECTRON_RUN_AS_NODE;
// NSIS does not forward the child's inspector output; connect using Chromium's port file.
const child = spawn(executablePath, ['--remote-debugging-port=0'], { env, windowsHide: true, stdio: 'ignore' });
let exited = false;
child.once('exit', () => { exited = true; });
child.once('error', (error) => { throw error; });
const portFile = path.join(dataRoot, 'settings/DevToolsActivePort');
const deadline = Date.now() + 180000;
while (!fs.existsSync(portFile)) {
  if (exited || Date.now() > deadline) throw Error('Portable launch failed or timed out');
  await delay(500);
}
const port = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
const context = browser.contexts()[0];
const page = context.pages()[0] || await context.waitForEvent('page');
try {
  await page.getByRole('button', { name: /新建项目/ }).first().waitFor();
  const result = await page.evaluate(async () => ({
    url: location.href,
    state: !!(await (await fetch('/api/state')).json()).project,
    projects: (await (await fetch('/api/projects')).json()).projects,
    preview: (await (await fetch('/api/preview')).text()).startsWith('<!doctype html>'),
  }));
  assert.equal(result.state, true);
  assert.equal(result.preview, true);
  assert.deepEqual(result.projects, []);
  await page.screenshot({ path: path.join(dataRoot, 'portable.png') });
  console.log(JSON.stringify({ executablePath, dataRoot, ...result }, null, 2));
} finally {
  await page.evaluate(() => window.close()).catch(() => {});
  await browser.close().catch(() => {});
}
const shutdownDeadline = Date.now() + 30000;
while (!exited && Date.now() < shutdownDeadline) await delay(500);
assert.ok(exited, 'Portable launcher exits after closing the window');
assert.equal(fs.existsSync(path.join(dataRoot, '.session/.scrollweave/server.lock')), false);
console.log('Single-file portable extraction, UI, API, preview, and clean shutdown passed.');
