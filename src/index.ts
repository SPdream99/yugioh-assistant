import path from "node:path";
import { pathToFileURL } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { applyDataRoot } from "./utils/paths.js";
import { getVersion } from "./utils/version.js";
import { TOOLS } from "./tools/index.js";
import { TOOL_FIRST_INSTRUCTIONS } from "./server-instructions.js";
import { toMcpContent } from "./mcp-media.js";

export async function runMcpServer() {
  applyDataRoot();

  const server = new McpServer(
    {
      name: "yugioh-assistant-mcp",
      version: getVersion()
    },
    {
      // Advertised to the client on initialize. Without this the model sees a
      // tool catalogue with no rule telling it that memory is not a source.
      instructions: TOOL_FIRST_INSTRUCTIONS
    }
  );

  // Register all available tools
  for (const tool of TOOLS) {
    server.tool(
      tool.name,
      tool.description,
      (tool.parameters as any).shape,
      async (args: any) => {
        try {
          // A tool call is a small JSON object. Refuse oversized payloads before
          // validation so a hostile client cannot exhaust memory with a huge
          // constrained collection.
          const serializedArgs = JSON.stringify(args ?? {});
          if (serializedArgs.length > 1_000_000) {
            throw new Error("Tool arguments exceed the 1 MB limit.");
          }
          const result = await tool.handler(args);
          // Handlers that produce an artifact (deck PNG, ...) attach a descriptor under
          // `__mcpMedia`; here it becomes a real image/audio content block so the client can
          // display it instead of the model re-encoding base64 into its answer.
          const content = toMcpContent(result);
          return {
            content: [
              {
                type: "text" as const,
                text: content.text
              },
              ...content.blocks
            ]
          };
        } catch (err: any) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Tool ${tool.name} failed: ${err.message || String(err)}`
              }
            ]
          };
        }
      }
    );
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[yugioh-assistant-mcp] MCP server v${getVersion()} on stdio · ${TOOLS.length} tools · data root: ${applyDataRoot()}`
  );
}

// Auto-run only when launched directly (never when imported by the CLI's serve command).
const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try {
    return import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
  } catch {
    return false;
  }
})();

if (invokedDirectly) {
  runMcpServer().catch((error) => {
    console.error("Fatal error starting Yu-Gi-Oh! Assistant MCP Server:", error);
    process.exit(1);
  });
}
