/**
 * Golden suite runner (CLI entry).
 *
 * Replays data/golden/scenarios.json on the real engine and exits non-zero when
 * any case no longer matches, so a script or engine update cannot silently
 * change behaviour.
 */

import { runGoldenSuite, loadGoldenCases } from "./core/card-scripts/golden-regression.js";

const only = process.argv.slice(2).filter((arg) => !arg.startsWith("-"));

const cases = loadGoldenCases();
if (cases.length === 0) {
  console.error("No golden cases at data/golden/scenarios.json");
  process.exit(1);
}

const report = await runGoldenSuite({ only: only.length ? only : undefined });

for (const result of report.results) {
  const mark = result.verdict === "pass" ? "✓" : result.verdict === "fail" ? "✗" : "!";
  console.log(`${mark} ${result.id}${result.description ? ` — ${result.description}` : ""}`);
  for (const expectation of result.expectations) {
    console.log(`    ${expectation.met ? "✓" : "✗"} ${expectation.expectation}`);
  }
  if (result.error) console.log(`    error: ${result.error}`);
}

console.log(
  `\n${report.passed}/${report.total} passed, ${report.failed} failed, ${report.errored} errored in ${(report.durationMs / 1000).toFixed(1)}s`
);

process.exit(report.failed === 0 && report.errored === 0 ? 0 : 1);
