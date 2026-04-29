/**
 * CLI Runner — Full Pipeline Orchestrator
 * Demonstrates the complete three-layer pipeline end-to-end
 * matching the runtime view in Section 6.1 of the technical spec.
 */

import type { GAConfig } from '../types.js';
import { courseOfferings, infeasibleOfferings, timeSlots, lecturers, rooms } from '../db/seed.js';
import { runPreGA } from '../pre-ga/validator.js';
import { isLecturerEligibleForCourse } from '../pre-ga/checks.js';
import { runSSA } from '../ssa/index.js';
import { runStaticExclusion } from '../ssa/staticExclusion.js';
import { runGA } from '../ga/runGA.js';

const DIVIDER = '═'.repeat(60);
const SDIVIDER = '─'.repeat(60);

console.log(`\n${DIVIDER}`);
console.log('  GA SCHEDULER v2 — Full Pipeline Orchestrator');
console.log('  Three-Layer Architecture Backbone Validation');
console.log(DIVIDER);
console.log();

const pipelineStart = performance.now();

// ═══════════════════════════════════════════════════════════════
// LAYER 1: Pre-GA Policy Engine
// ═══════════════════════════════════════════════════════════════
console.log('┌─────────────────────────────────────────────────┐');
console.log('│  LAYER 1: Pre-GA Policy Engine                  │');
console.log('│  Deterministic. O(n) complexity.                │');
console.log('└─────────────────────────────────────────────────┘\n');

// Include ALL infeasible offerings
const allOfferings = [...courseOfferings, ...infeasibleOfferings];
console.log(`  Input: ${allOfferings.length} offerings, ${timeSlots.length} time slots`);

const l1Start = performance.now();
const { validation, candidates } = runPreGA(allOfferings, timeSlots);
const l1Duration = Math.round(performance.now() - l1Start);

console.log(`  Feasible:   ${validation.feasible.length}`);
console.log(`  Infeasible: ${validation.infeasible.length}`);
for (const { offering, failedCheck } of validation.infeasible) {
  console.log(`    ❌ ID=${offering.id} "${offering.course.name}" → [${failedCheck.code}]`);
}

// Show entity tagger results
const fixedCount = candidates.filter(c => c.isFixedRoom).length;
console.log(`  Candidates: ${candidates.length} (${fixedCount} fixed, ${candidates.length - fixedCount} flexible)`);
for (const c of candidates) {
  console.log(
    `    📋 #${c.offeringId} room=${c.roomId} lec=[${c.lecturerIds}] ` +
    `sessions=${c.requiredSessions} slots=${c.possibleTimeSlotIds.length} ` +
    `fixedRoom=${c.isFixedRoom}`
  );
}
console.log(`  Duration: ${l1Duration}ms`);

if (candidates.length === 0) {
  console.log('\n  🛑 NO_FEASIBLE_CANDIDATES — Pipeline aborted.');
  process.exit(1);
}

console.log(`\n  ✅ Layer 1 passed → ${candidates.length} candidates forwarded.\n`);

// ═══════════════════════════════════════════════════════════════
// LAYER 2: Static Structural Analysis (SSA)
// ═══════════════════════════════════════════════════════════════
console.log('┌─────────────────────────────────────────────────┐');
console.log('│  LAYER 2: Static Structural Analysis (SSA)      │');
console.log('│  Deterministic. O(E√V) complexity.              │');
console.log('└─────────────────────────────────────────────────┘\n');

// Show Phase 0 Static Exclusion details
const { lockedCoordinates } = runStaticExclusion(candidates);
if (lockedCoordinates.size > 0) {
  console.log(`  Phase 0 — Static Exclusion:`);
  console.log(`    Locked coordinates: ${lockedCoordinates.size}`);
  for (const coord of lockedCoordinates) {
    const [roomId, slotId] = coord.split(':');
    const room = rooms.find(r => r.id === Number(roomId));
    const slot = timeSlots.find(s => s.id === Number(slotId));
    console.log(
      `      🔐 ${room?.name ?? `Room#${roomId}`} × ${slot ? `${slot.day.slice(0,3)} ${slot.startTime}` : `Slot#${slotId}`}`
    );
  }
  console.log();
}

const l2Start = performance.now();
const ssaResult = runSSA(candidates);
const l2Duration = Math.round(performance.now() - l2Start);

console.log(`  Status:            ${ssaResult.status}`);
console.log(`  Total Sessions:    ${ssaResult.totalSessionsRequired}`);
console.log(`  Max Matchable:     ${ssaResult.maximumAchievableMatching}`);
console.log(`  Duration:          ${l2Duration}ms`);

if (ssaResult.status === 'INFEASIBLE') {
  console.log(`\n  🛑 STRUCTURAL_INFEASIBILITY — GA blocked.`);
  console.log(`  Code: ${ssaResult.deadlockReport?.code}`);
  console.log(`  Message: ${ssaResult.deadlockReport?.message}`);
  console.log(`  Affected: [${ssaResult.deadlockReport?.affectedOfferingIds.join(', ')}]`);
  process.exit(1);
}

console.log(`\n  ✅ Layer 2 passed — feasibility confirmed.\n`);

// ═══════════════════════════════════════════════════════════════
// LAYER 3: GA Core (Genetic Algorithm)
// ═══════════════════════════════════════════════════════════════
console.log('┌─────────────────────────────────────────────────┐');
console.log('│  LAYER 3: GA Core (Evolutionary Optimization)   │');
console.log('│  Probabilistic. O(g × p × n) complexity.        │');
console.log('└─────────────────────────────────────────────────┘\n');

