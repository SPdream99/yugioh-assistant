/**
 * MCP media (inline artifacts) plumbing.
 *
 * MCP tool results can carry `image` / `audio` content blocks next to text. Clients such as
 * OpenCode and Claude Desktop render those inline and keep the bytes out of the model's text
 * context, which is exactly what a rendered decklist needs: the user sees the picture, not a
 * base64 blob.
 *
 * A tool cannot return raw content blocks directly because the CLI prints the same handler
 * result as JSON. So a handler attaches a small descriptor under `__mcpMedia`, and the MCP
 * wrapper (`src/index.ts`) turns that descriptor into a real content block at the edge. The
 * CLI strips the descriptor.
 */
import fs from "node:fs";
import path from "node:path";

export const MCP_MEDIA_KEY = "__mcpMedia";

/** Inline at most this many bytes; bigger artifacts are referenced by path instead. */
export const MAX_INLINE_BYTES = 8 * 1024 * 1024;

export interface McpMediaDescriptor {
  type: "image" | "audio";
  /** Absolute (or cwd-relative) path to the artifact on the machine running the server. */
  path: string;
  mimeType: string;
}

export interface McpContentBlock {
  type: "image" | "audio";
  data: string;
  mimeType: string;
}

export interface McpContent {
  /** JSON (or raw string) the model reads. The media descriptor is never part of it. */
  text: string;
  /** Ready-to-send MCP content blocks. */
  blocks: McpContentBlock[];
}

/**
 * Attach artifacts to a tool result. The returned object still serializes as JSON, minus the
 * binary payload: only paths and MIME types travel here.
 */
export function attachMedia<T extends object>(result: T, media: McpMediaDescriptor[]): T {
  return { ...result, [MCP_MEDIA_KEY]: media } as T;
}

/** Clone a handler result without the media descriptor (used by the CLI). */
export function stripMedia<T>(result: T): T {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const { [MCP_MEDIA_KEY]: _media, ...rest } = result as Record<string, unknown>;
  return rest as T;
}

function readMediaBlock(descriptor: McpMediaDescriptor, notes: string[]): McpContentBlock | undefined {
  const filePath = path.resolve(descriptor.path);
  if (!fs.existsSync(filePath)) {
    notes.push(`[artifact missing: ${filePath}]`);
    return undefined;
  }
  const size = fs.statSync(filePath).size;
  if (size > MAX_INLINE_BYTES) {
    const mb = (size / (1024 * 1024)).toFixed(1);
    notes.push(`[artifact is ${mb} MB, too large to inline: ${filePath} — open this path directly]`);
    return undefined;
  }
  return {
    type: descriptor.type,
    mimeType: descriptor.mimeType,
    data: fs.readFileSync(filePath).toString("base64")
  };
}

/**
 * Turn a handler result into MCP content: one text block plus one block per attached artifact.
 * Handlers that attach nothing behave exactly as before.
 */
export function toMcpContent(result: unknown): McpContent {
  if (typeof result === "string") return { text: result, blocks: [] };
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return { text: JSON.stringify(result, null, 2), blocks: [] };
  }

  const raw = result as Record<string, unknown>;
  const descriptors = Array.isArray(raw[MCP_MEDIA_KEY]) ? (raw[MCP_MEDIA_KEY] as McpMediaDescriptor[]) : [];
  const notes: string[] = [];
  const blocks: McpContentBlock[] = [];
  for (const descriptor of descriptors) {
    if (!descriptor || typeof descriptor.path !== "string") continue;
    const block = readMediaBlock(descriptor, notes);
    if (block) blocks.push(block);
  }

  const json = JSON.stringify(stripMedia(result), null, 2);
  const text = notes.length > 0 ? `${json}\n\n${notes.join("\n")}` : json;
  return { text, blocks };
}
