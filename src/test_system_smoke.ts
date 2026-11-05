/**
 * Whole-system smoke test.
 *
 * Exercises every registered tool once with safe arguments, checks the MCP
 * stdio handshake, validates every JSON data file and the custom-card registry,
 * and reports anything that throws or returns an unexpected shape.
 *
 * Run with: npm run test:smoke
 */

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { TOOLS } from "./tools/index.js";
import { listCustomCards } from "./core/custom-cards/registry.js";

interface Result {
  name: string;
  status: "pass" | "fail" | "expected-error" | "skip";
  ms: number;
  detail?: string;
}

const results: Result[] = [];
const startedAt = Date.now();

function record(name: string, status: Result["status"], ms: number, detail?: string) {
  results.push({ name, status, ms, detail });
  const icon = status === "pass" ? "✓" : status === "fail" ? "✗" : status === "expected-error" ? "!" : "-";
  console.log(`  ${icon} ${name} ${status === "fail" ? `— ${detail}` : ""} (${ms} ms)`);
}

// ---------------------------------------------------------------------------
// 1. MCP stdio handshake
// ---------------------------------------------------------------------------

async function mcpHandshake(): Promise<{ ok: boolean; toolCount: number; instructions?: string; error?: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["dist/index.js"], { stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "";
    let toolCount = 0;
    let instructions = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        resolve({ ok: false, toolCount, error: "timeout waiting for tools/list" });
      }
    }, 30_000);

    const send = (payload: unknown) => child.stdin.write(`${JSON.stringify(payload)}\n`);

    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === 1) {
            instructions = msg.result?.instructions ?? "";
            send({ jsonrpc: "2.0", method: "notifications/initialized" });
            send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
          }
          if (msg.id === 2) {
            toolCount = msg.result?.tools?.length ?? 0;
          }
          if (msg.id === 3) {
            settled = true;
            clearTimeout(timer);
            child.kill();
            resolve({
              ok: toolCount === TOOLS.length && toolCount > 0,
              toolCount,
              instructions,
              error: toolCount !== TOOLS.length ? `server exposes ${toolCount}, registry has ${TOOLS.length}` : undefined
            });
          }
        } catch {
          // Non-JSON output is ignored.
        }
      }
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, toolCount: 0, error: error.message });
    });

    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "system-smoke", version: "1.0.0" }
      }
    });

    // Ask for a real tool call once the list arrives.
    const callTimer = setInterval(() => {
      if (toolCount > 0 && !settled) {
        clearInterval(callTimer);
        send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "ygo_get_rulebook", arguments: { topic: "status" } } });
      }
    }, 200);
  });
}

// ---------------------------------------------------------------------------
// 2. Every tool, safe arguments
// ---------------------------------------------------------------------------

const YDKE = "ydke://zM3LAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUBjhKFAY4ShQGOEoUB!!";

