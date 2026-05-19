/**
 * Layer 1 (Pre-GA) competency check unit tests — techspec §10.1.
 *
 * Backlog Phase 0 / Task 7: Add Layer 1 unit tests covering all eight
 * `checkCompetencies` scenarios (eligible, ineligible, empty
 * `requiredCompetencies`, team-teaching with one ineligible co-lecturer, etc.).
 *
 * Each `it` exercises a distinct branch of `checkCompetencies` and, transitively,
 * `isLecturerEligibleForCourse` (src/pre-ga/checks.ts).
 */

import { describe, it, expect } from 'vitest';
import { checkCompetencies } from '../../src/pre-ga/checks.js';
import type { CourseOffering, Lecturer, Course, Room } from '../../src/types.js';

// ─── Fixture helper ──────────────────────────────────────────────
// Builds a minimal-but-valid CourseOffering so each test only specifies the
// two relevant inputs: `requiredCompetencies` and `lecturers`.
function buildOffering(args: {
  requiredCompetencies: string[];
  lecturers: Lecturer[];
}): CourseOffering {
  const room: Room = {
    id: 1,
    name: 'R-101',
    capacity: 30,
    facilities: [],
  };
  const course: Course = {
    id: 10,
    code: 'CS101',
    name: 'Test Course',
    sks: 3,
    requiredFacilities: [],
    requiredCompetencies: args.requiredCompetencies,
  };
  return {
    id: 100,
    courseId: course.id,
    course,
    roomId: room.id,
    room,
    lecturers: args.lecturers,
    effectiveStudentCount: 25,
    isFixed: false,
  };
}

function buildLecturer(id: number, name: string, competencies: string[]): Lecturer {
  return {
    id,
    name,
    isStructural: false,
    maxSks: 12,
    preferredTimeSlotIds: [],
    competencies,
  };
}

// ─── Tests ───────────────────────────────────────────────────────

describe('checkCompetencies (techspec §10.1)', () => {
  it('Scenario 1: single eligible lecturer with exact single-match passes', () => {
    const offering = buildOffering({
      requiredCompetencies: ['ai-ml'],
      lecturers: [buildLecturer(1, 'Dr. Alice', ['ai-ml'])],
    });
    const result = checkCompetencies(offering);
    expect(result.passed).toBe(true);
    expect(result.code).toBe('OK');
  });

  it('Scenario 2: single lecturer matching one of multiple required competencies passes (>=1 rule)', () => {
    const offering = buildOffering({
      requiredCompetencies: ['ai-ml', 'databases'],
      lecturers: [buildLecturer(1, 'Dr. Alice', ['databases'])],
    });
    const result = checkCompetencies(offering);
    expect(result.passed).toBe(true);
    expect(result.code).toBe('OK');
  });

  it('Scenario 3: single ineligible lecturer with no overlap fails with COMPETENCY_MISMATCH', () => {
    const offering = buildOffering({
      requiredCompetencies: ['ai-ml'],
      lecturers: [buildLecturer(1, 'Dr. Alice', ['networking'])],
    });
    const result = checkCompetencies(offering);
    expect(result.passed).toBe(false);
    expect(result.code).toBe('COMPETENCY_MISMATCH');
    expect(result.message).toContain('Dr. Alice');
    expect(result.message).toContain('ai-ml');
  });

  it('Scenario 4: open assignment (empty requiredCompetencies) with non-empty lecturer competencies passes', () => {
    const offering = buildOffering({
      requiredCompetencies: [],
      lecturers: [buildLecturer(1, 'Dr. Alice', ['anything'])],
    });
    const result = checkCompetencies(offering);
    expect(result.passed).toBe(true);
    expect(result.code).toBe('OK');
  });

  it('Scenario 5: open assignment with empty lecturer competencies still passes', () => {
    const offering = buildOffering({
      requiredCompetencies: [],
      lecturers: [buildLecturer(1, 'Dr. Alice', [])],
    });
    const result = checkCompetencies(offering);
    expect(result.passed).toBe(true);
    expect(result.code).toBe('OK');
  });

  it('Scenario 6: team-teaching with all lecturers eligible passes (loop completes)', () => {
    const offering = buildOffering({
      requiredCompetencies: ['ai-ml'],
      lecturers: [
        buildLecturer(1, 'Dr. Alice', ['ai-ml']),
        buildLecturer(2, 'Dr. Bob', ['ai-ml', 'databases']),
      ],
    });
    const result = checkCompetencies(offering);
    expect(result.passed).toBe(true);
    expect(result.code).toBe('OK');
  });

  it('Scenario 7: team-teaching with eligible first and ineligible second fails on second lecturer', () => {
    const offering = buildOffering({
      requiredCompetencies: ['ai-ml'],
      lecturers: [
        buildLecturer(1, 'Dr. Alice', ['ai-ml']),
        buildLecturer(2, 'Dr. Bob', ['networking']),
      ],
    });
    const result = checkCompetencies(offering);
    expect(result.passed).toBe(false);
    expect(result.code).toBe('COMPETENCY_MISMATCH');
    expect(result.message).toContain('Dr. Bob');
    expect(result.message).not.toContain('Dr. Alice');
  });

  it('Scenario 8: team-teaching with ineligible first short-circuits before examining second', () => {
    const offering = buildOffering({
      requiredCompetencies: ['ai-ml'],
      lecturers: [
        buildLecturer(1, 'Dr. Alice', ['networking']),
        buildLecturer(2, 'Dr. Bob', ['ai-ml']),
      ],
    });
    const result = checkCompetencies(offering);
    expect(result.passed).toBe(false);
    expect(result.code).toBe('COMPETENCY_MISMATCH');
    expect(result.message).toContain('Dr. Alice');
    expect(result.message).not.toContain('Dr. Bob');
  });
});
