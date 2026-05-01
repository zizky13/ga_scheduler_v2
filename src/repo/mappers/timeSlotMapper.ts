/**
 * TimeSlot mapper — Prisma `time_slots` row to `src/types.ts:TimeSlot`.
 *
 * The Prisma `Weekday` enum (`MONDAY`, `TUESDAY`, ...) is translated back to
 * the title-case strings (`'Monday'`, `'Tuesday'`, ...) that the GA core has
 * always consumed.
 */

import type { TimeSlot } from '../../types';

/** Hand-rolled row shape — Prisma-import-free. */
export interface TimeSlotRow {
  id: number;
  /** Prisma `Weekday` enum value: 'MONDAY' | 'TUESDAY' | ... */
  day: string;
  startTime: string;
  endTime: string;
}

const WEEKDAY_TO_STRING: Record<string, string> = {
  MONDAY: 'Monday',
  TUESDAY: 'Tuesday',
  WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday',
  FRIDAY: 'Friday',
  SATURDAY: 'Saturday',
  SUNDAY: 'Sunday',
};

/**
 * Translates the Prisma `Weekday` enum value to the title-case string form
 * used by `src/types.ts:TimeSlot.day`. Throws on any value not in the enum.
 */
export function weekdayToString(day: string): string {
  const out = WEEKDAY_TO_STRING[day];
  if (out === undefined) {
    throw new Error(
      `Unrecognized Weekday enum value: ${JSON.stringify(day)}. ` +
        `Expected one of MONDAY..SUNDAY.`,
    );
  }
  return out;
}

export function mapTimeSlotRow(row: TimeSlotRow): TimeSlot {
  return {
    id: row.id,
    day: weekdayToString(row.day),
    startTime: row.startTime,
    endTime: row.endTime,
  };
}
