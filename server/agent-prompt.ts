import fs from "node:fs";

// Loaded only from the application bundle, never from the user's project.
export const AGENT_SYSTEM_PROMPT = fs.readFileSync(
  new URL("./prompts/AGENTS.md", import.meta.url),
  "utf8",
);
