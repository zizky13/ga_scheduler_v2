/**
 * CLI Runner — Layer 3: GA Core
 * Proves that the GA evolutionary loop works end-to-end.
 */

import type { GAConfig } from '../types.js';
import { courseOfferings, timeSlots, lecturers, rooms } from '../db/seed.js';
import { runPreGA } from '../pre-ga/validator.js';
import { runSSA } from '../ssa/index.js';
import { runGA } from '../ga/runGA.js';

console.log('═══════════════════════════════════════════════════');
console.log('  LAYER 3: GA Core — Backbone Test');
console.log('═══════════════════════════════════════════════════\n');

// ─── Step 1: Run Layer 1 ────────────────────────────────────────
console.log('── Step 1: Pre-GA Validation ──────────────────────');
const { validation, candidates } = runPreGA(courseOfferings, timeSlots, rooms);
console.log(`  Feasible: ${validation.feasible.length} | Infeasible: ${validation.infeasible.length}\n`);

// ─── Step 2: Run Layer 2 ────────────────────────────────────────
console.log('── Step 2: SSA Feasibility Gate ───────────────────');
const ssaResult = runSSA(candidates);
console.log(`  Status: ${ssaResult.status} | Sessions: ${ssaResult.totalSessionsRequired} | Matchable: ${ssaResult.maximumAchievableMatching}`);

if (ssaResult.status === 'INFEASIBLE') {
  console.log(`  ❌ SSA blocked GA — ${ssaResult.deadlockReport?.message}`);
  process.exit(1);
}
console.log('  ✅ SSA passed — proceeding to GA.\n');

// ─── Step 3: Build lecturer maps ────────────────────────────
const lecturerStructuralMap = new Map<number, boolean>(
  lecturers.map(l => [l.id, l.isStructural])
);
const lecturerPreferenceMap = new Map<number, Set<number>>(
  lecturers.map(l => [l.id, new Set(l.preferredTimeSlotIds)])
);

// ─── Step 4: Run GA ─────────────────────────────────────────────
console.log('── Step 3: GA Execution ───────────────────────────');
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

console.log(`  Config: pop=${config.populationSize} gens=${config.generations} ` +
  `mut=${config.mutationRate} elite=${config.elitismCount} ` +
  `crossover=${config.crossoverType}\n`);

const startTime = performance.now();
const gaResult = runGA(candidates, lecturerStructuralMap, lecturerPreferenceMap, config);
const durationMs = Math.round(performance.now() - startTime);

// ─── Step 5: Print Results ──────────────────────────────────────
console.log('\n── GA Results ─────────────────────────────────────');
console.log(`  Best Fitness:     ${gaResult.bestFitness.toFixed(4)}`);
console.log(`  Hard Violations:  ${gaResult.hardViolations}`);
console.log(`  Soft Penalty:     ${gaResult.softPenalty}`);
console.log(`  Generations Run:  ${gaResult.generationsRun}`);
console.log(`  Stagnated Early:  ${gaResult.stagnatedEarly}`);
console.log(`  Duration:         ${durationMs}ms`);

console.log('\n── Best Chromosome (Schedule) ──────────────────────');
for (const gene of gaResult.bestChromosome) {
  const offering = courseOfferings.find(o => o.id === gene.offeringId);
  const slotLabels = gene.assignedTimeSlotIds.map(sid => {
    const ts = timeSlots.find(t => t.id === sid);
    return ts ? `${ts.day} ${ts.startTime}-${ts.endTime}` : `Slot#${sid}`;
  });
  console.log(
    `  📅 ${offering?.course.code} "${offering?.course.name}" ` +
    `→ ${offering?.room.name} → [${slotLabels.join(', ')}]`
  );
}

console.log(`\n── Fitness History (first 5, last 5) ───────────────`);
const h = gaResult.history;
const show = [...h.slice(0, 5), '...', ...h.slice(-5)];
console.log(`  ${show.map(v => typeof v === 'number' ? v.toFixed(4) : v).join(' → ')}`);

const status = gaResult.hardViolations === 0 ? '✅ VALID SCHEDULE' : '⚠️  CONFLICTS REMAIN';
console.log(`\n${status}\n`);
console.log('✅ Layer 3 backbone validated.\n');
