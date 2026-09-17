import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./mcp";
const origin = process.env.SCROLLWEAVE_URL ?? "http://127.0.0.1:4100";
const url = new URL(origin);
if (!["localhost", "127.0.0.1"].includes(url.hostname))
  throw new Error("stdio 桥接仅支持本机服务");
const server = createMcpServer({
  async run(name, args) {
    const response = await fetch(`${origin}/api/action`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, args }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(data));
    return data;
  },
});
await server.connect(new StdioServerTransport());
