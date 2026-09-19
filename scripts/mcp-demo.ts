import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs/promises";
const client = new Client({
  name: "scrollweave-connection-check",
  version: "2.0.0",
});
const origin = process.env.SCROLLWEAVE_URL ?? "http://127.0.0.1:4100";
const json = (r: any) => {
  const text = r.content.find((c: any) => c.type === "text")?.text;
  if (r.isError) throw Error(text);
  return JSON.parse(text);
};
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(origin + "/mcp")),
  );
  const tools = await client.listTools(),
    info = json(
      await client.callTool({ name: "workspace_info", arguments: {} }),
    ),
    before = json(
      await client.callTool({ name: "read_project", arguments: {} }),
    );
  const changed = json(
    await client.callTool({
      name: "edit_project",
      arguments: {
        expectedRevision: before.revision,
        label: "MCP 连接验证 · 随后撤销",
        commands: [
          {
            type: "project.update",
            patch: { name: before.project.name.slice(0, 180) + " · MCP" },
          },
        ],
      },
    }),
  );
  json(
    await client.callTool({
      name: "undo",
      arguments: { expectedRevision: changed.revision },
    }),
  );
  const restored = json(
    await client.callTool({ name: "read_project", arguments: {} }),
  );
  if (restored.project.name !== before.project.name)
    throw Error("撤销未恢复名称");
  const screenshot: any = await client.callTool({
    name: "get_preview_screenshot",
    arguments: {
      compositionId: before.preview.compositionId,
      progress: before.preview.progress,
    },
  });
  if (screenshot.isError) throw Error(JSON.stringify(screenshot.content));
  await fs.mkdir(".scrollweave", { recursive: true });
  await fs.writeFile(
    ".scrollweave/mcp-demo.png",
    Buffer.from(
      screenshot.content.find((c: any) => c.type === "image").data,
      "base64",
    ),
  );
  console.log(
    JSON.stringify(
      {
        connected: true,
        tools: tools.tools.map((t) => t.name),
        workspace: info.directory,
        revision: restored.revision,
        mutationAndUndoVerified: true,
        screenshot: ".scrollweave/mcp-demo.png",
        screenshotInfo: json(screenshot),
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}
