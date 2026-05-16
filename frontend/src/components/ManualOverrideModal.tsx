import { useState, useMemo, useEffect } from 'react';
import { AlertTriangle, CheckCircle } from 'lucide-react';
import { Modal } from './Modal';
import { Button } from './Button';
import { useToastStore } from '../store/toastStore';
import { put } from '../lib/api';
import type { ApiRequestError } from '../lib/api';
import styles from './ManualOverrideModal.module.css';

/* ── Types ── */

export interface OverrideTarget {
  assignmentId: number;
  sessionIndex: number;
  courseCode: string;
  courseName: string;
  lecturerIds: number[];
  lecturerNames: string;
  currentRoomId: number;
  currentRoomName: string;
  currentDay: string;
  currentTimeRange: string;
  slotCount: number;
  manualOverride: boolean;
  currentSlotIds: number[];
}

interface TimeslotWire {
  id: number;
  day: string;
  startTime: string;
  endTime: string;
}

interface RoomOption {
  id: number;
  name: string;
  capacity: number;
}

export interface OtherSession {
  assignmentId: number;
  roomId: number;
  timeSlotIds: number[];
  lecturerIds: number[];
  courseCode: string;
}

export interface ManualOverrideModalProps {
  open: boolean;
  onClose: () => void;
  runId: string;
  target: OverrideTarget | null;
  otherSessions: OtherSession[];
  rooms: RoomOption[];
  timeslots: TimeslotWire[];
  onSaved: () => void;
}

/* ── Helpers ── */

const WEEKDAY_ORDER: Record<string, number> = {
  MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3, THURSDAY: 4, FRIDAY: 5, SATURDAY: 6, SUNDAY: 7,
};

function dayLabel(day: string): string {
  return day.charAt(0) + day.slice(1).toLowerCase();
}

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

/* ── Component ── */

