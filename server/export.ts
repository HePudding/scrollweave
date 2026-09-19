import fs from "node:fs";
import path from "node:path";
import { validateProject, type Project } from "../src/core/model";
import { runtimeCSS } from "../src/runtime/render";
import { registerExporter } from "../src/extensions/registry";
let runtime: Promise<string> | undefined;
export function runtimeBundle() {
  runtime ??= (async () => {
    const built = path.resolve("dist/runtime.js");
    if (process.env.NODE_ENV === "production" && fs.existsSync(built))
      return fs.readFileSync(built, "utf8");
    const { build } = await import("esbuild");
    const result = await build({
      entryPoints: ["src/runtime/entry.ts"],
      bundle: true,
      write: false,
      minify: true,
      format: "iife",
      platform: "browser",
      target: "es2022",
      legalComments: "inline",
    });
    return result.outputFiles[0].text;
  })();
  return runtime;
}
export async function exportHTML(input: Project) {
  const p = validateProject(input);
  const js = await runtimeBundle();
  const title = p.name.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!,
  );
  const data = JSON.stringify(p)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const notices = fs.existsSync("THIRD_PARTY_RUNTIME.txt")
    ? fs.readFileSync("THIRD_PARTY_RUNTIME.txt", "utf8")
    : "ScrollWeave MIT. Motion / motion-dom / motion-utils MIT. See project THIRD_PARTY_NOTICES.md.";
  return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="ScrollWeave 0.2.0"><title>${title}</title><style>${runtimeCSS}</style></head><body><main id="sw-root" aria-label="${title}"></main><script id="sw-project" type="application/json">${data}</script><script>${js.replace(/<\/script/gi, "<\\/script")}</script><!--\n${notices.replace(/-->/g, "-- >")}\n--></body></html>`;
}
registerExporter({
  id: "html",
  name: "独立 HTML",
  extension: "html",
  export: exportHTML,
});
