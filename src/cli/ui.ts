/**
 * Terminal presentation layer for the `ygo` CLI.
 *
 * Design constraints:
 *  - Zero runtime dependencies (the CLI must boot in < 100 ms).
 *  - Colour is opt-out (NO_COLOR, --no-color, non-TTY) and never required for meaning.
 *  - Every helper degrades to plain ASCII when the terminal cannot render glyphs.
 */

const isTTY = Boolean(process.stdout.isTTY);
const envNoColor = Boolean(process.env.NO_COLOR) || process.env.TERM === "dumb";
const flagNoColor = process.argv.includes("--no-color");

export const colorEnabled = isTTY && !envNoColor && !flagNoColor;

const ansi = (open: string, close: string) => (input: string): string =>
  colorEnabled ? `\u001b[${open}m${input}\u001b[${close}m` : input;

export const style = {
  bold: ansi("1", "22"),
  dim: ansi("2", "22"),
  italic: ansi("3", "23"),
  underline: ansi("4", "24"),
  /* Brand accent: a muted violet that stays legible on light and dark terminals. */
  accent: ansi("38;2;167;139;250", "39"),
  info: ansi("38;2;125;211;252", "39"),
  ok: ansi("38;2;110;231;183", "39"),
  warn: ansi("38;2;253;224;71", "39"),
  err: ansi("38;2;248;113;113", "39"),
  muted: ansi("38;2;148;163;184", "39"),
  text: ansi("38;2;226;232;240", "39")
};

const ESCAPE = /\u001b\[[0-9;]*m/g;

export function stripAnsi(input: string): string {
  return input.replace(ESCAPE, "");
}

/** Display width, accounting for the wide glyphs used in a few tool names. */
export function displayWidth(input: string): number {
  let width = 0;
  for (const char of stripAnsi(input)) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0x200d || (code >= 0x0300 && code <= 0x036f)) continue;
    width += isWide(code) ? 2 : 1;
  }
  return width;
}

function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0x1f300 && code <= 0x1faff)
  );
}

export const glyph = {
  ok: "✓",
  fail: "✗",
  warn: "!",
  dot: "·",
  arrow: "→",
  bullet: "•",
  bar: "▌",
  bulletEmpty: "○",
  bulletFilled: "●"
};

function terminalWidth(): number {
  const columns = process.stdout.columns ?? 100;
  return Math.max(48, Math.min(columns, 100));
}

export function hr(char = "─"): string {
  return style.muted(char.repeat(terminalWidth()));
}

export function heading(title: string, subtitle?: string): void {
  process.stdout.write(`\n${style.accent(glyph.bar)} ${style.bold(title)}\n`);
  if (subtitle) process.stdout.write(`  ${style.muted(subtitle)}\n`);
}

export function label(text: string): string {
  return style.muted(text.toUpperCase());
}

export interface TableOptions {
  align?: ("left" | "right")[];
  indent?: number;
  header?: boolean;
}

/** Borderless, whitespace-aligned table: readable in every terminal and in pipes. */
export function renderTable(
  headers: string[],
  rows: string[][],
  options: TableOptions = {}
): string {
  const indent = " ".repeat(options.indent ?? 2);
  const align = options.align ?? [];
  const widths = headers.map((header, column) =>
    Math.max(displayWidth(header), ...rows.map((row) => displayWidth(row[column] ?? "")))
  );

  const pad = (value: string, column: number): string => {
    const filler = " ".repeat(Math.max(0, widths[column] - displayWidth(value)));
    return align[column] === "right" ? filler + value : value + filler;
  };

  const lines: string[] = [];
  if (options.header !== false) {
    lines.push(indent + headers.map((header, i) => pad(style.muted(header), i)).join("  "));
    lines.push(indent + style.muted(widths.map((width) => "─".repeat(width)).join("  ")));
  }
  for (const row of rows) {
    lines.push(indent + row.map((cell, i) => pad(cell ?? "", i)).join("  ").trimEnd());
  }
  return lines.join("\n");
}

export function printTable(headers: string[], rows: string[][], options?: TableOptions): void {
  process.stdout.write(renderTable(headers, rows, options) + "\n");
}

export const log = {
  ok(message: string): void {
    process.stdout.write(`${style.ok(glyph.ok)} ${message}\n`);
  },
  fail(message: string): void {
    process.stderr.write(`${style.err(glyph.fail)} ${message}\n`);
  },
  warn(message: string): void {
    process.stderr.write(`${style.warn(glyph.warn)} ${message}\n`);
  },
  info(message: string): void {
    process.stdout.write(`${style.info(glyph.dot)} ${message}\n`);
  },
  muted(message: string): void {
    process.stdout.write(`  ${style.muted(message)}\n`);
  },
  step(message: string): void {
    process.stdout.write(`  ${style.muted(glyph.arrow)} ${message}\n`);
  },
  blank(): void {
    process.stdout.write("\n");
  }
};

export function banner(version: string, tagline: string): void {
  process.stdout.write(
    `\n  ${style.accent(style.bold("YU-GI-OH! ASSISTANT"))} ${style.muted(`v${version}`)}\n` +
      `  ${style.muted(tagline)}\n`
  );
}

export function code(value: string): string {
  return style.info(value);
}

export function emphasis(value: string): string {
  return style.bold(value);
}
