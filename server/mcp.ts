import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  schemas,
  descriptions,
  type EditorService,
  type ToolName,
} from "./service";
import { ConflictError } from "../src/core/commands";
export function createMcpServer(service: Pick<EditorService, "run">) {
  const server = new McpServer({ name: "scrollweave", version: "0.1.0" });
  for (const name of Object.keys(schemas) as ToolName[]) {
    server.registerTool(
      name,
      {
        description: descriptions[name],
        inputSchema: schemas[name].shape as any,
      },
      async (args: any) => {
        try {
          const result = await service.run(name, args);
          if (name === "get_preview_screenshot") {
            const { data, mimeType, ...info } = result;
            return {
              content: [
                { type: "image" as const, data, mimeType },
                { type: "text" as const, text: JSON.stringify(info) },
              ],
            };
          }
          return {
            content: [{ type: "text" as const, text: JSON.stringify(result) }],
          };
        } catch (error) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: (error as Error).message,
                  ...(error instanceof ConflictError
                    ? {
                        code: "REVISION_CONFLICT",
                        actualRevision: error.actualRevision,
                      }
                    : {}),
                }),
              },
            ],
          };
        }
      },
    );
  }
  return server;
}
