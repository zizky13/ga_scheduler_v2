/**
 * CLI Runner — Layer 1: Pre-GA Validation
 * Tests all 6 checks + entity tagging with both feasible and infeasible offerings.
 */

import { courseOfferings, infeasibleOfferings, timeSlots, rooms } from '../db/seed.js';
import { runPreGA } from '../pre-ga/validator.js';

console.log('═══════════════════════════════════════════════════');
console.log('  LAYER 1: Pre-GA Policy Engine — Backbone Test');
console.log('═══════════════════════════════════════════════════\n');

// Include ALL infeasible offerings to test every rejection type
const allOfferings = [...courseOfferings, ...infeasibleOfferings];

console.log(`Input: ${allOfferings.length} offerings, ${timeSlots.length} time slots\n`);

const { validation, candidates } = runPreGA(allOfferings, timeSlots, rooms);

// ─── Print Results ───────────────────────────────────────────────
console.log('── Feasible Offerings ──────────────────────────────');
for (const offering of validation.feasible) {
  const parallelGroups = Math.ceil(offering.effectiveStudentCount / offering.room.capacity);
  console.log(
    `  ✅ ID=${offering.id} | ${offering.course.code} "${offering.course.name}" ` +
    `| Room: ${offering.room.name} | Students: ${offering.effectiveStudentCount} ` +
    `| Parallel: ${parallelGroups} × ${offering.course.sks} slot(s) | Fixed: ${offering.isFixed}`
  );
}

console.log('\n── Infeasible Offerings (Rejected) ─────────────────');
for (const { offering, failedCheck } of validation.infeasible) {
  console.log(
    `  ❌ ID=${offering.id} | ${offering.course.code} "${offering.course.name}" ` +
    `| Failed: [${failedCheck.code}] ${failedCheck.message}`
  );
}

console.log('\n── PreGA Candidates Built ──────────────────────────');
for (const c of candidates) {
  console.log(
    `  📋 Offering ${c.offeringId} | Room: ${c.roomId} ` +
    `| Lecturers: [${c.lecturerIds.join(', ')}] ` +
    `| Parallel: ${c.parallelSessionCount} × ${c.sessionDuration} slot(s) back-to-back ` +
    `| Possible Slots: ${c.possibleTimeSlotIds.length} ` +
    `| FixedRoom: ${c.isFixedRoom}`
  );
}

// ─── Entity Tagger Verification ──────────────────────────────────
const fixedCount = candidates.filter(c => c.isFixedRoom).length;
const flexibleCount = candidates.filter(c => !c.isFixedRoom).length;

console.log(`\n── Entity Tagger Summary ────────────────────────────`);
console.log(`  Fixed Room (isFixedRoom=true):    ${fixedCount}`);
console.log(`  Flexible (isFixedRoom=false):     ${flexibleCount}`);

console.log(`\n── Summary ─────────────────────────────────────────`);
console.log(`  Total Input:  ${allOfferings.length}`);
console.log(`  Feasible:     ${validation.feasible.length}`);
console.log(`  Infeasible:   ${validation.infeasible.length}`);
console.log(`  Candidates:   ${candidates.length}`);
console.log(`\n✅ Layer 1 backbone validated.\n`);
