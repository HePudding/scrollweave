import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT ?? 4100);
const url = `http://127.0.0.1:${port}`;
async function ready() {
  try {
    const response = await fetch(`${url}/api/state`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok && !!(await response.json()).project?.id;
  } catch {
    return false;
  }
}
if (await ready()) {
  console.log(`ScrollWeave is already running: ${url}/editor`);
} else {
  const dir = path.join(root, ".scrollweave");
  fs.mkdirSync(dir, { recursive: true });
  const log = path.join(dir, `dev-server-${Date.now()}`);
  const out = fs.openSync(`${log}.out.log`, "a"),
    err = fs.openSync(`${log}.err.log`, "a");
  const child = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "server/index.ts"],
    {
      cwd: root,
      detached: true,
      windowsHide: true,
      stdio: ["ignore", out, err],
    },
  );
  fs.closeSync(out);
  fs.closeSync(err);
  child.unref();
  fs.writeFileSync(path.join(dir, "dev-server.pid"), String(child.pid));
  let failure;
  child.on("error", (error) => {
    failure = error;
  });
  let started = false;
  for (let i = 0; i < 30 && !failure && child.exitCode === null; i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    if (await ready()) {
      started = true;
      break;
    }
  }
  if (!started)
    throw Error(
      `Server did not start. ${failure?.message ?? ""} See ${log}.err.log`,
    );
  console.log(
    `ScrollWeave started: ${url}/editor (PID ${child.pid}). Logs: ${log}`,
  );
}