const CALLS: Record<string, any> = {
  ygo_parse_deck: { ydkContent: "#main\n14558127\n14558127\n#extra\n!side\n" },
  ygo_export_deck: { deck: { main: [14558127], extra: [], side: [] }, format: "ydk" },
  ygo_get_card: { id: 14558127 },
  ygo_card_dossier: { passcode: 14558127 },
  ygo_search_cards: { name: "Ash Blossom", limit: 3 },
  ygo_find_synergy_and_combos: { filter: { race: "Spellcaster", atk: 1850 }, deck: { main: [], extra: [], side: [] } },
  ygo_judge_card: { cardName: "Ash Blossom & Joyous Spring" },
  ygo_analyze_lua: { passcode: 14558127, deep: true },
  ygo_script_insights: { mode: "card", passcode: 14558127 },
  ygo_judge_interaction: { cardA: "Ash Blossom & Joyous Spring", cardB: "Called by the Grave", question: "Can Called by the Grave negate Ash Blossom?" },
  ygo_get_rulebook: { topic: "status" },
  ygo_get_policy: { topic: "status" },
  ygo_wiki: { topic: "card", input: "Dark Magician" },
  ygo_judge_scenario: { preset: "negate-unprotected" },
  ygo_ensure_script: { topic: "inventory" },
  ygo_verify_ruling: { claim: "Called by the Grave negates Ash Blossom" },
  ygo_check_locks: { passcodes: [44362883, 14558127], maxCards: 4 },
  ygo_golden_suite: {},
  ygo_consistency_lab: { main: [55144522, 55144522, 14558127, 14558127, 24224830, 44362883], trials: 2 },
  ygo_matchup_planner: { format: "TCG" },
  ygo_deck_cost: { cards: [{ name: "Ash Blossom & Joyous Spring", copies: 1 }], maxCards: 1 },
  ygo_simulate_duel_scenario: { scenario: "Player A activates Pot of Greed, Player B chains Ash Blossom." },
  ygo_run_duel: { deckA: [55144522, 55144522, 55144522], deckB: [55144522, 55144522, 55144522], maxSteps: 8 },
  ygo_build_meta_deck: { archetype: "Branded Despia", format: "TCG" },
  ygo_optimize_deck: { deck: { main: [14558127], extra: [], side: [] }, format: "TCG" },
  ygo_create_custom_card: { name: "Smoke Test Card", cardData: { type: "Effect Monster", desc: "Draw 1 card." } },
  ygo_migrate_temp_card: { tempId: 1, officialId: 2 },
  ygo_check_prices: { cardName: "Ash Blossom & Joyous Spring" },
  ygo_get_news: { limit: 3 },
  ygo_sync_meta: {},
  ygo_generate_batch_art_prompt: { cards: [{ id: 991000001, name: "Smoke Warrior", desc: "A warrior in blue armor", attribute: "DARK" }] },
  ygo_slice_batch_art: { imagePath: "does-not-exist.png" },
  ygo_generate_tournament_decklist_pdf: { input: YDKE, duelistName: "Smoke Tester", cardGameId: "1234567890", eventName: "Smoke Event", eventDate: "2026-11-05", format: "TCG" },
  ygo_render_deck_image: { input: YDKE, title: "Smoke Deck" },
  ygo_get_monthly_meta: { month: 11, year: 2026, format: "TCG" },
  ygo_compare_monthly_meta: { monthA: "2026-10", monthB: "2026-11", format: "TCG" },
  ygo_get_daily_meta: { date: "2026-11-05", format: "TCG" },
  ygo_get_card_price_trends: { cardNameOrId: "Ash Blossom & Joyous Spring" },
  ygo_get_trending_cards: { limit: 5 },
  ygo_create_archetype_docx: {},
  ygo_read_and_validate_docx: { docxPath: "does-not-exist.docx" },
  ygo_export_database_and_scripts: { docxPath: "does-not-exist.docx" },
  ygo_generate_art_prompts: { docxPath: "does-not-exist.docx" },
  ygo_slice_art_grid: { imagePath: "does-not-exist.png" },
  ygo_build_full_pipeline: { docxPath: "does-not-exist.docx" }
};

// Tools whose failure is the correct behaviour (missing input files, invalid IDs).
const EXPECT_ERROR = new Set([
  "ygo_migrate_temp_card",
  "ygo_slice_batch_art",
  "ygo_read_and_validate_docx",
  "ygo_export_database_and_scripts",
  "ygo_generate_art_prompts",
  "ygo_slice_art_grid",
  "ygo_build_full_pipeline",
  "ygo_create_archetype_docx"
]);

