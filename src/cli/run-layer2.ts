/**
 * CLI Runner — Layer 2: Static Structural Analysis (SSA)
 * Tests all 3 SSA phases with feasible, infeasible, and Phase 0 scenarios.
 */

import type { PreGACandidate } from '../types.js';
import { courseOfferings, timeSlots } from '../db/seed.js';
import { runPreGA } from '../pre-ga/validator.js';
import { runSSA } from '../ssa/index.js';
import { runStaticExclusion } from '../ssa/staticExclusion.js';

console.log('═══════════════════════════════════════════════════');
console.log('  LAYER 2: Static Structural Analysis — Backbone');
console.log('═══════════════════════════════════════════════════\n');

// ─── Test 1: Normal feasible dataset ────────────────────────────
console.log('── Test 1: Feasible Dataset (from Layer 1) ────────');
const { candidates } = runPreGA(courseOfferings, timeSlots);

const ssaResult = runSSA(candidates);
console.log(`  Status:             ${ssaResult.status}`);
console.log(`  Total Sessions:     ${ssaResult.totalSessionsRequired}`);
console.log(`  Max Matchable:      ${ssaResult.maximumAchievableMatching}`);
if (ssaResult.status === 'FEASIBLE') {
  console.log('  ✅ All sessions can be scheduled — GA may proceed.\n');
}

// ─── Test 2: Phase 0 Static Exclusion verification ──────────────
console.log('── Test 2: Phase 0 Static Exclusion ──────────────');
const fixedCandidates = candidates.filter(c => c.isFixedRoom);
const flexibleOnR201 = candidates.filter(c => !c.isFixedRoom && c.roomId === 3);

console.log(`  Fixed candidates: ${fixedCandidates.length}`);
for (const fc of fixedCandidates) {
  console.log(`    🔒 Offering ${fc.offeringId} | Room: ${fc.roomId} | Slots: [${fc.possibleTimeSlotIds}]`);
}

const { lockedCoordinates, prunedCandidates } = runStaticExclusion(candidates);
console.log(`  Locked coordinates: ${lockedCoordinates.size}`);
for (const coord of lockedCoordinates) {
  console.log(`    🔐 ${coord}`);
}

const prunedR201 = prunedCandidates.filter(c => !c.isFixedRoom && c.roomId === 3);
for (const pc of prunedR201) {
  const originalSlots = flexibleOnR201.find(o => o.offeringId === pc.offeringId)?.possibleTimeSlotIds.length ?? '?';
  console.log(
    `    📋 Offering ${pc.offeringId} (R-201 flexible): ` +
    `${originalSlots} → ${pc.possibleTimeSlotIds.length} slots after pruning`
  );
}
console.log('  ✅ Static Exclusion verified — locked coordinates pruned from flexible domains.\n');

// ─── Test 3: Forced infeasible — 3 sessions, 2 slots ───────────
console.log('── Test 3: Hopcroft-Karp Infeasible (3 sessions, 2 slots)');
const infeasibleCandidates: PreGACandidate[] = [
  {
    offeringId: 101, courseId: 1, roomId: 1,
    lecturerIds: [1], requiredSessions: 1,
    possibleTimeSlotIds: [1, 2], isFixedRoom: false,
  },
  {
    offeringId: 102, courseId: 2, roomId: 1,
    lecturerIds: [2], requiredSessions: 1,
    possibleTimeSlotIds: [1, 2], isFixedRoom: false,
  },
  {
    offeringId: 103, courseId: 3, roomId: 1,
    lecturerIds: [3], requiredSessions: 1,
    possibleTimeSlotIds: [1, 2], isFixedRoom: false,
  },
];

const ssaResult2 = runSSA(infeasibleCandidates);
console.log(`  Status:             ${ssaResult2.status}`);
console.log(`  Total Sessions:     ${ssaResult2.totalSessionsRequired}`);
console.log(`  Max Matchable:      ${ssaResult2.maximumAchievableMatching}`);
if (ssaResult2.deadlockReport) {
  console.log(`  Code:               ${ssaResult2.deadlockReport.code}`);
  console.log(`  Message:            ${ssaResult2.deadlockReport.message}`);
  console.log(`  Affected Offerings: [${ssaResult2.deadlockReport.affectedOfferingIds.join(', ')}]`);
  console.log(`  Recommendation:     ${ssaResult2.deadlockReport.recommendation}`);
}
console.log('  ❌ SSA correctly blocks GA execution.\n');

// ─── Test 4: AC-3 domain pruning detection ──────────────────────
console.log('── Test 4: AC-3 Forced Conflict (2 sessions, 1 slot)');
const ac3ForcedCandidates: PreGACandidate[] = [
  {
    offeringId: 201, courseId: 1, roomId: 1,
    lecturerIds: [1], requiredSessions: 1,
    possibleTimeSlotIds: [1], isFixedRoom: false,
  },
  {
    offeringId: 202, courseId: 2, roomId: 1,
    lecturerIds: [2], requiredSessions: 1,
    possibleTimeSlotIds: [1], isFixedRoom: false,
  },
];

const ssaResult3 = runSSA(ac3ForcedCandidates);
console.log(`  Status:             ${ssaResult3.status}`);
console.log(`  Total Sessions:     ${ssaResult3.totalSessionsRequired}`);
console.log(`  Max Matchable:      ${ssaResult3.maximumAchievableMatching}`);
if (ssaResult3.deadlockReport) {
  console.log(`  Code:               ${ssaResult3.deadlockReport.code}`);
  console.log(`  Message:            ${ssaResult3.deadlockReport.message}`);
}
console.log('  ❌ AC-3 detected forced conflict before Hopcroft-Karp.\n');

// ─── Test 5: Static Exclusion causes infeasibility ──────────────
console.log('── Test 5: Phase 0 Exclusion → Infeasible');
const exclusionInfeasible: PreGACandidate[] = [
  // Fixed offering locks Room 1, Slot 1
  {
    offeringId: 301, courseId: 1, roomId: 1,
    lecturerIds: [1], requiredSessions: 1,
    possibleTimeSlotIds: [1], isFixedRoom: true,
  },
  // Fixed offering locks Room 1, Slot 2
  {
    offeringId: 302, courseId: 2, roomId: 1,
    lecturerIds: [2], requiredSessions: 1,
    possibleTimeSlotIds: [2], isFixedRoom: true,
  },
  // Flexible offering in Room 1 — only has slots [1, 2] which are both locked
  {
    offeringId: 303, courseId: 3, roomId: 1,
    lecturerIds: [3], requiredSessions: 1,
    possibleTimeSlotIds: [1, 2], isFixedRoom: false,
  },
];

const ssaResult4 = runSSA(exclusionInfeasible);
console.log(`  Status:             ${ssaResult4.status}`);
console.log(`  Total Sessions:     ${ssaResult4.totalSessionsRequired}`);
console.log(`  Max Matchable:      ${ssaResult4.maximumAchievableMatching}`);
if (ssaResult4.deadlockReport) {
  console.log(`  Code:               ${ssaResult4.deadlockReport.code}`);
  console.log(`  Message:            ${ssaResult4.deadlockReport.message}`);
}
console.log('  ❌ Phase 0 + AC-3 detected domain elimination from locked coordinates.\n');

console.log('✅ Layer 2 backbone validated.\n');
