import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import fs from "node:fs";
const client = new Client({
  name: "scrollweave-example-agent",
  version: "1.0",
});
const url = process.env.SCROLLWEAVE_URL ?? "http://127.0.0.1:4100";
const json = (response: any) => {
  const value = JSON.parse(
    response.content.find((c: any) => c.type === "text").text,
  );
  if (response.isError) throw new Error(JSON.stringify(value));
  return value;
};
try {
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${url}/mcp`)),
  );
  const before = json(
    await client.callTool({ name: "read_project", arguments: {} }),
  );
  console.log(`Connected to ${before.project.name}, r${before.revision}`);
  const changed = json(
    await client.callTool({
      name: "edit_project",
      arguments: {
        expectedRevision: before.revision,
        label: "MCP 示例事务",
        commands: [
          {
            type: "project.update",
            patch: { name: `${before.project.name} · Agent` },
          },
        ],
      },
    }),
  );
  const restored = json(
    await client.callTool({
      name: "undo",
      arguments: { expectedRevision: changed.revision },
    }),
  );
  console.log(`Restored ${restored.project.name}, r${restored.revision}`);
  const screenshot: any = await client.callTool({
    name: "get_preview_screenshot",
    arguments: { progress: 0.65 },
  });
  if (screenshot.isError) throw new Error(JSON.stringify(screenshot));
  fs.mkdirSync(".scrollweave", { recursive: true });
  fs.writeFileSync(
    ".scrollweave/mcp-demo.png",
    Buffer.from(
      screenshot.content.find((c: any) => c.type === "image").data,
      "base64",
    ),
  );
  console.log(".scrollweave/mcp-demo.png");
} finally {
  await client.close();
}
