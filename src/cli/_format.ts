/**
 * Shared CLI presentation helpers for the new nested-session chromosome shape.
 *
 * The chromosome stores sessions as an array per gene (one entry per parallel
 * group), with each session owning a contiguous block of `timeSlotIds`. The
 * CLI runners format these blocks as compact human-readable ranges
 * ("Mon 08:00-11:00 (3 slots)") and surface enough metadata for a reviewer
 * to verify long-session support end-to-end.
 */

import type { Gene, Room, TimeSlot } from '../types.js';

// ─── Slot-block formatting ───────────────────────────────────────

const DAY_ABBR: Record<string, string> = {
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
  Sunday: 'Sun',
};

function abbrevDay(day: string): string {
  return DAY_ABBR[day] ?? day.slice(0, 3);
}

/**
 * A run of slot IDs is contiguous when every adjacent pair shares the same
 * day and the previous slot's `endTime` equals the next slot's `startTime`.
 * The chromosome guarantees this via `findContiguousSlots`, but the CLI
 * verifies independently so a malformed gene is flagged in the output.
 */
export function isContiguous(slotIds: number[], lookup: Map<number, TimeSlot>): boolean {
  if (slotIds.length <= 1) return true;
  for (let i = 1; i < slotIds.length; i++) {
    const prev = lookup.get(slotIds[i - 1]!);
    const curr = lookup.get(slotIds[i]!);
    if (!prev || !curr) return false;
    if (prev.day !== curr.day) return false;
    if (prev.endTime !== curr.startTime) return false;
  }
  return true;
}

/**
 * Render a session's slots as a compact range when contiguous, or as a
 * comma-separated fallback list when not (which signals the GA produced a
 * broken block and the reviewer should investigate).
 */
export function formatSession(slotIds: number[], lookup: Map<number, TimeSlot>): string {
  if (slotIds.length === 0) return '(no slots)';

  const resolved = slotIds.map(id => lookup.get(id));
  if (resolved.some(s => !s)) {
    return `[${slotIds.map(id => `#${id}`).join(', ')}] (unresolved)`;
  }
  const slots = resolved as TimeSlot[];

  if (slotIds.length === 1) {
    const s = slots[0]!;
    return `${abbrevDay(s.day)} ${s.startTime}-${s.endTime} (1 slot)`;
  }

  if (isContiguous(slotIds, lookup)) {
    const first = slots[0]!;
    const last = slots[slots.length - 1]!;
    return `${abbrevDay(first.day)} ${first.startTime}-${last.endTime} (${slotIds.length} slots)`;
  }

  const parts = slots.map(s => `${abbrevDay(s.day)} ${s.startTime}`);
  return `NON-CONTIGUOUS [${parts.join(', ')}]`;
}

// ─── Gene-level formatting ───────────────────────────────────────

export interface GeneFormatOptions {
  expectedDuration?: number;
  expectedSessions?: number;
  /** Optional room registry for resolving roomId → name. */
  roomLookup?: Map<number, Room>;
  /** Indent prefix for printed lines. */
  indent?: string;
}

/**
 * Multi-line gene rendering — one line per parallel session so contiguous
 * blocks read naturally. Returns the formatted lines (caller is responsible
 * for printing). Includes a "duration mismatch" annotation when the actual
 * block length disagrees with `expectedDuration` from the PreGACandidate.
 */
export function formatGeneLines(gene: Gene, lookup: Map<number, TimeSlot>, opts: GeneFormatOptions = {}): string[] {
  const { expectedDuration, expectedSessions, roomLookup, indent = '' } = opts;
  const out: string[] = [];

  const sessionMismatch =
    expectedSessions !== undefined && gene.sessions.length !== expectedSessions;
  const sessionTag = sessionMismatch
    ? ` (got ${gene.sessions.length}, expected ${expectedSessions})`
    : '';

  if (gene.sessions.length === 0) {
    out.push(`${indent}(no sessions)${sessionTag}`);
    return out;
  }

  for (let i = 0; i < gene.sessions.length; i++) {
    const session = gene.sessions[i]!;
    const room = roomLookup?.get(session.roomId);
    const roomLabel = room ? room.name : `Room#${session.roomId}`;
    const slotsText = formatSession(session.timeSlotIds, lookup);

    const durationMismatch =
      expectedDuration !== undefined && session.timeSlotIds.length !== expectedDuration;
    const durationTag = durationMismatch
      ? ` ⚠ expected ${expectedDuration} slot${expectedDuration === 1 ? '' : 's'}`
      : '';

    const groupTag = gene.sessions.length > 1 ? ` group ${i + 1}/${gene.sessions.length}` : '';
    out.push(`${indent}${roomLabel} ▸ ${slotsText}${groupTag}${durationTag}`);
  }

  if (sessionMismatch) {
    out[0] = `${out[0]}${sessionTag}`;
  }

  return out;
}
