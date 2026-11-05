/**
 * Minimal, dependency-free JSONC (JSON with comments) tooling.
 *
 * The CLI edits configuration files that belong to the user — Claude Desktop,
 * VS Code, OpenCode, Zed — and those files routinely carry comments and
 * hand-tuned formatting. Re-serialising the whole document would destroy that
 * work, so every write here is surgical: we locate the exact byte range of the
 * key we care about and touch nothing else.
 */

export interface Entry {
  key: string;
  keyStart: number;
  valueStart: number;
  valueEnd: number;
}

export type Node =
  | { kind: "object"; start: number; end: number; entries: Entry[] }
  | { kind: "array"; start: number; end: number; items: Node[] }
  | { kind: "scalar"; start: number; end: number; raw: string };

export class JsoncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsoncError";
  }
}

function skipTrivia(text: string, index: number): number {
  let i = index;
  while (i < text.length) {
    const char = text[i];
    if (char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\uFEFF") {
      i += 1;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      if (close === -1) throw new JsoncError("Unterminated block comment");
      i = close + 2;
      continue;
    }
    break;
  }
  return i;
}

function parseString(text: string, index: number): { value: string; end: number } {
  if (text[index] !== '"') throw new JsoncError(`Expected a string at offset ${index}`);
  let i = index + 1;
  let value = "";
  while (i < text.length) {
    const char = text[i];
    if (char === "\\") {
      const escape = text[i + 1];
      const table: Record<string, string> = {
        '"': '"',
        "\\": "\\",
        "/": "/",
        b: "\b",
        f: "\f",
        n: "\n",
        r: "\r",
        t: "\t"
      };
      if (escape === "u") {
        value += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
        i += 6;
        continue;
      }
      value += table[escape] ?? escape;
      i += 2;
      continue;
    }
    if (char === '"') return { value, end: i + 1 };
    value += char;
    i += 1;
  }
  throw new JsoncError("Unterminated string");
}

function parseValue(text: string, index: number): Node {
  const start = skipTrivia(text, index);
  const char = text[start];

  if (char === "{") {
    const entries: Entry[] = [];
    let i = skipTrivia(text, start + 1);
    while (i < text.length && text[i] !== "}") {
      const key = parseString(text, i);
      const keyStart = i;
      i = skipTrivia(text, key.end);
      if (text[i] !== ":") throw new JsoncError(`Expected ':' at offset ${i}`);
      const value = parseValue(text, i + 1);
      entries.push({ key: key.value, keyStart, valueStart: value.start, valueEnd: value.end });
      i = skipTrivia(text, value.end);
      if (text[i] === ",") i = skipTrivia(text, i + 1);
    }
    if (text[i] !== "}") throw new JsoncError(`Unterminated object at offset ${start}`);
    return { kind: "object", start, end: i + 1, entries };
  }

  if (char === "[") {
    const items: Node[] = [];
    let i = skipTrivia(text, start + 1);
    while (i < text.length && text[i] !== "]") {
      const item = parseValue(text, i);
      items.push(item);
      i = skipTrivia(text, item.end);
      if (text[i] === ",") i = skipTrivia(text, i + 1);
    }
    if (text[i] !== "]") throw new JsoncError(`Unterminated array at offset ${start}`);
    return { kind: "array", start, end: i + 1, items };
  }

  if (char === '"') {
    const parsed = parseString(text, start);
    return { kind: "scalar", start, end: parsed.end, raw: JSON.stringify(parsed.value) };
  }

  let i = start;
  while (i < text.length && !",}] \t\r\n".includes(text[i])) i += 1;
  if (i === start) throw new JsoncError(`Unexpected token at offset ${start}`);
  return { kind: "scalar", start, end: i, raw: text.slice(start, i) };
}

/** Parses a JSONC document and returns its structural tree (comments preserved). */
export function parseJsoncTree(text: string): Node {
  return parseValue(text, 0);
}

/** Parses a JSONC document into a plain JavaScript value. */
export function parseJsonc<T = unknown>(text: string): T {
  return JSON.parse(stripComments(text));
}

function stripComments(text: string): string {
  let output = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      let j = i + 1;
      output += char;
      while (j < text.length) {
        output += text[j];
        if (text[j] === "\\") {
          output += text[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (text[j] === '"') {
          j += 1;
          break;
        }
        j += 1;
      }
      i = j;
      continue;
    }
    if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i += 1;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      i = close === -1 ? text.length : close + 2;
      continue;
    }
    if (char === ",") {
      const next = skipTrivia(text, i + 1);
      if (text[next] === "}" || text[next] === "]") {
        i += 1;
        continue;
      }
    }
    output += char;
    i += 1;
  }
  return output;
}

function lineIndent(text: string, index: number): string {
  let start = index;
  while (start > 0 && text[start - 1] !== "\n") start -= 1;
  const match = /^[ \t]*/.exec(text.slice(start, index));
  return match ? match[0] : "";
}

/** Locates a path inside the document and returns the value node, if present. */
export function locate(text: string, path: string[]): Node | undefined {
  let current: Node = parseJsoncTree(text);
  for (const segment of path) {
    if (current.kind !== "object") return undefined;
    const entry = current.entries.find((candidate) => candidate.key === segment);
    if (!entry) return undefined;
    current = parseValue(text, entry.valueStart);
  }
  return current;
}

function removeRange(text: string, start: number, end: number): string {
  return text.slice(0, start) + text.slice(end);
}

