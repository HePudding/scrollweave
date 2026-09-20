import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  DirectoryPicker,
  systemDirectoryDialog,
  type DialogRunner,
} from "../server/directory-picker";

const options = { mode: "open" as const, initialDirectory: os.tmpdir() };
const result = (stdout: string, code = 0) => ({ stdout, code, stderr: "" });

test("Windows selection preserves Unicode paths and treats path metacharacters only as data", async () => {
  const directory = "C:\\作品 空格\\$(do-not-run);'test'";
  const run: DialogRunner = async (_file, args, config) => {
    assert.equal(config.env.SW_PICKER_INITIAL, directory);
    assert.ok(
      !Buffer.from(args.at(-1)!, "base64")
        .toString("utf16le")
        .includes(directory),
    );
    return result(JSON.stringify({ directory }));
  };
  assert.equal(
    await systemDirectoryDialog(
      { ...options, initialDirectory: directory },
      new AbortController().signal,
      "win32",
      run,
    ),
    directory,
  );
});

test("Windows cancellation returns null; missing PowerShell 7 falls back to Windows PowerShell", async () => {
  const calls: string[] = [];
  const run: DialogRunner = async (file) => {
    calls.push(file);
    if (file === "pwsh.exe")
      throw Object.assign(Error("missing"), { code: "ENOENT" });
    return result('{"directory":null}');
  };
  assert.equal(
    await systemDirectoryDialog(
      options,
      new AbortController().signal,
      "win32",
      run,
    ),
    null,
  );
  assert.deepEqual(calls, ["pwsh.exe", "powershell.exe"]);
});

test("Linux chooses the desktop dialog and never opens a second dialog after cancellation", async () => {
  const calls: string[] = [];
  const run: DialogRunner = async (file) => {
    calls.push(file);
    return result("", 1);
  };
  assert.equal(
    await systemDirectoryDialog(
      options,
      new AbortController().signal,
      "linux",
      run,
      { WAYLAND_DISPLAY: "wayland-0", XDG_CURRENT_DESKTOP: "KDE" },
    ),
    null,
  );
  assert.deepEqual(calls, ["kdialog"]);
});

test("Linux missing dialog falls back, while launch failure and headless sessions report errors", async () => {
  const calls: string[] = [];
  const run: DialogRunner = async (file) => {
    calls.push(file);
    if (file === "zenity")
      throw Object.assign(Error("missing"), { code: "ENOENT" });
    return result("/home/作品 folder\n");
  };
  assert.equal(
    await systemDirectoryDialog(
      options,
      new AbortController().signal,
      "linux",
      run,
      { DISPLAY: ":0" },
    ),
    "/home/作品 folder",
  );
  assert.deepEqual(calls, ["zenity", "kdialog"]);
  await assert.rejects(
    systemDirectoryDialog(
      options,
      new AbortController().signal,
      "linux",
      run,
      {},
    ),
    /桌面会话/,
  );
  await assert.rejects(
    systemDirectoryDialog(
      options,
      new AbortController().signal,
      "linux",
      async () => result("", 2),
      { DISPLAY: ":0" },
    ),
    /未能启动/,
  );
});

test("picker validates the selected folder, supports cancellation, and is reusable after failure", async () => {
  const directory = await fs.mkdtemp(
    path.join(os.tmpdir(), "scrollweave-picker-"),
  );
  let selected: string | null = directory;
  const picker = new DirectoryPicker(async () => selected);
  assert.equal(
    await picker.pick(options, new AbortController().signal),
    await fs.realpath(directory),
  );
  selected = null;
  assert.equal(await picker.pick(options, new AbortController().signal), null);
  selected = path.join(directory, "missing");
  await assert.rejects(picker.pick(options, new AbortController().signal));
  selected = directory;
  assert.equal(
    await picker.pick(options, new AbortController().signal),
    await fs.realpath(directory),
  );
});

test("only one native dialog runs; disconnect aborts it and releases the picker", async () => {
  let ready!: () => void;
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const picker = new DirectoryPicker(async (_options, signal) => {
    ready();
    return await new Promise<null>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  });
  const controller = new AbortController();
  const pending = picker.pick(options, controller.signal);
  await started;
  await assert.rejects(
    picker.pick(options, new AbortController().signal),
    /已有系统/,
  );
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(picker.pick(options, cancelled.signal), {
    name: "AbortError",
  });
});
