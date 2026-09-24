const { app, BrowserWindow, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const net = require('node:net');
const { pathToFileURL } = require('node:url');

const dataRoot = process.env.SW_DESKTOP_DATA || path.join(
  process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(app.getPath('exe')),
  'ScrollWeave-data',
);
fs.mkdirSync(dataRoot, { recursive: true });
app.setPath('userData', path.join(dataRoot, 'settings'));
let window;
let backend;
let quitting = false;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', (event) => {
    if (!backend || quitting) return;
    event.preventDefault();
    quitting = true;
    backend.closeServer().finally(() => app.quit());
  });
  app.whenReady().then(async () => {
    // Use a real extracted directory: the existing server resolves resources from cwd.
    process.chdir(app.getAppPath());
    process.env.NODE_ENV = 'production';
    process.env.SW_PROJECTS_DIR ||= path.join(dataRoot, 'Projects');
    process.env.SW_SCRATCH_WORKSPACE = path.join(dataRoot, '.session');
    process.env.SW_LIBRARY_PATH ||= path.join(dataRoot, 'projects.json');
    process.env.SW_AGENT_SETTINGS_PATH ||= path.join(dataRoot, 'settings', 'agent-settings.json');
    for (const [variable, executable] of [['SW_FFMPEG', 'ffmpeg.exe'], ['SW_FFPROBE', 'ffprobe.exe']]) {
      process.env[variable] ||= path.join(process.resourcesPath, 'media-tools', executable);
    }
    // Ask the OS for an unused loopback port, preserving the web server's MCP metadata.
    const port = await new Promise((resolve, reject) => {
      const probe = net.createServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        probe.close(() => resolve(address.port));
      });
    });
    process.env.PORT = String(port);
    backend = await import(pathToFileURL(path.join(app.getAppPath(), 'dist/server.mjs')).href);
    await backend.ready;
    const origin = `http://127.0.0.1:${port}`;
    window = new BrowserWindow({
      title: 'ScrollWeave', width: 1440, height: 940, minWidth: 1000, minHeight: 680,
      autoHideMenuBar: true, backgroundColor: '#101114', show: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
    });
    backend.setDirectoryDialog(async (options, signal) => {
      signal.throwIfAborted();
      const parent = BrowserWindow.getFocusedWindow() || window;
      const result = await dialog.showOpenDialog(parent, {
        title: options.mode === 'open' ? 'ScrollWeave · 打开项目文件夹' : 'ScrollWeave · 选择保存位置',
        defaultPath: options.initialDirectory,
        buttonLabel: options.mode === 'open' ? '打开项目' : '选择此文件夹',
        properties: ['openDirectory', 'dontAddToRecent'],
      });
      signal.throwIfAborted();
      return result.canceled ? null : (result.filePaths[0] || null);
    });
    window.webContents.on('will-navigate', (event, url) => {
      if (new URL(url).origin !== origin) event.preventDefault();
    });
    window.webContents.setWindowOpenHandler(({ url }) => ({
      action: new URL(url).origin === origin ? 'allow' : 'deny',
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
      },
    }));
    await window.loadURL(origin);
    window.show();
  }).catch((error) => {
    dialog.showErrorBox('ScrollWeave 启动失败', error.stack || String(error));
    app.quit();
  });
}
