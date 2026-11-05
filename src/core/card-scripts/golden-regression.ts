/**
 * Golden regression harness for card scripts.
 *
 * A golden case is a full scenario plus the outcome we expect from the engine.
 * Running them after a ProjectIgnis update (or an engine bump) shows exactly
 * which behaviour changed, instead of relying on "it still compiles".
 */

import fs from "node:fs";
import path from "node:path";
import { runScenario, type ScenarioSpec } from "./scenario-runner.js";

export interface GoldenCase {
  id: string;
  description?: string;
  scenario: ScenarioSpec;
  /** Expectations are part of the spec; this records who authored the case. */
  addedBy?: string;
}

export interface GoldenResult {
  id: string;
  description?: string;
  verdict: "pass" | "fail" | "error";
  expectations: Array<{ expectation: string; met: boolean; evidence: string }>;
  chain: Array<{ link: number; code: number }>;
  error?: string;
}

export interface GoldenReport {
  total: number;
  passed: number;
  failed: number;
  errored: number;
  durationMs: number;
  results: GoldenResult[];
}

const CASES_FILE = path.join(process.cwd(), "data", "golden", "scenarios.json");

export function loadGoldenCases(file = CASES_FILE): GoldenCase[] {
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    return Array.isArray(parsed) ? parsed : parsed.cases || [];
  } catch {
    return [];
  }
}

export function saveGoldenCases(cases: GoldenCase[], file = CASES_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ cases }, null, 2), "utf-8");
}

export async function runGoldenSuite(options: { file?: string; only?: string[] } = {}): Promise<GoldenReport> {
  const started = Date.now();
  const cases = loadGoldenCases(options.file).filter((c) => !options.only || options.only.includes(c.id));
  const results: GoldenResult[] = [];

  for (const testCase of cases) {
    try {
      const result = await runScenario(testCase.scenario);
      const failed = result.expectations.filter((e) => !e.met);
      results.push({
        id: testCase.id,
        description: testCase.description,
        verdict: failed.length === 0 && result.verdict === "CONFIRMED" ? "pass" : "fail",
        expectations: result.expectations.map((e) => ({ expectation: e.expectation, met: e.met, evidence: e.evidence })),
        chain: result.chain.map((c) => ({ link: c.link, code: c.code }))
      });
    } catch (error) {
      results.push({ id: testCase.id, description: testCase.description, verdict: "error", expectations: [], chain: [], error: (error as Error).message });
    }
  }

  return {
    total: results.length,
    passed: results.filter((r) => r.verdict === "pass").length,
    failed: results.filter((r) => r.verdict === "fail").length,
    errored: results.filter((r) => r.verdict === "error").length,
    durationMs: Date.now() - started,
    results
  };
}
