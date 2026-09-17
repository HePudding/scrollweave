import { build as viteBuild } from "vite";
import { build } from "esbuild";
await viteBuild();
await build({
  entryPoints: ["src/runtime/entry.ts"],
  outfile: "dist/runtime.js",
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "es2022",
  legalComments: "inline",
});
await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
  define: { "process.env.NODE_ENV": '"production"' },
});
await build({
  entryPoints: ["server/stdio.ts"],
  outfile: "dist/stdio.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  target: "node22",
});
console.log("Built editor, shared runtime, local server and MCP stdio bridge.");
