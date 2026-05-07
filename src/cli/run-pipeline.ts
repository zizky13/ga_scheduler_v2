/**
 * CLI Runner — Full Pipeline Orchestrator
 * Demonstrates the complete three-layer pipeline end-to-end
 * matching the runtime view in Section 6.1 of the technical spec.
 *
 * Orchestration logic lives in src/orchestrator.ts. This file is a thin
 * presentation wrapper that consumes the SchedulerResponse envelope and
 * pretty-prints it for humans. The same orchestrator powers the future API.
 */

import type { CourseOffering, GAConfig, Lecturer, Room, TimeSlot } from '../types.js';
import { courseOfferings, infeasibleOfferings, timeSlots, lecturers, rooms } from '../db/seed.js';
import { runStaticExclusion } from '../ssa/staticExclusion.js';
import { runPipeline } from '../orchestrator.js';
import { formatGeneLines, formatSession, isContiguous } from './_format.js';

const DIVIDER = '═'.repeat(60);
const SDIVIDER = '─'.repeat(60);

function buildConfig(crossoverType: GAConfig['crossoverType']): GAConfig {
  return {
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
}

async function main(): Promise<void> {
console.log(`\n${DIVIDER}`);
console.log('  GA SCHEDULER v2 — Full Pipeline Orchestrator');
console.log('  Three-Layer Architecture Backbone Validation');
console.log(DIVIDER);
console.log();

const pipelineStart = performance.now();

const allOfferings = [...courseOfferings, ...infeasibleOfferings];
const crossoverTypes = ['singlePoint', 'uniform', 'pmx'] as const;

// ═══════════════════════════════════════════════════════════════
// LAYER 1: Pre-GA Policy Engine (presentation comes from first run)
// ═══════════════════════════════════════════════════════════════
console.log('┌─────────────────────────────────────────────────┐');
console.log('│  LAYER 1: Pre-GA Policy Engine                  │');
console.log('│  Deterministic. O(n) complexity.                │');
console.log('└─────────────────────────────────────────────────┘\n');

console.log(`  Input: ${allOfferings.length} offerings, ${timeSlots.length} time slots`);

const realLog = console.log;
const realWarn = console.warn;
console.log = () => {};
console.warn = () => {};
const firstRun = await runPipeline({
  offerings: allOfferings,
  timeSlots,
  rooms,
  lecturers,
  config: buildConfig(crossoverTypes[0]),
});
console.log = realLog;
console.warn = realWarn;
const { validation, candidates } = firstRun.context;

console.log(`  Feasible:   ${validation.feasible.length}`);
console.log(`  Infeasible: ${validation.infeasible.length}`);
for (const { offering, failedCheck } of validation.infeasible) {
  console.log(`    ❌ ID=${offering.id} "${offering.course.name}" → [${failedCheck.code}]`);
}

const fixedCount = candidates.filter(c => c.isFixedRoom).length;
console.log(`  Candidates: ${candidates.length} (${fixedCount} fixed, ${candidates.length - fixedCount} flexible)`);
for (const c of candidates) {
  console.log(
    `    📋 #${c.offeringId} room=${c.roomId} lec=[${c.lecturerIds}] ` +
    `parallel=${c.parallelSessionCount}×${c.sessionDuration}slot ` +
    `domain=${c.possibleTimeSlotIds.length} fixedRoom=${c.isFixedRoom}`
  );
}

if (firstRun.response.status === 'NO_FEASIBLE_CANDIDATES') {
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

const ssaResult = firstRun.response.ssaResult!;
console.log(`  Status:            ${ssaResult.status}`);
console.log(`  Total Sessions:    ${ssaResult.totalSessionsRequired}`);
console.log(`  Max Matchable:     ${ssaResult.maximumAchievableMatching}`);

if (firstRun.response.status === 'INFEASIBLE') {
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

const { lecturerPreferenceMap } = firstRun.context;

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

for (const crossoverType of crossoverTypes) {
  console.log(`\n  ${SDIVIDER}`);
  console.log(`  Crossover: ${crossoverType.toUpperCase()}`);
  console.log(`  ${SDIVIDER}`);

  const run = await runPipeline({
    offerings: allOfferings,
    timeSlots,
    rooms,
    lecturers,
    config: buildConfig(crossoverType),
  });

  const gaResult = run.response.gaResult!;

  console.log(`\n  Results:`);
  console.log(`    Best Fitness:      ${gaResult.bestFitness.toFixed(4)}`);
  console.log(`    Hard Violations:   ${gaResult.hardViolations}`);
  console.log(`    Soft Penalty:      ${gaResult.softPenalty}`);
  console.log(`    Generations:       ${gaResult.generationsRun}`);
  console.log(`    Stagnated:         ${gaResult.stagnatedEarly}`);
  console.log(`    Duration:          ${run.response.durationMs}ms`);
  console.log(`    Status:            ${gaResult.hardViolations === 0 ? '✅ VALID' : '⚠️  CONFLICTS'}`);

  if (crossoverType === 'pmx') {
    console.log(`\n  📅 Best Schedule (PMX):`);

    const slotLookup = new Map(timeSlots.map(t => [t.id, t]));
    const roomLookup = new Map(rooms.map(r => [r.id, r]));

    const fixedGenes = gaResult.bestChromosome.filter(g => g.kind === 'FIXED');
    const fixedInvariantOk = fixedGenes.every(g => {
      const c = candidates.find(c => c.offeringId === g.offeringId);
      return c && g.sessions.every(s => s.roomId === c.roomId);
    });

    let nonContiguousCount = 0;
    let durationMismatchCount = 0;
    let longestBlock = 0;

    for (const gene of gaResult.bestChromosome) {
      const offering = courseOfferings.find(o => o.id === gene.offeringId);
      if (!offering) continue;
      const candidate = candidates.find(c => c.offeringId === gene.offeringId);
      const expectedDuration = candidate?.sessionDuration ?? offering.course.sks;

      const lecNames = offering.lecturers.map(l => l.name.split(' ')[0]).join('+');
      const prefCheck = offering.lecturers.map(l => {
        const pref = lecturerPreferenceMap.get(l.id);
        if (!pref || pref.size === 0) return '🔵';
        return gene.sessions.every(s => s.timeSlotIds.every(sid => pref.has(sid))) ? '🟢' : '🟡';
      }).join('');
      const kindTag = gene.kind === 'FIXED' ? ' 🔒' : '';

      console.log(
        `    ${prefCheck} ${offering.course.code} "${offering.course.name}"` +
        ` | ${lecNames} | sks=${offering.course.sks}${kindTag}`
      );
      const lines = formatGeneLines(gene, slotLookup, {
        expectedDuration,
        expectedSessions: candidate?.parallelSessionCount,
        roomLookup,
        indent: '         ',
      });
      for (const line of lines) console.log(line);

      for (const s of gene.sessions) {
        if (s.timeSlotIds.length > longestBlock) longestBlock = s.timeSlotIds.length;
        if (!isContiguous(s.timeSlotIds, slotLookup)) nonContiguousCount++;
        if (s.timeSlotIds.length !== expectedDuration) durationMismatchCount++;
      }
    }
    console.log(`\n  Legend: 🟢=preferred 🟡=non-preferred 🔵=no preference 🔒=fixed room`);

    console.log(`\n  📐 Block Integrity:`);
    console.log(`    Longest contiguous block:  ${longestBlock} slot(s)`);
    console.log(`    Non-contiguous sessions:   ${nonContiguousCount}`);
    console.log(`    Duration mismatches:       ${durationMismatchCount}`);
    console.log(
      `    Status: ${nonContiguousCount === 0 && durationMismatchCount === 0 ? '✅ all blocks well-formed' : '⚠️  some sessions broke the contract'}`
    );

    console.log(`\n  🔒 Fixed Gene Masking Invariant: ${fixedInvariantOk ? '✅ PASS' : '❌ FAIL'}`);
    for (const fg of fixedGenes) {
      const offering = courseOfferings.find(o => o.id === fg.offeringId);
      console.log(
        `    Offering ${fg.offeringId} (${offering?.course.code}): ` +
        `kind=${fg.kind} roomId(session0)=${fg.sessions[0]?.roomId ?? 'n/a'} (original=${offering?.roomId})`
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// LONG-SESSION DEMO — verify 3- and 4-slot contiguous blocks
// The seed timetable only allows 2-slot chains/day, so we run a
// dedicated scenario where the slot grid has 4 back-to-back hours
// per day. This is purely a CLI verification harness — no other
// part of the system depends on it.
// ═══════════════════════════════════════════════════════════════
console.log(`\n${DIVIDER}`);
console.log('  LONG-SESSION DEMO — 3 and 4 slot contiguous blocks');
console.log(DIVIDER);
console.log();

function buildLongSessionScenario(): {
  rooms: Room[];
  timeSlots: TimeSlot[];
  lecturers: Lecturer[];
  offerings: CourseOffering[];
} {
  const longRooms: Room[] = [
    { id: 1, name: 'R-101', capacity: 50, facilities: ['PROJECTOR'] },
    { id: 2, name: 'R-102', capacity: 50, facilities: ['PROJECTOR'] },
    { id: 3, name: 'LAB-A', capacity: 40, facilities: ['LAB', 'PROJECTOR'] },
  ];

  // 5 days × 4 hourly slots = 20 slots, all back-to-back within each day.
  // Slot IDs: Mon 1-4, Tue 5-8, Wed 9-12, Thu 13-16, Fri 17-20.
  const longTimeSlots: TimeSlot[] = [];
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const blockTimes = [
    { start: '08:00', end: '09:00' },
    { start: '09:00', end: '10:00' },
    { start: '10:00', end: '11:00' },
    { start: '11:00', end: '12:00' },
  ];
  let id = 1;
  for (const day of days) {
    for (const t of blockTimes) {
      longTimeSlots.push({ id: id++, day, startTime: t.start, endTime: t.end });
    }
  }

  const longLecturers: Lecturer[] = [
    { id: 1, name: 'Prof. Long', isStructural: false, preferredTimeSlotIds: [], competencies: ['core'] },
    { id: 2, name: 'Dr. Block',  isStructural: false, preferredTimeSlotIds: [], competencies: ['core'] },
    { id: 3, name: 'M. Span',    isStructural: false, preferredTimeSlotIds: [], competencies: ['lab'] },
  ];

  const longCourses = [
    { id: 1, code: 'LS301', name: 'Long Lecture (3-slot)',     sks: 3, requiredFacilities: [],      requiredCompetencies: ['core'] },
    { id: 2, code: 'LS401', name: 'Mega Workshop (4-slot)',    sks: 4, requiredFacilities: [],      requiredCompetencies: ['core'] },
    { id: 3, code: 'LS302', name: 'Lab Practicum (3-slot)',    sks: 3, requiredFacilities: ['LAB'], requiredCompetencies: ['lab'] },
  ];

  const longOfferings: CourseOffering[] = [
    {
      id: 101, courseId: 1, course: longCourses[0]!, roomId: 1,
      room: longRooms[0]!, lecturers: [longLecturers[0]!],
      effectiveStudentCount: 35, isFixed: false,
    },
    {
      id: 102, courseId: 2, course: longCourses[1]!, roomId: 2,
      room: longRooms[1]!, lecturers: [longLecturers[1]!],
      effectiveStudentCount: 40, isFixed: false,
    },
    {
      id: 103, courseId: 3, course: longCourses[2]!, roomId: 3,
      room: longRooms[2]!, lecturers: [longLecturers[2]!],
      effectiveStudentCount: 30, isFixed: false,
    },
  ];

  return { rooms: longRooms, timeSlots: longTimeSlots, lecturers: longLecturers, offerings: longOfferings };
}

const demo = buildLongSessionScenario();

console.log(`  Grid:      ${demo.timeSlots.length} slots (5 days × 4 back-to-back hours)`);
console.log(`  Offerings:`);
for (const o of demo.offerings) {
  console.log(`    • ${o.course.code} "${o.course.name}" → sks=${o.course.sks} (must occupy ${o.course.sks} contiguous hours)`);
}
console.log();

const realLog2 = console.log;
const realWarn2 = console.warn;
console.log = () => {};
console.warn = () => {};
const demoRun = await runPipeline({
  offerings: demo.offerings,
  timeSlots: demo.timeSlots,
  rooms: demo.rooms,
  lecturers: demo.lecturers,
  config: {
    populationSize: 60,
    generations: 150,
    mutationRate: 0.15,
    elitismCount: 2,
    tournamentSize: 3,
    crossoverType: 'uniform',
    noiseRate: 0.15,
    hardPenaltyWeight: 100,
    softPenaltyWeight: 1,
  },
});
console.log = realLog2;
console.warn = realWarn2;

const demoGA = demoRun.response.gaResult;
if (!demoGA) {
  console.log('  ❌ Demo aborted before GA — pre-GA or SSA blocked it.');
} else {
  console.log(`  Best Fitness:     ${demoGA.bestFitness.toFixed(4)}`);
  console.log(`  Hard Violations:  ${demoGA.hardViolations}`);
  console.log(`  Soft Penalty:     ${demoGA.softPenalty}`);
  console.log(`  Generations Run:  ${demoGA.generationsRun}`);
  console.log();

  const demoSlotLookup = new Map(demo.timeSlots.map(t => [t.id, t]));
  const demoRoomLookup = new Map(demo.rooms.map(r => [r.id, r]));
  const demoCandidates = demoRun.context.candidates;

  console.log('  📅 Best Schedule:');
  let demoNonContig = 0;
  let demoMismatch = 0;
  let demoLongest = 0;
  for (const gene of demoGA.bestChromosome) {
    const offering = demo.offerings.find(o => o.id === gene.offeringId);
    if (!offering) continue;
    const candidate = demoCandidates.find(c => c.offeringId === gene.offeringId);
    const expectedDuration = candidate?.sessionDuration ?? offering.course.sks;

    console.log(`    ${offering.course.code} "${offering.course.name}" (sks=${offering.course.sks})`);
    const lines = formatGeneLines(gene, demoSlotLookup, {
      expectedDuration,
      expectedSessions: candidate?.parallelSessionCount,
      roomLookup: demoRoomLookup,
      indent: '         ',
    });
    for (const line of lines) console.log(line);

    for (const s of gene.sessions) {
      if (s.timeSlotIds.length > demoLongest) demoLongest = s.timeSlotIds.length;
      if (!isContiguous(s.timeSlotIds, demoSlotLookup)) demoNonContig++;
      if (s.timeSlotIds.length !== expectedDuration) demoMismatch++;
      // Surface raw slot resolution to make the verification airtight:
      console.log(`           ↳ raw: [${s.timeSlotIds.join(',')}] = ${formatSession(s.timeSlotIds, demoSlotLookup)}`);
    }
  }

  console.log();
  console.log(`  📐 Verification:`);
  console.log(`    Longest contiguous block:  ${demoLongest} slot(s) ${demoLongest >= 4 ? '✅' : (demoLongest === 3 ? '✅ (3 ok)' : '❌')}`);
  console.log(`    Non-contiguous sessions:   ${demoNonContig} ${demoNonContig === 0 ? '✅' : '❌'}`);
  console.log(`    Duration mismatches:       ${demoMismatch} ${demoMismatch === 0 ? '✅' : '❌'}`);
  const ok = demoLongest >= 4 && demoNonContig === 0 && demoMismatch === 0;
  console.log(`    Long-session support:      ${ok ? '✅ VERIFIED end-to-end' : '⚠️  see warnings above'}`);
}

const totalDuration = Math.round(performance.now() - pipelineStart);

console.log(`\n${DIVIDER}`);
console.log('  PIPELINE COMPLETE');
console.log(DIVIDER);
console.log(`  Total Duration:    ${totalDuration}ms`);
console.log(`  Layer 3 (GA):      3 crossover runs above + 1 long-session demo`);
console.log(`\n  Architecture: All 3 layers operational. ✅\n`);
}

main().catch((err) => { console.error(err); process.exit(1); });
