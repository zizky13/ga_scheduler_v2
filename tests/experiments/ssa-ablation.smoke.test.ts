import { describe, it, expect, afterAll } from "vitest";
import { readFile, stat, mkdir, rm } from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  runAblationExperiment,
  type ScenarioSpec,
} from "../../src/experiments/ssa-ablation.js";
import {
  rooms,
  timeSlots,
  lecturers,
  courseOfferings,
} from "../../src/db/seed.js";

/**
 * E2.16 smoke check.
 *
 * Confirms the ablation harness runs end-to-end against an inline
 * `feasible-easy` scenario built from the canonical seed and writes the
 * expected output files. This is NOT a correctness test for the GA — only
 * a harness shape/plumbing check. Acceptance: < 30s on CI.
 */
describe("ssa-ablation harness smoke", () => {
  const outputDir = path.join(
    os.tmpdir(),
    `ssa-ablation-smoke-${Date.now()}-${process.pid}`,
  );

  afterAll(async () => {
    await rm(outputDir, { recursive: true, force: true });
  });

  it(
    "completes without throwing and writes valid JSONL/CSV/summary",
    { timeout: 60_000 },
    async () => {
      await mkdir(outputDir, { recursive: true });

      const scenario: ScenarioSpec = {
        id: "feasible-easy",
        label: "Smoke / feasible-easy (E2.16 inline placeholder for E3 manifest)",
        build: () => ({
          offerings: courseOfferings,
          timeSlots,
          rooms,
          lecturers,
        }),
      };

      const report = await runAblationExperiment({
        repetitions: 1,
        scenarios: [scenario],
        gaConfigOverrides: { generations: 10, populationSize: 20 },
        outputDir,
      });

      // 1 scenario × 2 modes × 1 rep = 2 records
      expect(report.records).toHaveLength(2);
      expect(report.totalRuns).toBe(2);
      expect(report.scenarioCount).toBe(1);
      expect(report.repetitions).toBe(1);

      // Output files exist
      const jsonlPath = path.join(outputDir, "raw-runs.jsonl");
      const csvPath = path.join(outputDir, "raw-runs.csv");
      const summaryPath = path.join(outputDir, "summary.json");

      await expect(stat(jsonlPath)).resolves.toBeDefined();
      await expect(stat(csvPath)).resolves.toBeDefined();
      await expect(stat(summaryPath)).resolves.toBeDefined();

      // JSONL has exactly 2 lines and every line is valid JSON
      const jsonlText = await readFile(jsonlPath, "utf-8");
      const lines = jsonlText.split("\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);

      const modesSeen = new Set<string>();
      for (const line of lines) {
        const parsed = JSON.parse(line);
        expect(parsed.scenarioId).toBe("feasible-easy");
        expect(parsed.mode).toBeDefined();
        expect(["with-ssa", "without-ssa"]).toContain(parsed.mode);
        modesSeen.add(parsed.mode);
      }
      expect(modesSeen.size).toBe(2);

      // summary.json parses and exposes per-(scenario,mode) groups
      const summaryText = await readFile(summaryPath, "utf-8");
      const summary = JSON.parse(summaryText);
      expect(Array.isArray(summary.groups)).toBe(true);
      expect(summary.groups).toHaveLength(2);
    },
  );
});
