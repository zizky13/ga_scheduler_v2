/**
 * SSA — AC-3 Constraint Propagation
 * 
 * Prunes time slot domains before Hopcroft-Karp runs.
 * A slot is removed from a session's domain if that slot is
 * exclusively forced by another session sharing the same resource.
 */

import type { BipartiteGraph, SessionNode, AC3Result } from '../types.js';

export function runAC3(graph: BipartiteGraph): AC3Result {
  const { sessions, adjacency } = graph;

  // Build room → sessions index. Skip sessions whose roomId is null:
  // those have a free room variable (domain = possibleRoomIds, evaluated
  // by Layer 3), not a fixed assignment that could conflict here. Grouping
  // them under "null" would propagate spurious shared-room constraints
  // (null === null would falsely mark every unlocked offering as colliding).
  //
  // note (Phase 11 task #10 — sibling-session audit, OQ-19): for a null-room
  // overflow offering, every emitted sibling SessionNode carries `roomId: null`,
  // so the guard below correctly skips them — they don't get a spurious
  // shared-room self-conflict.
  const roomToSessions = new Map<number, SessionNode[]>();
  for (const session of sessions) {
    if (session.roomId === null) continue;
    if (!roomToSessions.has(session.roomId)) {
      roomToSessions.set(session.roomId, []);
    }
    roomToSessions.get(session.roomId)!.push(session);
  }

  // Build lecturer → sessions index
  const lecturerToSessions = new Map<number, SessionNode[]>();
  for (const session of sessions) {
    for (const lecturerId of session.lecturerIds) {
      if (!lecturerToSessions.has(lecturerId)) {
        lecturerToSessions.set(lecturerId, []);
      }
      lecturerToSessions.get(lecturerId)!.push(session);
    }
  }

  // Build worklist: pairs of sessions that share a resource
  const worklist: Array<[number, number]> = [];
  const addedPairs = new Set<string>();
  const isSiblingSessionPair = (a: SessionNode, b: SessionNode): boolean =>
    a.offeringId === b.offeringId && a.sessionIndex !== b.sessionIndex;

  function addPair(a: number, b: number) {
    const key = `${a}-${b}`;
    if (!addedPairs.has(key)) {
      addedPairs.add(key);
      worklist.push([a, b]);
    }
  }

  for (const [, roomSessions] of roomToSessions) {
    for (let i = 0; i < roomSessions.length; i++) {
      for (let j = i + 1; j < roomSessions.length; j++) {
        addPair(roomSessions[i]!.sessionId, roomSessions[j]!.sessionId);
        addPair(roomSessions[j]!.sessionId, roomSessions[i]!.sessionId);
      }
    }
  }

  for (const [, lecSessions] of lecturerToSessions) {
    for (let i = 0; i < lecSessions.length; i++) {
      for (let j = i + 1; j < lecSessions.length; j++) {
        // note (Phase 15 task #12 / OQ-26): sibling sessions of the same
        // cohort may end up with different per-session lecturers in the GA.
        // SSA only proves the cohort can be scheduled under some distribution
        // of its lecturerPool, so it must not hard-propagate a shared-lecturer
        // constraint between sibling sessions. Cross-cohort lecturer overlap
        // remains a real hard constraint and is still propagated.
        if (isSiblingSessionPair(lecSessions[i]!, lecSessions[j]!)) continue;
        addPair(lecSessions[i]!.sessionId, lecSessions[j]!.sessionId);
        addPair(lecSessions[j]!.sessionId, lecSessions[i]!.sessionId);
      }
    }
  }

  // Session lookup
  const sessionMap = new Map(sessions.map(s => [s.sessionId, s]));

  // Process worklist
  while (worklist.length > 0) {
    const [xi, xj] = worklist.pop()!;
    const domainI = adjacency.get(xi);
    const domainJ = adjacency.get(xj);

    if (!domainI || !domainJ) continue;

    const sessionI = sessionMap.get(xi)!;
    const sessionJ = sessionMap.get(xj)!;

    // Determine constraint. Two sessions share a room only when both have
    // a concrete (non-null) roomId that matches — null roomIds are free
    // CSP variables, not shared resources (see roomToSessions guard above).
    const shareRoom =
      sessionI.roomId !== null &&
      sessionJ.roomId !== null &&
      sessionI.roomId === sessionJ.roomId;
    const enforceLecturerConstraint = !isSiblingSessionPair(sessionI, sessionJ);
    const sharedLecturers = enforceLecturerConstraint
      ? sessionI.lecturerIds.filter(id => sessionJ.lecturerIds.includes(id))
      : [];
    const hasConstraint = shareRoom || sharedLecturers.length > 0;
    if (!hasConstraint) continue;

    // For each value in domain(xi), check consistency with domain(xj)
    const toRemove: number[] = [];

    for (const slot of domainI) {
      // A slot is inconsistent if xj has ONLY this slot in its domain
      const hasConsistentValue =
        domainJ.size > 1 || (domainJ.size === 1 && !domainJ.has(slot));

      if (!hasConsistentValue) {
        if (domainJ.size === 1 && domainJ.has(slot)) {
          toRemove.push(slot);
        }
      }
    }

    if (toRemove.length > 0) {
      for (const slot of toRemove) {
        domainI.delete(slot);
      }

      if (domainI.size === 0) {
        return {
          consistent: false,
          emptyDomainSessionId: xi,
          emptyDomainOfferingId: sessionI.offeringId,
          reason:
            `TEMPORAL_DEADLOCK: Offering ${sessionI.offeringId} session ${sessionI.sessionIndex} ` +
            `has no available time slots after constraint propagation. ` +
            `All slots are exclusively needed by conflicting sessions.`,
        };
      }

      // Domain revised — re-add related arcs. Null-roomId sessions never
      // landed in roomToSessions, so the get() returns undefined for them
      // and contributes no spurious neighbours.
      const relatedSessions = [
        ...(sessionI.roomId !== null ? (roomToSessions.get(sessionI.roomId) ?? []) : []),
        ...sessionI.lecturerIds
          .flatMap(id => lecturerToSessions.get(id) ?? [])
          .filter(s => !isSiblingSessionPair(sessionI, s)),
      ].filter(s => s.sessionId !== xi);

      for (const related of relatedSessions) {
        worklist.push([related.sessionId, xi]);
      }
    }
  }

  return { consistent: true };
}
