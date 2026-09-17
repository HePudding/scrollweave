import fs from "node:fs";
import { exampleProject } from "../src/core/example";
import { exportHTML } from "../server/export";
fs.mkdirSync("examples", { recursive: true });
const project = exampleProject();
fs.writeFileSync(
  "examples/form.scrollweave.json",
  JSON.stringify(project, null, 2),
);
fs.writeFileSync("examples/form.html", await exportHTML(project));
console.log("examples/form.scrollweave.json");
