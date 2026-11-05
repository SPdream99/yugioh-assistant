import fs from "node:fs";
import path from "node:path";
import { getPackageRoot } from "../../utils/paths.js";
import { getVersion } from "../../utils/version.js";
import { renderToolsMarkdown, renderToolsReference, toolCount } from "../tooling.js";
import { log, style } from "../ui.js";

const START = "<!-- tools:start -->";
const END = "<!-- tools:end -->";

export interface DocsOptions {
  check: boolean;
}

function inject(readme: string, block: string): { text: string; changed: boolean; hasMarkers: boolean } {
  const start = readme.indexOf(START);
  const end = readme.indexOf(END);
  if (start === -1 || end === -1 || end < start) {
    return { text: readme, changed: false, hasMarkers: false };
  }
  const next = readme.slice(0, start + START.length) + "\n" + block.trim() + "\n" + readme.slice(end);
  return { text: next, changed: next !== readme, hasMarkers: true };
}

function referenceDocument(): string {
  const intro = `${toolCount()} MCP tools, generated from \`src/tools/index.ts\` by \`ygo docs\`. Do not edit by hand.`;
  return `# Tool reference\n\n${intro}\n\n> Version ${getVersion()}\n\n${renderToolsReference("en").trim()}\n`;
}

export async function runDocs(options: DocsOptions): Promise<number> {
  const root = getPackageRoot();
  const englishReadme = path.join(root, "README.md");
  const vietnameseReadme = path.join(root, "docs", "vi", "README.md");
  const englishTools = path.join(root, "docs", "TOOLS.md");

  interface Pending {
    file: string;
    next?: string;
    reason?: string;
  }

  const pending: Pending[] = [];

  {
    const next = referenceDocument();
    const current = fs.existsSync(englishTools) ? fs.readFileSync(englishTools, "utf-8") : undefined;
    pending.push(current === next ? { file: englishTools } : { file: englishTools, next });
  }

  for (const [file, language] of [
    [englishReadme, "en"],
    [vietnameseReadme, "vi"]
  ] as const) {
    if (!fs.existsSync(file)) {
      pending.push({ file, reason: "missing" });
      continue;
    }
    const current = fs.readFileSync(file, "utf-8");
    const result = inject(current, renderToolsMarkdown(language));
    if (!result.hasMarkers) pending.push({ file, reason: "markers not found" });
    else if (result.changed) pending.push({ file, next: result.text });
    else pending.push({ file });
  }

  const drift = pending.filter((item) => item.next);
  if (options.check) {
    if (drift.length === 0) {
      log.ok("Tool documentation is up to date.");
      return 0;
    }
    log.fail("Tool documentation is out of date:");
    for (const item of drift) log.muted(path.relative(root, item.file));
    log.muted("Run: ygo docs");
    return 1;
  }

  let written = 0;
  for (const item of pending) {
    if (!item.next) {
      if (item.reason === "missing") log.warn(`${path.relative(root, item.file)} does not exist yet (${item.reason})`);
      continue;
    }
    fs.mkdirSync(path.dirname(item.file), { recursive: true });
    fs.writeFileSync(item.file, item.next, "utf-8");
    written += 1;
    log.ok(`Updated ${style.muted(path.relative(root, item.file))}`);
  }

  if (written === 0) log.info("Documentation already up to date.");
  return 0;
}