// Build lecturer structural map
const lecturerStructuralMap = new Map<number, boolean>(
  lecturers.map(l => [l.id, l.isStructural])
);

// Build competency eligibility map: offeringId → eligible lecturerIds
const competencyEligibilityMap = new Map<number, Set<number>>(
  validation.feasible.map(o => [
    o.id,
    new Set(
      lecturers.filter(l => isLecturerEligibleForCourse(l, o.course)).map(l => l.id)
    ),
  ])
);

// Build lecturer preference map
const lecturerPreferenceMap = new Map<number, Set<number>>(
  lecturers.map(l => [l.id, new Set(l.preferredTimeSlotIds)])
);

console.log('  Lecturer Preferences:');
for (const l of lecturers) {
  const prefSlots = l.preferredTimeSlotIds.length > 0
    ? l.preferredTimeSlotIds.map(sid => {
        const ts = timeSlots.find(t => t.id === sid);
        return ts ? `${ts.day.slice(0, 3)} ${ts.startTime}` : `#${sid}`;
      }).join(', ')
    : '(any — fully flexible)';
  const tags = [
    l.isStructural ? '🏛️ structural' : '',
  ].filter(Boolean).join(' ');
  console.log(`    ${l.name} ${tags}`);
  console.log(`      Preferred: ${prefSlots}`);
}

// Run all three crossover strategies
const crossoverTypes = ['singlePoint', 'uniform', 'pmx'] as const;

for (const crossoverType of crossoverTypes) {
  console.log(`\n  ${SDIVIDER}`);
  console.log(`  Crossover: ${crossoverType.toUpperCase()}`);
  console.log(`  ${SDIVIDER}`);

  const config: GAConfig = {
    populationSize: 80,
    generations: 200,
    mutationRate: 0.1,
    elitismCount: 3,
    tournamentSize: 4,
    crossoverType,
    noiseRate: 0.15,
    hardPenaltyWeight: 100,
    softPenaltyWeight: 1,
  };

  const l3Start = performance.now();
  const gaResult = runGA(candidates, lecturerStructuralMap, lecturerPreferenceMap, config, competencyEligibilityMap);
  const l3Duration = Math.round(performance.now() - l3Start);

  console.log(`\n  Results:`);
  console.log(`    Best Fitness:      ${gaResult.bestFitness.toFixed(4)}`);
  console.log(`    Hard Violations:   ${gaResult.hardViolations}`);
  console.log(`    Soft Penalty:      ${gaResult.softPenalty}`);
  console.log(`    Generations:       ${gaResult.generationsRun}`);
  console.log(`    Stagnated:         ${gaResult.stagnatedEarly}`);
  console.log(`    Duration:          ${l3Duration}ms`);
  console.log(`    Status:            ${gaResult.hardViolations === 0 ? '✅ VALID' : '⚠️  CONFLICTS'}`);

  // Show the schedule for the last crossover run
  if (crossoverType === 'pmx') {
    console.log(`\n  📅 Best Schedule (PMX):`);

    // Verify FIXED gene invariant
    const fixedGenes = gaResult.bestChromosome.filter(g => g.kind === 'FIXED');
    const fixedInvariantOk = fixedGenes.every(g => {
      const c = candidates.find(c => c.offeringId === g.offeringId);
      return c && c.roomId === g.roomId;
    });

    for (const gene of gaResult.bestChromosome) {
      const offering = courseOfferings.find(o => o.id === gene.offeringId);
      if (!offering) continue;
      const lecNames = offering.lecturers.map(l => l.name.split(' ')[0]).join('+');
      const slotLabels = gene.assignedTimeSlotIds.map(sid => {
        const ts = timeSlots.find(t => t.id === sid);
        return ts ? `${ts.day.slice(0, 3)} ${ts.startTime}` : `#${sid}`;
      });
      const prefCheck = offering.lecturers.map(l => {
        const pref = lecturerPreferenceMap.get(l.id);
        if (!pref || pref.size === 0) return '🔵'; // no pref
        return gene.assignedTimeSlotIds.every(s => pref.has(s)) ? '🟢' : '🟡';
      }).join('');
      const kindTag = gene.kind === 'FIXED' ? ' 🔒' : '';
      console.log(
        `    ${prefCheck} ${offering.course.code} "${offering.course.name}" ` +
        `| ${lecNames} → ${offering.room.name} → [${slotLabels.join(', ')}]${kindTag}`
      );
    }
    console.log(`\n  Legend: 🟢=preferred 🟡=non-preferred 🔵=no preference 🔒=fixed room`);

    // Fixed Gene Masking Invariant check
    console.log(`\n  🔒 Fixed Gene Masking Invariant: ${fixedInvariantOk ? '✅ PASS' : '❌ FAIL'}`);
    for (const fg of fixedGenes) {
      const offering = courseOfferings.find(o => o.id === fg.offeringId);
      console.log(
        `    Offering ${fg.offeringId} (${offering?.course.code}): ` +
        `kind=${fg.kind} roomId=${fg.roomId} (original=${offering?.roomId})`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// PIPELINE COMPLETE
// ═══════════════════════════════════════════════════════════════
const totalDuration = Math.round(performance.now() - pipelineStart);

console.log(`\n${DIVIDER}`);
console.log('  PIPELINE COMPLETE');
console.log(DIVIDER);
console.log(`  Total Duration:    ${totalDuration}ms`);
console.log(`  Layer 1 (Pre-GA):  ${l1Duration}ms`);
console.log(`  Layer 2 (SSA):     ${l2Duration}ms`);
console.log(`  Layer 3 (GA):      3 crossover runs above`);
console.log(`\n  Architecture: All 3 layers operational. ✅\n`);
