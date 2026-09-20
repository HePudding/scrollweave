import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type PickerOptions = { mode: "open" | "parent"; initialDirectory: string };
type DialogResult = { code: number; stdout: string; stderr: string };
export type DialogRunner = (
  executable: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; signal: AbortSignal },
) => Promise<DialogResult>;

const runDialog: DialogRunner = (executable, args, options) =>
  new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      // This child owns interactive UI. SW_HIDE can hide the OS dialog as well.
      {
        ...options,
        windowsHide: process.platform !== "win32",
        encoding: "utf8",
        maxBuffer: 256 * 1024,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code !== "number") reject(error);
        else
          resolve({
            code: typeof error?.code === "number" ? error.code : 0,
            stdout,
            stderr,
          });
      },
    );
  });

// Paths are data in environment variables, never executable PowerShell source.
const windowsScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$dialog = [System.Windows.Forms.FolderBrowserDialog]::new()
try {
  $dialog.Description = $env:SW_PICKER_TITLE
  if ($dialog.PSObject.Properties['AutoUpgradeEnabled']) { $dialog.AutoUpgradeEnabled = $true }
  if ($dialog.PSObject.Properties['UseDescriptionForTitle']) { $dialog.UseDescriptionForTitle = $true }
  $dialog.SelectedPath = $env:SW_PICKER_INITIAL
  if ($dialog.PSObject.Properties['InitialDirectory']) { $dialog.InitialDirectory = $env:SW_PICKER_INITIAL }
  $dialog.ShowNewFolderButton = $env:SW_PICKER_MODE -eq 'parent'
  $selected = $null
  if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $selected = $dialog.SelectedPath }
  [Console]::WriteLine((@{ directory = $selected } | ConvertTo-Json -Compress))
} finally { $dialog.Dispose() }
`;

export async function systemDirectoryDialog(
  options: PickerOptions,
  signal: AbortSignal,
  platform: NodeJS.Platform = process.platform,
  run: DialogRunner = runDialog,
  environment: NodeJS.ProcessEnv = process.env,
): Promise<string | null> {
  const title =
    options.mode === "open"
      ? "ScrollWeave · 打开项目文件夹"
      : "ScrollWeave · 选择保存位置";
  const env = { ...environment };
  let candidates: { executable: string; args: string[] }[];
  if (platform === "win32") {
    Object.assign(env, {
      SW_PICKER_TITLE: title,
      SW_PICKER_INITIAL: options.initialDirectory,
      SW_PICKER_MODE: options.mode,
    });
    const args = [
      "-NoProfile",
      "-NonInteractive",
      "-STA",
      "-EncodedCommand",
      Buffer.from(windowsScript, "utf16le").toString("base64"),
    ];
    candidates = ["pwsh.exe", "powershell.exe"].map((executable) => ({
      executable,
      args,
    }));
  } else if (platform === "linux") {
    if (!env.DISPLAY && !env.WAYLAND_DISPLAY)
      throw Error("当前服务没有连接桌面会话，请输入文件夹的完整路径。");
    const kde = {
      executable: "kdialog",
      args: [
        "--title",
        title,
        "--getexistingdirectory",
        options.initialDirectory,
      ],
    };
    const gtk = {
      executable: "zenity",
      args: [
        "--file-selection",
        "--directory",
        `--title=${title}`,
        `--filename=${options.initialDirectory.replace(/\/$/, "")}/`,
      ],
    };
    candidates = /kde/i.test(env.XDG_CURRENT_DESKTOP ?? "")
      ? [kde, gtk]
      : [gtk, kde];
  } else {
    throw Error(
      "当前系统暂不支持自动打开文件夹选择器，请输入文件夹的完整路径。",
    );
  }
  for (const candidate of candidates) {
    signal.throwIfAborted();
    let result: DialogResult;
    try {
      result = await run(candidate.executable, candidate.args, { env, signal });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    signal.throwIfAborted();
    if (platform === "linux" && result.code === 1) return null;
    if (result.code !== 0)
      throw Error("系统文件夹选择器未能启动。请重试，或输入文件夹的完整路径。");
    if (platform === "win32") {
      const response = JSON.parse(result.stdout.replace(/^\uFEFF/, ""));
      if (response.directory === null || typeof response.directory === "string")
        return response.directory || null;
      throw Error("系统选择器未返回有效的文件夹路径。");
    }
    return result.stdout.replace(/\r?\n$/, "") || null;
  }
  throw Error(
    platform === "linux"
      ? "未找到系统选择器（Zenity 或 KDialog），请输入文件夹的完整路径。"
      : "未找到可用的 Windows 系统选择器，请输入文件夹的完整路径。",
  );
}

/** One OS dialog per service; disconnecting the browser also closes its dialog. */
export class DirectoryPicker {
  private active?: AbortController;
  constructor(private readonly show = systemDirectoryDialog) {}

  async pick(options: PickerOptions, signal: AbortSignal) {
    if (this.active)
      throw Error("已有系统文件夹选择器打开，请先完成或取消选择。");
    const controller = new AbortController();
    this.active = controller;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    try {
      signal.throwIfAborted();
      let initialDirectory = path.resolve(options.initialDirectory);
      try {
        if (!(await fs.stat(initialDirectory)).isDirectory())
          initialDirectory = os.homedir();
      } catch {
        initialDirectory = os.homedir();
      }
      const directory = await this.show(
        { ...options, initialDirectory },
        controller.signal,
      );
      controller.signal.throwIfAborted();
      if (directory === null) return null;
      if (
        !path.isAbsolute(directory) ||
        !(await fs.stat(directory)).isDirectory()
      )
        throw Error("请选择可访问的文件夹。");
      return await fs.realpath(directory);
    } finally {
      signal.removeEventListener("abort", abort);
      this.active = undefined;
    }
  }

  close() {
    this.active?.abort();
  }
}