export function ManualOverrideModal({
  open,
  onClose,
  runId,
  target,
  otherSessions,
  rooms,
  timeslots,
  onSaved,
}: ManualOverrideModalProps) {
  const addToast = useToastStore((s) => s.addToast);

  const [selectedRoomId, setSelectedRoomId] = useState<number>(0);
  const [selectedSlotIds, setSelectedSlotIds] = useState<Set<number>>(new Set());
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (target && open) {
      setSelectedRoomId(target.currentRoomId);
      setSelectedSlotIds(new Set(target.currentSlotIds));
      setReason('');
      setSaving(false);
    }
  }, [target, open]);

  const slotsByDay = useMemo(() => {
    const map = new Map<string, TimeslotWire[]>();
    for (const slot of timeslots) {
      if (!map.has(slot.day)) map.set(slot.day, []);
      map.get(slot.day)!.push(slot);
    }
    for (const slots of map.values()) {
      slots.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return [...map.entries()].sort(
      (a, b) => (WEEKDAY_ORDER[a[0]] ?? 99) - (WEEKDAY_ORDER[b[0]] ?? 99),
    );
  }, [timeslots]);

  const roomOptions = useMemo(
    () =>
      rooms
        .slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((r) => ({ value: String(r.id), label: `${r.name} (cap. ${r.capacity})` })),
    [rooms],
  );

  /* ── Conflict detection ── */

  const { roomConflicts, lecturerConflicts } = useMemo(() => {
    const rc: string[] = [];
    const lc: string[] = [];
    if (!target) return { roomConflicts: rc, lecturerConflicts: lc };

    const selectedArr = [...selectedSlotIds];

    for (const other of otherSessions) {
      const overlapping = other.timeSlotIds.filter((sid) => selectedArr.includes(sid));
      if (overlapping.length === 0) continue;

      if (other.roomId === selectedRoomId) {
        rc.push(other.courseCode);
      }

      if (target.lecturerIds.some((lid) => other.lecturerIds.includes(lid))) {
        lc.push(other.courseCode);
      }
    }

    return { roomConflicts: [...new Set(rc)], lecturerConflicts: [...new Set(lc)] };
  }, [target, selectedRoomId, selectedSlotIds, otherSessions]);

  const hasConflicts = roomConflicts.length > 0 || lecturerConflicts.length > 0;
  const hasChanges = target
    ? selectedRoomId !== target.currentRoomId ||
      !setsEqual(selectedSlotIds, new Set(target.currentSlotIds))
    : false;

  function toggleSlot(slotId: number) {
    setSelectedSlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) next.delete(slotId);
      else next.add(slotId);
      return next;
    });
  }

  /* ── Validation ── */

  function getValidationError(): string | null {
    if (!target) return 'No target selected';
    if (selectedSlotIds.size !== target.slotCount)
      return `Select exactly ${target.slotCount} time slot${target.slotCount > 1 ? 's' : ''}`;
    if (!hasChanges) return 'No changes made';
    if (reason.trim().length < 10) return 'Reason must be at least 10 characters';
    return null;
  }

  /* ── Save ── */

  async function handleSave() {
    if (!target) return;
    const err = getValidationError();
    if (err) {
      addToast({ type: 'warning', title: err });
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = { notes: reason.trim() };
      if (selectedRoomId !== target.currentRoomId) body.roomId = selectedRoomId;
      if (!setsEqual(selectedSlotIds, new Set(target.currentSlotIds))) {
        body.timeSlotIds = [...selectedSlotIds];
      }

      await put(`/schedule-runs/${runId}/assignments/${target.assignmentId}`, body);
      addToast({
        type: 'success',
        title: `Assignment for ${target.courseCode} has been overridden.`,
      });
      onSaved();
      onClose();
    } catch (error) {
      const e = error as ApiRequestError;
      if (e.code === 'ILLEGAL_STATE_TRANSITION') {
        addToast({ type: 'error', title: 'Cannot override', message: e.message });
      } else if (e.code === 'INVALID_REFERENCE') {
        addToast({ type: 'error', title: 'Invalid room or time slot', message: e.message });
      } else {
        addToast({ type: 'error', title: 'Override failed', message: e.message });
      }
    } finally {
      setSaving(false);
    }
  }

  if (!target) return null;

  const validationError = getValidationError();
  const roomChanged = selectedRoomId !== target.currentRoomId;
  const selectedRoom = rooms.find((r) => r.id === selectedRoomId);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit Assignment"
      size="lg"
      footer={
        <div className={styles.footer}>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || validationError !== null}
          >
            {saving ? 'Saving…' : 'Save Override'}
          </Button>
        </div>
      }
    >
      <p className={styles.subtitle}>
        {target.courseCode} — {target.courseName}
        {target.sessionIndex > 0 ? `, Session ${String.fromCharCode(65 + target.sessionIndex)}` : ''}
      </p>

      {/* ── Current Assignment Card ── */}
      <div className={styles.currentCard}>
        <div className={styles.currentInfo}>
          Currently assigned to <strong>{target.currentRoomName}</strong> on{' '}
          <strong>{target.currentDay}</strong>, <strong>{target.currentTimeRange}</strong>
        </div>
        <span
          className={`${styles.currentBadge} ${target.manualOverride ? styles.currentBadgeOverridden : ''}`}
        >
          {target.manualOverride ? 'Overridden' : 'Original'}
        </span>
      </div>

      {/* ── New Room ── */}
      <div className={styles.formSection}>
        <label className={styles.fieldLabel}>New Room</label>
        <select
          className={`${styles.roomSelect} ${roomChanged ? styles.roomSelectChanged : ''}`}
          value={String(selectedRoomId)}
          onChange={(e) => setSelectedRoomId(Number(e.target.value))}
        >
          {roomOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        {roomChanged && selectedRoom && (
          <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-primary-600)', marginTop: 4 }}>
            Changed from {target.currentRoomName} → {selectedRoom.name}
          </p>
        )}
      </div>

      {/* ── New Time Slots ── */}
      <div className={styles.formSection}>
        <label className={styles.fieldLabel}>
          New Time Slots
          <span className={styles.slotCounter}>
            {selectedSlotIds.size} / {target.slotCount} selected
          </span>
        </label>
        <div className={styles.slotsGrid}>
          {slotsByDay.map(([day, slots]) => (
            <div key={day} className={styles.dayGroup}>
              <p className={styles.dayLabel}>{dayLabel(day)}</p>
              <div className={styles.daySlots}>
                {slots.map((slot) => {
                  const isSelected = selectedSlotIds.has(slot.id);
                  const isCurrent = target.currentSlotIds.includes(slot.id);
                  return (
                    <label
                      key={slot.id}
                      className={`${styles.slotCheckbox} ${isSelected ? styles.slotSelected : ''} ${isCurrent && !isSelected ? styles.slotOriginal : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSlot(slot.id)}
                      />
                      <span className={styles.slotTime}>
                        {slot.startTime} – {slot.endTime}
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        {selectedSlotIds.size !== target.slotCount && selectedSlotIds.size > 0 && (
          <p className={styles.slotWarning}>
            This session requires exactly {target.slotCount} time slot
            {target.slotCount > 1 ? 's' : ''} — you have {selectedSlotIds.size} selected.
          </p>
        )}
      </div>

      {/* ── Reason ── */}
      <div className={styles.formSection}>
        <label className={styles.fieldLabel}>
          Reason <span className={styles.required}>*</span>
        </label>
        <textarea
          className={styles.textarea}
          placeholder="e.g., Room conflict with external event"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        {reason.length > 0 && reason.trim().length < 10 && (
          <p className={styles.fieldError}>Minimum 10 characters required.</p>
        )}
      </div>

      {/* ── Conflict Detection ── */}
      {hasChanges && (
        <div className={styles.conflictSection}>
          {roomConflicts.length > 0 && (
            <div className={`${styles.conflictBanner} ${styles.conflictWarning}`}>
              <AlertTriangle size={16} />
              <span>
                Room conflict: {selectedRoom?.name ?? 'Selected room'} is already
                assigned to {roomConflicts.join(', ')} at overlapping times.
              </span>
            </div>
          )}
          {lecturerConflicts.length > 0 && (
            <div className={`${styles.conflictBanner} ${styles.conflictWarning}`}>
              <AlertTriangle size={16} />
              <span>
                Lecturer conflict: {target.lecturerNames} already{' '}
                {lecturerConflicts.length === 1 ? 'has' : 'have'}{' '}
                {lecturerConflicts.join(', ')} at overlapping times.
              </span>
            </div>
          )}
          {!hasConflicts && (
            <div className={`${styles.conflictBanner} ${styles.conflictSuccess}`}>
              <CheckCircle size={16} />
              <span>No scheduling conflicts detected.</span>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
