import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

const executablePath = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith('--')) || 'release/win-unpacked/ScrollWeave.exe');
fs.mkdirSync(path.resolve('tmp'), { recursive: true });
const dataRoot = fs.mkdtempSync(path.resolve('tmp/desktop-smoke-'));
const env = { ...process.env, SW_DESKTOP_DATA: dataRoot };
delete env.ELECTRON_RUN_AS_NODE;
const desktop = await electron.launch({ executablePath, env, timeout: 90000 });
try {
  const page = await desktop.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: /新建项目/ }).first().waitFor();
  const checks = await desktop.evaluate(async ({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    const url = new URL(window.webContents.getURL()).origin;
    const state = await (await fetch(url + '/api/state')).json();
    const workspace = await (await fetch(url + '/api/workspace')).json();
    const preview = await (await fetch(url + '/api/preview')).text();
    const projects = await (await fetch(url + '/api/projects')).json();
    return { version: app.getVersion(), url, state: !!state.project,
      workspace, projects, preview: preview.startsWith('<!doctype html>'),
      preferences: window.webContents.getLastWebPreferences(),
      ffmpeg: process.env.SW_FFMPEG, ffprobe: process.env.SW_FFPROBE };
  });
  assert.equal(checks.state, true);
  assert.equal(checks.preview, true);
  assert.deepEqual(checks.projects.projects, [], 'Fresh desktop starts with an empty project list');
  assert.equal(fs.existsSync(path.join(dataRoot, 'Projects/My-first-work')), false);
  assert.equal(checks.preferences.nodeIntegration, false);
  assert.equal(checks.preferences.contextIsolation, true);
  assert.equal(checks.preferences.sandbox, true);
  assert.ok(checks.workspace.directory.startsWith(dataRoot));
  for (const tool of [checks.ffmpeg, checks.ffprobe]) {
    assert.match(execFileSync(tool, ['-version'], { encoding: 'utf8', windowsHide: true }), /version/);
  }
  const picker = await desktop.evaluate(async ({ dialog, BrowserWindow }) => {
    const parent = BrowserWindow.getAllWindows()[0];
    const origin = new URL(parent.webContents.getURL()).origin;
    const original = dialog.showOpenDialog;
    let owned = false;
    let directoryOnly = false;
    dialog.showOpenDialog = async (owner, options) => {
      owned = owner === parent;
      directoryOnly = options.properties.includes('openDirectory');
      return { canceled: false, filePaths: [process.env.SW_PROJECTS_DIR] };
    };
    const pick = () => fetch(origin + '/api/directories/pick', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'parent', initialDirectory: process.env.SW_PROJECTS_DIR }),
    }).then(response => response.json());
    try {
      const selected = await pick();
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
      const canceled = await pick();
      return { owned, directoryOnly, selected, canceled };
    } finally { dialog.showOpenDialog = original; }
  });
  assert.equal(picker.owned, true);
  assert.equal(picker.directoryOnly, true);
  assert.equal(picker.selected.directory, fs.realpathSync(path.join(dataRoot, 'Projects')));
  assert.equal(picker.canceled.directory, null);
  if (process.argv.includes('--native')) {
    await page.getByRole('button', { name: '打开文件夹', exact: true }).click();
    console.log('Native folder dialog opened; waiting for manual cancellation.');
    const pending = page.getByText('请在系统窗口中选择文件夹。', { exact: true });
    await pending.waitFor({ state: 'visible' });
    await pending.waitFor({ state: 'hidden', timeout: 120000 });
  }
  await page.screenshot({ path: path.join(dataRoot, 'desktop.png') });
  const created = await page.evaluate(async () => {
    const response = await fetch('/api/projects', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Desktop smoke project' }),
    });
    return { status: response.status, body: await response.json() };
  });
  assert.equal(created.status, 200);
  assert.equal(created.body.projects.length, 1);
  assert.equal(created.body.projects[0].name, 'Desktop smoke project');
  console.log(JSON.stringify({ executablePath, dataRoot, version: checks.version,
    url: checks.url, state: checks.state, preview: checks.preview, mediaTools: true }, null, 2));
} finally {
  await desktop.close();
}
assert.equal(fs.existsSync(path.join(dataRoot, '.session/.scrollweave/server.lock')), false);
assert.ok(fs.existsSync(path.join(dataRoot, '.session/project.scrollweave.json')));
console.log('Desktop smoke passed; project persisted and workspace lock released.');
const restarted = await electron.launch({ executablePath, env, timeout: 90000 });
try {
  const page = await restarted.firstWindow();
  await page.getByRole('button', { name: /新建项目/ }).first().waitFor();
  const projects = await page.evaluate(async () => (await (await fetch('/api/projects')).json()).projects);
  assert.equal(projects.length, 1);
  assert.equal(projects[0].name, 'Desktop smoke project');
  assert.equal(projects[0].active, true);
  console.log('Created project restored after restart; no extra default project.');
} finally { await restarted.close(); }
