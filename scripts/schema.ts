import fs from "node:fs";
import { z } from "zod";
import { projectSchema } from "../src/core/model";
import { commandSchema } from "../src/core/commands";
fs.mkdirSync("schema", { recursive: true });
fs.writeFileSync(
  "schema/project-v2.schema.json",
  JSON.stringify(z.toJSONSchema(projectSchema), null, 2),
);
fs.writeFileSync(
  "schema/command.schema.json",
  JSON.stringify(z.toJSONSchema(commandSchema), null, 2),
);