async function callTools(): Promise<void> {
  for (const tool of TOOLS as any[]) {
    const args = CALLS[tool.name];
    if (!args) {
      record(tool.name, "skip", 0, "no smoke arguments defined");
      continue;
    }
    const started = Date.now();
    try {
      const result = await tool.handler(args);
      const ms = Date.now() - started;
      const failedShape =
        result === undefined ||
        (result && result.available === false && !EXPECT_ERROR.has(tool.name)) ||
        (result && result.parsed === false && !EXPECT_ERROR.has(tool.name) && tool.name !== "ygo_analyze_lua");

      if (failedShape) {
        record(tool.name, EXPECT_ERROR.has(tool.name) ? "expected-error" : "fail", ms, JSON.stringify(result).slice(0, 160));
      } else {
        record(tool.name, "pass", ms);
      }

      // The deck PNG is useless to the user unless the MCP edge can turn it into an image
      // block; a descriptor pointing at a missing file would fail silently otherwise.
      if (tool.name === "ygo_render_deck_image" && !failedShape) {
        const media = (result as any)?.__mcpMedia;
        const ok = Array.isArray(media) && media.length > 0 && fs.existsSync(media[0].path);
        record("ygo_render_deck_image: media descriptor", ok ? "pass" : "fail", 0, ok ? media[0].path : "no __mcpMedia");
      }
    } catch (error) {
      record(tool.name, EXPECT_ERROR.has(tool.name) ? "expected-error" : "fail", Date.now() - started, (error as Error).message);
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Data integrity
// ---------------------------------------------------------------------------

function checkData(): void {
  const started = Date.now();
  const dataDir = path.join(process.cwd(), "data");
  const problems: string[] = [];
  let files = 0;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (full.includes("node_modules")) continue;
        walk(full);
      } else if (entry.name.endsWith(".json")) {
        files += 1;
        try {
          const raw = fs.readFileSync(full, "utf-8");
          JSON.parse(raw);
          if (raw.trim().length === 0) problems.push(`${path.relative(dataDir, full)} is empty`);
        } catch (error) {
          problems.push(`${path.relative(dataDir, full)}: ${(error as Error).message}`);
        }
      }
    }
  };

  walk(dataDir);
  record("data JSON integrity", problems.length === 0 ? "pass" : "fail", Date.now() - started, problems.slice(0, 5).join(" | ") || `${files} files parsed`);

  const started2 = Date.now();
  try {
    const cards = listCustomCards();
    const missing = cards.filter((c) => c.luaPath && !fs.existsSync(path.isAbsolute(c.luaPath) ? c.luaPath : path.join(process.cwd(), c.luaPath)));
    record("custom-card registry", missing.length === 0 ? "pass" : "fail", Date.now() - started2, missing.slice(0, 3).map((m) => `${m.tempId}:${m.luaPath}`).join(" | ") || `${cards.length} records`);
  } catch (error) {
    record("custom-card registry", "fail", Date.now() - started2, (error as Error).message);
  }

  const started3 = Date.now();
  const scriptDir = path.join(process.cwd(), "data", "card-scripts", "generated");
  const metaPath = path.join(scriptDir, "meta.json");
  if (fs.existsSync(metaPath)) {
    const meta = JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    const orphans = Object.keys(meta).filter((id) => !fs.existsSync(path.join(scriptDir, `c${id}.lua`)));
    record("generated-script metadata", orphans.length === 0 ? "pass" : "fail", Date.now() - started3, orphans.join(", ") || `${Object.keys(meta).length} entries`);
  } else {
    record("generated-script metadata", "pass", Date.now() - started3, "none yet");
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("==================================================================");
  console.log("SYSTEM SMOKE TEST — every tool, MCP handshake, data integrity");
  console.log("==================================================================");

  console.log("\n[1] MCP stdio handshake");
  const mcp = await mcpHandshake();
  record("MCP initialize + tools/list + tools/call", mcp.ok ? "pass" : "fail", 0, mcp.error || `${mcp.toolCount} tools`);
  record(
    "MCP initialize carries tool-first instructions",
    mcp.instructions && /from memory/i.test(mcp.instructions) ? "pass" : "fail",
    0,
    mcp.instructions ? `${mcp.instructions.length} chars` : "missing 'instructions' in initialize result"
  );

  console.log("\n[2] Every registered tool");
  await callTools();

  console.log("\n[3] Data integrity");
  checkData();

  // Remove artefacts created by this smoke run so the registry stays clean.
  try {
    const registryPath = path.join(process.cwd(), "data", "custom_registry.json");
    if (fs.existsSync(registryPath)) {
      const raw = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
      const arr = Array.isArray(raw) ? raw : raw.cards || [];
      const smoke = arr.filter((r: any) => /Smoke Test Card/i.test(r.name || ""));
      if (smoke.length) {
        for (const record of smoke) {
          for (const candidate of [
            path.join(process.cwd(), "data", "custom_cards", `c${record.tempId}.lua`),
            path.join(process.cwd(), "data", "rendered_cards", `c${record.tempId}.svg`)
          ]) {
            try { fs.rmSync(candidate, { force: true }); } catch {}
          }
        }
        const kept = arr.filter((r: any) => !/Smoke Test Card/i.test(r.name || ""));
        fs.writeFileSync(registryPath, JSON.stringify(Array.isArray(raw) ? kept : { ...raw, cards: kept }, null, 2));
        console.log(`  cleaned ${smoke.length} smoke card(s) from the registry`);
      }
    }
  } catch {
    // Cleanup is best-effort.
  }

  const failed = results.filter((r) => r.status === "fail");
  const passed = results.filter((r) => r.status === "pass").length;
  const expected = results.filter((r) => r.status === "expected-error").length;

  const reportPath = path.join(process.cwd(), "data", "system_smoke_report.json");
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify({ at: new Date().toISOString(), durationMs: Date.now() - startedAt, results }, null, 2));

  console.log("\n==================================================================");
  console.log(`pass ${passed} · expected-error ${expected} · fail ${failed.length} · total ${results.length}`);
  console.log(`report: ${reportPath}`);
  if (failed.length) {
    console.error("FAILURES:");
    for (const f of failed) console.error(` - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log("SYSTEM SMOKE TEST PASSED");
}

main().catch((error) => {
  console.error("FATAL:", error);
  process.exit(1);
});
