/**
 * CLI Runner — Layer 3: GA Core
 * Proves that the GA evolutionary loop works end-to-end.
 *
 * Orchestration logic lives in src/orchestrator.ts. This CLI is a thin
 * presentation wrapper around the SchedulerResponse envelope.
 */

import type { GAConfig } from '../types.js';
import { courseOfferings, timeSlots, lecturers, rooms } from '../db/seed.js';
import { runPipeline } from '../orchestrator.js';

console.log('═══════════════════════════════════════════════════');
console.log('  LAYER 3: GA Core — Backbone Test');
console.log('═══════════════════════════════════════════════════\n');

const config: GAConfig = {
  populationSize: 50,
  generations: 100,
  mutationRate: 0.1,
  elitismCount: 2,
  tournamentSize: 3,
  crossoverType: 'singlePoint',
  noiseRate: 0.15,
  hardPenaltyWeight: 100,
  softPenaltyWeight: 1,
};

console.log('── Step 3: GA Execution ───────────────────────────');
console.log(`  Config: pop=${config.populationSize} gens=${config.generations} ` +
  `mut=${config.mutationRate} elite=${config.elitismCount} ` +
  `crossover=${config.crossoverType}\n`);

const { response } = runPipeline({
  offerings: courseOfferings,
  timeSlots,
  rooms,
  lecturers,
  config,
});

// ─── Step 1: Pre-GA summary ─────────────────────────────────────
console.log('── Step 1: Pre-GA Validation ──────────────────────');
console.log(`  Feasible: ${response.preGASummary.feasible} | Infeasible: ${response.preGASummary.infeasible.length}\n`);

if (response.status === 'NO_FEASIBLE_CANDIDATES') {
  console.log('  ❌ No feasible candidates — pipeline aborted.\n');
  process.exit(1);
}

// ─── Step 2: SSA summary ────────────────────────────────────────
console.log('── Step 2: SSA Feasibility Gate ───────────────────');
const ssaResult = response.ssaResult!;
console.log(`  Status: ${ssaResult.status} | Sessions: ${ssaResult.totalSessionsRequired} | Matchable: ${ssaResult.maximumAchievableMatching}`);

if (response.status === 'INFEASIBLE') {
  console.log(`  ❌ SSA blocked GA — ${ssaResult.deadlockReport?.message}`);
  process.exit(1);
}
console.log('  ✅ SSA passed — proceeding to GA.\n');

// ─── Step 3: GA Results ─────────────────────────────────────────
const gaResult = response.gaResult!;

console.log('\n── GA Results ─────────────────────────────────────');
console.log(`  Best Fitness:     ${gaResult.bestFitness.toFixed(4)}`);
console.log(`  Hard Violations:  ${gaResult.hardViolations}`);
console.log(`  Soft Penalty:     ${gaResult.softPenalty}`);
console.log(`  Generations Run:  ${gaResult.generationsRun}`);
console.log(`  Stagnated Early:  ${gaResult.stagnatedEarly}`);
console.log(`  Duration:         ${response.durationMs}ms`);

console.log('\n── Best Chromosome (Schedule) ──────────────────────');
for (const gene of gaResult.bestChromosome) {
  const offering = courseOfferings.find(o => o.id === gene.offeringId);
  const slotLabels = gene.sessions.flatMap(session =>
    session.timeSlotIds.map(sid => {
      const ts = timeSlots.find(t => t.id === sid);
      return ts ? `${ts.day} ${ts.startTime}-${ts.endTime}` : `Slot#${sid}`;
    })
  );
  const roomLabel = gene.sessions.map(s => s.roomId).join('+');
  console.log(
    `  📅 ${offering?.course.code} "${offering?.course.name}" ` +
    `→ Room(s) ${roomLabel} → [${slotLabels.join(', ')}]`
  );
}

console.log(`\n── Fitness History (first 5, last 5) ───────────────`);
const h = gaResult.history;
const show = [...h.slice(0, 5), '...', ...h.slice(-5)];
console.log(`  ${show.map(v => typeof v === 'number' ? v.toFixed(4) : v).join(' → ')}`);

const status = gaResult.hardViolations === 0 ? '✅ VALID SCHEDULE' : '⚠️  CONFLICTS REMAIN';
console.log(`\n${status}\n`);
console.log('✅ Layer 3 backbone validated.\n');
