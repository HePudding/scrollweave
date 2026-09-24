import fs from "node:fs";
import path from "node:path";
import { build } from "esbuild";
const lock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const allowed = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "(Apache-2.0 OR MIT)",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "MPL-2.0",
  "MIT-0",
  "BlueOak-1.0.0",
  "CC0-1.0",
  "(MPL-2.0 OR Apache-2.0)",
  // Pi's transitive utilities; their original license texts ship in the notices.
  "Python-2.0",
  "Unlicense",
  "WTFPL OR ISC",
  "WTFPL",
  "(MIT OR CC0-1.0)",
  "(WTFPL OR MIT)",
]);
type Entry = {
  name: string;
  version: string;
  license: string;
  scope: string;
  installed: boolean;
  source: string;
  licenseFiles: string[];
};
const records: Entry[] = [];
const texts: Record<string, string> = {};
const missing: string[] = [];
for (const [directory, value] of Object.entries<any>(lock.packages)) {
  if (!directory) continue;
  if (!allowed.has(value.license))
    throw new Error(`Unreviewed license: ${directory} ${value.license}`);
  const installed = fs.existsSync(directory);
  const pkg = installed
    ? JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"))
    : {};
  const name = pkg.name ?? directory.split("node_modules/").at(-1);
  let files = installed
    ? fs
        .readdirSync(directory)
        .filter(
          (f) =>
            /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(f) &&
            fs.statSync(path.join(directory, f)).isFile(),
        )
    : [];
  let text = files
    .map(
      (f) =>
        `--- ${f} ---\n${fs.readFileSync(path.join(directory, f), "utf8")}`,
    )
    .join("\n\n");
  const upstreamFallbacks: Record<string, string> = {
    saxes: "docs/licenses/saxes-ISC.txt",
    "@cfcs/core": "docs/licenses/cfcs-MIT.txt",
    "css-styled": "docs/licenses/css-styled-MIT.txt",
    keycon: "docs/licenses/keycon-MIT.txt",
    "@esbuild/win32-x64": "node_modules/esbuild/LICENSE.md",
    "@rolldown/binding-win32-x64-msvc": "node_modules/rolldown/LICENSE",
    // These packages share the root license in their declared upstream monorepo.
    "@aws-sdk/credential-provider-http": "node_modules/@aws-sdk/core/LICENSE",
    "@aws-sdk/credential-provider-login": "node_modules/@aws-sdk/core/LICENSE",
    "@aws-sdk/nested-clients": "node_modules/@aws-sdk/core/LICENSE",
    "app-builder-lib": "node_modules/electron-builder/LICENSE",
    "dmg-builder": "node_modules/electron-builder/LICENSE",
    // Vendored upstream text includes the package version and immutable source.
    "@earendil-works/chord": "docs/licenses/pi-MIT.txt",
    "@earendil-works/pi-ai": "docs/licenses/pi-MIT.txt",
    "@earendil-works/pi-agent-core": "docs/licenses/pi-MIT.txt",
    standardwebhooks: "docs/licenses/standardwebhooks-MIT.txt",
    filelist: "docs/licenses/filelist-Apache-2.0.txt",
    "truncate-utf8-bytes": "docs/licenses/truncate-utf8-bytes-WTFPL.txt",
    // Same author/license text from the dependent package in the same monorepo commit.
    "proxy-agent-negotiate": "docs/licenses/proxy-agent-negotiate-MIT.txt",
    // Upstream never published a license file; each text is labelled as a
    // reconstructed SPDX MIT notice (electron-builder build-time only).
    "chromium-pickle-js": "docs/licenses/chromium-pickle-js-MIT.txt",
    "cross-dirname": "docs/licenses/cross-dirname-MIT.txt",
    "lazy-val": "docs/licenses/lazy-val-MIT.txt",
    "node-api-version": "docs/licenses/node-api-version-MIT.txt",
    "temp-file": "docs/licenses/temp-file-MIT.txt",
    "tmp-promise": "docs/licenses/tmp-promise-MIT.txt",
  };
  if (name.startsWith("@esbuild/"))
    upstreamFallbacks[name] = "node_modules/esbuild/LICENSE.md";
  if (name.startsWith("@rolldown/binding-"))
    upstreamFallbacks[name] = "node_modules/rolldown/LICENSE";
  if (installed && !text && upstreamFallbacks[name]) {
    text = fs.readFileSync(upstreamFallbacks[name], "utf8");
    files = [upstreamFallbacks[name]];
  }
  if (name === "react-bezier-curve-editor") {
    text = fs.readFileSync(
      "docs/licenses/react-bezier-curve-editor-MIT.txt",
      "utf8",
    );
    files = [
      "docs/licenses/react-bezier-curve-editor-MIT.txt (upstream 2.1.0)",
    ];
  }
  if (installed && !text) {
    const readme = fs.readdirSync(directory).find((f) => /^readme/i.test(f));
    const body = readme
      ? fs.readFileSync(path.join(directory, readme), "utf8")
      : "";
    // Recognize Markdown setext headings too; data-uri-to-buffer includes the
    // complete MIT permission/copyright text under its underlined License title.
    const match = body.match(
      /(?:^|\n)(?:#+\s*(?:License|Copyright)|(?:License|Copyright)\r?\n[-=]+)[\s\S]*$/i,
    );
    if (match) {
      text = match[0];
      files.push(`${readme}#license`);
    } else missing.push(name);
  }
  const repository =
    typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url;
  records.push({
    name,
    version: value.version,
    license:
      name === "react-bezier-curve-editor"
        ? "MIT (upstream); ISC (npm metadata)"
        : value.license,
    scope: value.dev ? "development" : "runtime/editor/server",
    installed,
    source:
      repository ?? `https://www.npmjs.com/package/${name}/v/${value.version}`,
    licenseFiles: files,
  });
  // Normalize formatting only; preserve the complete upstream license wording.
  text = text.replace(/\r\n/g, "\n").replace(/[\t ]+$/gm, "");
  if (text)
    texts[directory] =
      `${name}@${value.version}\nSource: ${repository ?? records.at(-1)!.source}\n${text}`;
}
fs.mkdirSync("docs", { recursive: true });
fs.writeFileSync(
  "docs/dependency-licenses.json",
  JSON.stringify(
    {
      generatedFrom: "package-lock.json",
      packages: records,
      missingText: missing,
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  "THIRD_PARTY_LICENSES.txt",
  Object.values(texts).join(
    "\n\n============================================================\n\n",
  ),
);
const result = await build({
  entryPoints: ["src/runtime/entry.ts"],
  bundle: true,
  write: false,
  metafile: true,
  format: "iife",
  minify: true,
  platform: "browser",
});
const runtimePackages = new Set(
  Object.keys(result.metafile!.inputs)
    .filter((f) => f.includes("node_modules/"))
    .map((f) => {
      const index = f.lastIndexOf("node_modules/");
      const parts = f.slice(index + 13).split("/");
      return (
        f.slice(0, index + 13) +
        (parts[0].startsWith("@") ? parts.slice(0, 2).join("/") : parts[0])
      );
    }),
);
const runtimeText = [...runtimePackages].map((p) => {
  if (!texts[p]) throw new Error(`Missing runtime notice ${p}`);
  return texts[p];
});
fs.writeFileSync(
  "THIRD_PARTY_RUNTIME.txt",
  [fs.readFileSync("LICENSE", "utf8"), ...runtimeText].join(
    "\n\n============================================================\n\n",
  ),
);
console.log(
  JSON.stringify(
    {
      lockEntries: records.length,
      installed: records.filter((r) => r.installed).length,
      runtimePackages: [...runtimePackages],
      missingLicenseText: missing,
    },
    null,
    2,
  ),
);
if (missing.length) process.exitCode = 1;