function deleteEntry(text: string, entry: Entry): string {
  let start = entry.keyStart;
  while (start > 0 && text[start - 1] !== "\n") start -= 1;
  let end = entry.valueEnd;
  let cursor = end;
  while (cursor < text.length && (text[cursor] === " " || text[cursor] === "\t")) cursor += 1;
  if (text[cursor] === ",") {
    end = cursor + 1;
  } else {
    let back = start - 1;
    while (back >= 0 && /\s/.test(text[back])) back -= 1;
    if (text[back] === ",") start = back;
  }
  return removeRange(text, start, end);
}

const INLINE_ARRAY_LIMIT = 80;

function isScalar(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/**
 * Serialises a value using the indentation of the line it will land on.
 * Arrays of scalars stay inline (matching how humans write these files);
 * objects expand one key per line.
 */
function serialize(value: unknown, indent: string): string {
  if (isScalar(value)) return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) {
    if (value.every(isScalar)) {
      const inline = `[${value.map((item) => JSON.stringify(item)).join(", ")}]`;
      if (inline.length <= INLINE_ARRAY_LIMIT) return inline;
      return `[\n${value.map((item) => `${indent}  ${JSON.stringify(item)}`).join(",\n")}\n${indent}]`;
    }
    return `[\n${value.map((item) => `${indent}  ${serialize(item, `${indent}  `)}`).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  return `{\n${entries
    .map(([key, item]) => `${indent}  ${JSON.stringify(key)}: ${serialize(item, `${indent}  `)}`)
    .join(",\n")}\n${indent}}`;
}

function insertEntry(
  text: string,
  container: Extract<Node, { kind: "object" }>,
  key: string,
  value: unknown
): string {
  const keyIndent =
    container.entries.length > 0
      ? lineIndent(text, container.entries[0].keyStart)
      : `${lineIndent(text, container.start)}  `;
  const serialized = serialize(value, keyIndent);
  const payload = `${JSON.stringify(key)}: ${serialized}`;

  if (container.entries.length === 0) {
    const close = container.end - 1;
    const insertion = `\n${keyIndent}${payload}\n${lineIndent(text, container.start)}`;
    return text.slice(0, close) + insertion + text.slice(close);
  }

  const last = container.entries[container.entries.length - 1];
  const afterValue = skipTrivia(text, last.valueEnd);
  if (text[afterValue] === ",") {
    return (
      text.slice(0, afterValue + 1) +
      `\n${keyIndent}${payload}` +
      text.slice(afterValue + 1)
    );
  }
  return text.slice(0, last.valueEnd) + `,\n${keyIndent}${payload}` + text.slice(last.valueEnd);
}

/**
 * Sets `path[0].path[1]…[key] = value`, creating intermediate objects as needed.
 * Returns the original string when the value is already identical.
 */
export function upsertJsonKey(text: string, path: string[], key: string, value: unknown): string {
  let document = text;

  for (let depth = 0; depth < path.length; depth += 1) {
    const currentPath = path.slice(0, depth);
    const container = currentPath.length === 0 ? parseJsoncTree(document) : locate(document, currentPath);
    if (!container || container.kind !== "object") {
      throw new JsoncError(`Expected an object at '${currentPath.join(".") || "<root>"}'`);
    }
    const existing = container.entries.find((entry) => entry.key === path[depth]);
    if (!existing) {
      document = insertEntry(document, container, path[depth], {});
      continue;
    }
    const child = parseValue(document, existing.valueStart);
    if (child.kind !== "object") {
      throw new JsoncError(`Expected an object at '${currentPath.concat(path[depth]).join(".")}'`);
    }
  }

  const containerPath = path;
  const root = parseJsoncTree(document);
  const containerNode =
    containerPath.length === 0 ? root : locate(document, containerPath);
  if (!containerNode || containerNode.kind !== "object") {
    throw new JsoncError(`Expected an object at '${containerPath.join(".") || "<root>"}'`);
  }

  const existing = containerNode.entries.find((entry) => entry.key === key);
  if (existing) {
    const currentValue = parseValue(document, existing.valueStart);
    const nextValue = serialize(value, lineIndent(document, existing.keyStart));
    if (document.slice(currentValue.start, currentValue.end) === nextValue) return document;
    return (
      document.slice(0, currentValue.start) + nextValue + document.slice(currentValue.end)
    );
  }

  return insertEntry(document, containerNode, key, value);
}

/** Removes `path…key` from the document. Returns `{ text, removed }`. */
export function removeJsonKey(text: string, path: string[], key: string): { text: string; removed: boolean } {
  const containerNode = path.length === 0 ? parseJsoncTree(text) : locate(text, path);
  if (!containerNode || containerNode.kind !== "object") return { text, removed: false };
  const entry = containerNode.entries.find((candidate) => candidate.key === key);
  if (!entry) return { text, removed: false };
  return { text: deleteEntry(text, entry), removed: true };
}

/** Reads `path … key` from the document, or `undefined`. */
export function readJsonKey<T = unknown>(text: string, path: string[], key: string): T | undefined {
  const containerNode = path.length === 0 ? parseJsoncTree(text) : locate(text, path);
  if (!containerNode || containerNode.kind !== "object") return undefined;
  const entry = containerNode.entries.find((candidate) => candidate.key === key);
  if (!entry) return undefined;
  const node = parseValue(text, entry.valueStart);
  if (node.kind === "scalar") return JSON.parse(node.raw);
  return JSON.parse(stripComments(text.slice(node.start, node.end)));
}
