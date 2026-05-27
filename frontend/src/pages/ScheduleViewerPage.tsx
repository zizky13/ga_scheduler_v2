import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import {
  CalendarDays,
  Download,
  Printer,
  FileSpreadsheet,
  FileText,
} from 'lucide-react';
import { PageHeader } from '../components/ContentArea';
import { Button } from '../components/Button';
import { TimetableGrid, GRID_COL_OFFSET, GRID_ROW_OFFSET } from '../components/TimetableGrid';
import { CourseBlock, getCategoryForCompetencies } from '../components/CourseBlock';
import { ManualOverrideModal } from '../components/ManualOverrideModal';
import type { OverrideTarget, OtherSession } from '../components/ManualOverrideModal';
import type { GridDensity } from '../components/TimetableGrid';
import { useToastStore } from '../store/toastStore';
import { useAuthStore } from '../store/authStore';
import { get } from '../lib/api';
import type { ListResponse } from '../lib/api';
import styles from './ScheduleViewerPage.module.css';

/* ── Types ── */

type RunStatus = 'COMPLETED' | 'STAGNATED';

interface RunSummary {
  id: string;
  status: string;
  bestFitness: number;
  hardViolations: number;
  softPenalty: number;
  generationsRun: number;
  durationMs: number | null;
  completedAt: string | null;
  createdAt: string;
}

interface TimeSlotInfo {
  id: number;
  day: string;
  startTime: string;
  endTime: string;
}

interface SessionWire {
  assignmentId: number;
  sessionIndex: number;
  roomId: number;
  isFixedRoom: boolean;
  manualOverride: boolean;
  lecturerIds: number[];
  timeSlots: TimeSlotInfo[];
}

interface GroupedAssignmentWire {
  offeringId: number;
  offering: {
    id: number;
    courseCode: string;
    courseName: string;
    lecturers: Array<{ id: number; name: string }>;
  };
  sessions: SessionWire[];
}

interface RunDetail {
  id: string;
  status: string;
  createdById: number;
  bestFitness: number;
  hardViolations: number;
  softPenalty: number;
  generationsRun: number;
  durationMs: number | null;
  completedAt: string | null;
  createdAt: string;
  assignments: GroupedAssignmentWire[];
}

interface TimeslotFull {
  id: number;
  day: string;
  startTime: string;
  endTime: string;
}

interface RoomWire {
  id: number;
  name: string;
  capacity: number;
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'] as const;
const VIEWABLE_STATUSES: RunStatus[] = ['COMPLETED', 'STAGNATED'];

const WEEKDAY_MAP: Record<string, string> = {
  MONDAY: 'Monday', TUESDAY: 'Tuesday', WEDNESDAY: 'Wednesday',
  THURSDAY: 'Thursday', FRIDAY: 'Friday', SATURDAY: 'Saturday', SUNDAY: 'Sunday',
};

function normalizeDay(day: string): string {
  return WEEKDAY_MAP[day] ?? day;
}

/* ── Helpers ── */

function formatRunLabel(run: RunSummary): string {
  const d = new Date(run.completedAt ?? run.createdAt);
  const date = d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  return `${date} — Fitness: ${run.bestFitness.toFixed(4)} — ${run.status}`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/* ── Component ── */

export function ScheduleViewerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const currentUser = useAuthStore((s) => s.user);

  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>(searchParams.get('runId') ?? '');
  const [runDetail, setRunDetail] = useState<RunDetail | null>(null);
  const [rooms, setRooms] = useState<RoomWire[]>([]);
  const [allTimeslots, setAllTimeslots] = useState<TimeslotFull[]>([]);

  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  const [density, setDensity] = useState<GridDensity>('comfortable');
  const [filterRoom, setFilterRoom] = useState('');
  const [filterLecturer, setFilterLecturer] = useState('');
  const [filterDay, setFilterDay] = useState('');
  const [filterCourse, setFilterCourse] = useState('');

  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Override modal
  const [overrideTarget, setOverrideTarget] = useState<OverrideTarget | null>(null);
  const [overrideModalOpen, setOverrideModalOpen] = useState(false);

  /* ── Close export dropdown on outside click ── */

  useEffect(() => {
    if (!exportOpen) return;
    function handleClick(e: MouseEvent) {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [exportOpen]);

  /* ── Fetch available runs ── */

  const fetchRuns = useCallback(async () => {
    setLoading(true);
    try {
      const results: RunSummary[] = [];
      for (const status of VIEWABLE_STATUSES) {
        const res = await get<ListResponse<RunSummary>>('/schedule-runs', {
          status,
          page: 1,
          pageSize: 100,
          sort: '-completedAt',
        });
        results.push(...res.data);
      }
      results.sort((a, b) => {
        const da = new Date(a.completedAt ?? a.createdAt).getTime();
        const db = new Date(b.completedAt ?? b.createdAt).getTime();
        return db - da;
      });
      setRuns(results);

      const qRunId = searchParams.get('runId');
      if (qRunId && results.some((r) => r.id === qRunId)) {
        setSelectedRunId(qRunId);
      } else if (results.length > 0 && !selectedRunId) {
        setSelectedRunId(results[0].id);
      }
    } catch {
      addToast({ type: 'error', title: 'Failed to load runs', message: 'Could not fetch completed schedule runs.' });
    } finally {
      setLoading(false);
    }
  }, [addToast, searchParams, selectedRunId]);

  useEffect(() => {
    fetchRuns();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── Fetch rooms and timeslots ── */

  useEffect(() => {
    get<ListResponse<RoomWire>>('/rooms', { page: 1, pageSize: 500 })
      .then((res) => setRooms(res.data))
      .catch(() => {});
    get<ListResponse<TimeslotFull>>('/timeslots', { page: 1, pageSize: 500 })
      .then((res) => setAllTimeslots(res.data))
      .catch(() => {});
  }, []);

  /* ── Fetch run detail when selection changes ── */

  useEffect(() => {
    if (!selectedRunId) {
      setRunDetail(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    get<RunDetail>(`/schedule-runs/${selectedRunId}`)
      .then((data) => {
        if (!cancelled) setRunDetail(data);
      })
      .catch(() => {
        if (!cancelled) addToast({ type: 'error', title: 'Failed to load schedule', message: 'Could not load run details.' });
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedRunId, addToast]);

  /* ── Sync runId to URL ── */

  const handleRunChange = useCallback((runId: string) => {
    setSelectedRunId(runId);
    setSearchParams(runId ? { runId } : {}, { replace: true });
  }, [setSearchParams]);

  /* ── Room lookup map ── */

  const roomMap = useMemo(() => {
    const m = new Map<number, RoomWire>();
    for (const r of rooms) m.set(r.id, r);
    return m;
  }, [rooms]);

  /* ── Derive time labels from assignments ── */

  const timeLabels = useMemo(() => {
    if (!runDetail) return [];
    const times = new Set<string>();
    for (const group of runDetail.assignments) {
      for (const session of group.sessions) {
        for (const slot of session.timeSlots) {
          times.add(slot.startTime);
        }
      }
    }
    return [...times].sort();
  }, [runDetail]);

  /* ── Build startTime → row index map ── */

  const startTimeToRow = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < timeLabels.length; i++) {
      m.set(timeLabels[i], i);
    }
    return m;
  }, [timeLabels]);

  /* ── Derive active days from assignments ── */

  const activeDays = useMemo(() => {
    if (!runDetail) return [...DAYS];
    const daySet = new Set<string>();
    for (const group of runDetail.assignments) {
      for (const session of group.sessions) {
        for (const slot of session.timeSlots) {
          daySet.add(normalizeDay(slot.day));
        }
      }
    }
    return DAYS.filter((d) => daySet.has(d));
  }, [runDetail]);

  /* ── Derive unique rooms and lecturers for filter dropdowns ── */

  const { uniqueRoomIds, uniqueLecturers } = useMemo(() => {
    const rIds = new Set<number>();
    const lecs = new Map<number, string>();
    if (runDetail) {
      for (const group of runDetail.assignments) {
        for (const lec of group.offering.lecturers) lecs.set(lec.id, lec.name);
        for (const session of group.sessions) rIds.add(session.roomId);
      }
    }
    return {
      uniqueRoomIds: [...rIds].sort((a, b) => {
        const nameA = roomMap.get(a)?.name ?? '';
        const nameB = roomMap.get(b)?.name ?? '';
        return nameA.localeCompare(nameB);
      }),
      uniqueLecturers: [...lecs.entries()].sort((a, b) => a[1].localeCompare(b[1])),
    };
  }, [runDetail, roomMap]);

  /* ── Filter logic ── */

  const isBlockFiltered = useCallback((group: GroupedAssignmentWire, session: SessionWire): boolean => {
    if (filterRoom && session.roomId !== Number(filterRoom)) return true;
    if (filterLecturer && !group.offering.lecturers.some((l) => l.id === Number(filterLecturer))) return true;
    if (filterDay && !session.timeSlots.some((s) => normalizeDay(s.day) === filterDay)) return true;
    if (filterCourse && !group.offering.courseCode.toLowerCase().includes(filterCourse.toLowerCase())
      && !group.offering.courseName.toLowerCase().includes(filterCourse.toLowerCase())) return true;
    return false;
  }, [filterRoom, filterLecturer, filterDay, filterCourse]);

  const hasActiveFilters = !!(filterRoom || filterLecturer || filterDay || filterCourse);

  /* ── Override permission ── */

  const canOverride = useMemo(() => {
    if (!runDetail || !currentUser) return false;
    const isAdmin = currentUser.role === 'ADMIN';
    const isOwner = String(runDetail.createdById) === currentUser.id;
    if (isAdmin) return runDetail.status === 'COMPLETED' || runDetail.status === 'STAGNATED';
    if (isOwner) return runDetail.status === 'COMPLETED';
    return false;
  }, [runDetail, currentUser]);

  function handleBlockClick(group: GroupedAssignmentWire, session: SessionWire) {
    if (!canOverride) return;
    const sortedSlots = [...session.timeSlots].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const firstSlot = sortedSlots[0];
    const lastSlot = sortedSlots[sortedSlots.length - 1];
    const room = roomMap.get(session.roomId);

    setOverrideTarget({
      assignmentId: session.assignmentId,
      sessionIndex: session.sessionIndex,
      courseCode: group.offering.courseCode,
      courseName: group.offering.courseName,
      lecturerIds: group.offering.lecturers.map((l) => l.id),
      lecturerNames: group.offering.lecturers.map((l) => l.name).join(', '),
      currentRoomId: session.roomId,
      currentRoomName: room?.name ?? `Room ${session.roomId}`,
      currentDay: normalizeDay(firstSlot.day),
      currentTimeRange: `${firstSlot.startTime} – ${lastSlot.endTime}`,
      slotCount: sortedSlots.length,
      manualOverride: session.manualOverride,
      currentSlotIds: sortedSlots.map((s) => s.id),
    });
    setOverrideModalOpen(true);
  }

  const otherSessions: OtherSession[] = useMemo(() => {
    if (!runDetail || !overrideTarget) return [];
    const result: OtherSession[] = [];
    for (const group of runDetail.assignments) {
      for (const session of group.sessions) {
        if (session.assignmentId === overrideTarget.assignmentId) continue;
        result.push({
          assignmentId: session.assignmentId,
          roomId: session.roomId,
          timeSlotIds: session.timeSlots.map((s) => s.id),
          lecturerIds: group.offering.lecturers.map((l) => l.id),
          courseCode: group.offering.courseCode,
        });
      }
    }
    return result;
  }, [runDetail, overrideTarget]);

  function handleOverrideSaved() {
    if (selectedRunId) {
      setDetailLoading(true);
      get<RunDetail>(`/schedule-runs/${selectedRunId}`)
        .then((data) => setRunDetail(data))
        .catch(() => addToast({ type: 'error', title: 'Failed to refresh schedule' }))
        .finally(() => setDetailLoading(false));
    }
  }

  /* ── CSV Export ── */

  const handleExportCSV = useCallback(() => {
    if (!runDetail) return;
    const rows: string[][] = [['Day', 'Time Start', 'Time End', 'Course Code', 'Course Name', 'Room', 'Lecturer(s)', 'Session']];

    for (const group of runDetail.assignments) {
      for (const session of group.sessions) {
        if (hasActiveFilters && isBlockFiltered(group, session)) continue;
        const lecturers = group.offering.lecturers.map((l) => l.name).join('; ');
        const room = roomMap.get(session.roomId);
        const roomName = room?.name ?? `Room ${session.roomId}`;
        const sortedSlots = [...session.timeSlots].sort((a, b) => a.startTime.localeCompare(b.startTime));
        const firstSlot = sortedSlots[0];
        const lastSlot = sortedSlots[sortedSlots.length - 1];
        rows.push([
          normalizeDay(firstSlot.day),
          firstSlot.startTime,
          lastSlot.endTime,
          group.offering.courseCode,
          group.offering.courseName,
          roomName,
          lecturers,
          group.sessions.length > 1 ? String.fromCharCode(65 + session.sessionIndex) : '',
        ]);
      }
    }

    const csv = rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-${runDetail.id.slice(0, 8)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
    addToast({ type: 'success', title: 'Exported', message: 'Schedule exported as CSV.' });
  }, [runDetail, roomMap, hasActiveFilters, isBlockFiltered, addToast]);

  /* ── Print ── */

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  /* ── Render: loading state ── */

  if (loading) return <ScheduleSkeleton />;

  /* ── Render: empty state ── */

  if (runs.length === 0) {
    return (
      <>
        <PageHeader title="Schedule" description="View the generated timetable." />
        <div className={styles.emptyState}>
          <CalendarDays size={48} className={styles.emptyIcon} aria-hidden="true" />
          <h2 className={styles.emptyTitle}>No schedule generated yet</h2>
          <p className={styles.emptyDescription}>Run the scheduler first to generate a timetable.</p>
          <Button variant="primary" onClick={() => navigate('/runs')}>
            Go to Schedule Runs
          </Button>
        </div>
      </>
    );
  }

  const filteredDays = filterDay ? activeDays.filter((d) => d === filterDay) : activeDays;

  return (
    <>
      <PageHeader title="Schedule" description="View the generated timetable." />

      {runDetail && (
        <p className={styles.printHeader}>
          GA Scheduler — Generated {new Date(runDetail.completedAt ?? runDetail.createdAt).toLocaleDateString()}
        </p>
      )}

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <select
            className={`${styles.select} ${styles.runSelect}`}
            value={selectedRunId}
            onChange={(e) => handleRunChange(e.target.value)}
            aria-label="Select run"
          >
            {runs.map((r) => (
              <option key={r.id} value={r.id}>{formatRunLabel(r)}</option>
            ))}
          </select>

          <select
            className={`${styles.select} ${styles.filterSelect}`}
            value={filterRoom}
            onChange={(e) => setFilterRoom(e.target.value)}
            aria-label="Filter by room"
          >
            <option value="">All Rooms</option>
            {uniqueRoomIds.map((rid) => (
              <option key={rid} value={rid}>{roomMap.get(rid)?.name ?? `Room ${rid}`}</option>
            ))}
          </select>

          <select
            className={`${styles.select} ${styles.filterSelect}`}
            value={filterLecturer}
            onChange={(e) => setFilterLecturer(e.target.value)}
            aria-label="Filter by lecturer"
          >
            <option value="">All Lecturers</option>
            {uniqueLecturers.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>

          <select
            className={`${styles.select} ${styles.filterSelect}`}
            value={filterDay}
            onChange={(e) => setFilterDay(e.target.value)}
            aria-label="Filter by day"
          >
            <option value="">All Days</option>
            {activeDays.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          <input
            className={styles.filterInput}
            type="text"
            placeholder="Search course..."
            value={filterCourse}
            onChange={(e) => setFilterCourse(e.target.value)}
            aria-label="Filter by course"
          />
        </div>

        <div className={styles.toolbarRight}>
          <div className={styles.densityToggle} role="group" aria-label="Grid density">
            <button
              type="button"
              className={`${styles.densityOption} ${density === 'compact' ? styles.densityOptionActive : ''}`}
              onClick={() => setDensity('compact')}
            >
              Compact
            </button>
            <button
              type="button"
              className={`${styles.densityOption} ${density === 'comfortable' ? styles.densityOptionActive : ''}`}
              onClick={() => setDensity('comfortable')}
            >
              Comfortable
            </button>
          </div>

          <div className={styles.exportWrapper} ref={exportRef}>
            <Button
              variant="secondary"
              icon={<Download size={16} />}
              onClick={() => setExportOpen((o) => !o)}
              aria-expanded={exportOpen}
              aria-haspopup="true"
            >
              Export
            </Button>
            {exportOpen && (
              <div className={styles.exportDropdown} role="menu">
                <button
                  type="button"
                  className={styles.exportOption}
                  onClick={handleExportCSV}
                  role="menuitem"
                >
                  <FileSpreadsheet size={16} className={styles.exportOptionIcon} />
                  Export as CSV
                </button>
                <button
                  type="button"
                  className={`${styles.exportOption} ${styles.exportOptionDisabled}`}
                  disabled
                  role="menuitem"
                >
                  <FileText size={16} className={styles.exportOptionIcon} />
                  Export as PDF (coming soon)
                </button>
              </div>
            )}
          </div>

          <Button variant="ghost" icon={<Printer size={16} />} onClick={handlePrint}>
            Print
          </Button>
        </div>
      </div>

      {/* ── Grid ── */}
      {detailLoading ? (
        <ScheduleGridSkeleton />
      ) : runDetail && runDetail.assignments.length > 0 ? (
        <>
          <TimetableGrid days={filteredDays} timeLabels={timeLabels} density={density}>
            {runDetail.assignments.map((group) =>
              group.sessions.map((session) => {
                const sortedSlots = [...session.timeSlots].sort((a, b) =>
                  a.startTime.localeCompare(b.startTime),
                );
                if (sortedSlots.length === 0) return null;

                const firstSlot = sortedSlots[0];
                const lastSlot = sortedSlots[sortedSlots.length - 1];

                const normalizedDay = normalizeDay(firstSlot.day);
                const dayIdx = filteredDays.findIndex((day) => day === normalizedDay);
                if (dayIdx === -1) return null;

                const rowIdx = startTimeToRow.get(firstSlot.startTime);
                if (rowIdx === undefined) return null;

                const room = roomMap.get(session.roomId);
                const lecturerNames = group.offering.lecturers.map((l) => l.name).join(', ');
                const isParallel = group.sessions.length > 1;
                const isFixed = session.isFixedRoom;
                const category = isFixed ? 'fixed' : getCategoryForCompetencies([]);
                const filtered = hasActiveFilters && isBlockFiltered(group, session);

                return (
                  <CourseBlock
                    key={`${group.offeringId}-${session.sessionIndex}`}
                    courseCode={group.offering.courseCode}
                    courseName={group.offering.courseName}
                    lecturers={lecturerNames}
                    roomName={room?.name ?? `Room ${session.roomId}`}
                    roomCapacity={room?.capacity}
                    sessionLabel={isParallel ? `Sesi ${String.fromCharCode(65 + session.sessionIndex)}` : undefined}
                    timeRange={`${firstSlot.startTime} – ${lastSlot.endTime}`}
                    category={category}
                    slotCount={sortedSlots.length}
                    gridColumn={dayIdx + GRID_COL_OFFSET}
                    gridRowStart={rowIdx + GRID_ROW_OFFSET}
                    fixed={isFixed}
                    override={session.manualOverride}
                    filteredOut={filtered}
                    density={density}
                    onClick={canOverride ? () => handleBlockClick(group, session) : undefined}
                  />
                );
              }),
            )}
          </TimetableGrid>

          <div className={styles.summaryPanel}>
            <div className={styles.summaryItem}>
              <p className={styles.summaryLabel}>Best Fitness</p>
              <p className={`${styles.summaryValue} ${styles.summaryValueGreen}`}>
                {runDetail.bestFitness.toFixed(4)}
              </p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.summaryLabel}>Hard Violations</p>
              <p className={styles.summaryValue}>{runDetail.hardViolations}</p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.summaryLabel}>Soft Penalty</p>
              <p className={styles.summaryValue}>{runDetail.softPenalty.toFixed(2)}</p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.summaryLabel}>Total Assignments</p>
              <p className={styles.summaryValue}>
                {runDetail.assignments.reduce((acc, g) => acc + g.sessions.length, 0)}
              </p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.summaryLabel}>Duration</p>
              <p className={styles.summaryValue}>{formatDuration(runDetail.durationMs)}</p>
            </div>
            <div className={styles.summaryItem}>
              <p className={styles.summaryLabel}>Generations Run</p>
              <p className={styles.summaryValue}>{runDetail.generationsRun}</p>
            </div>
          </div>
        </>
      ) : runDetail ? (
        <div className={styles.emptyState}>
          <CalendarDays size={48} className={styles.emptyIcon} aria-hidden="true" />
          <h2 className={styles.emptyTitle}>No assignments</h2>
          <p className={styles.emptyDescription}>This run produced no schedule assignments.</p>
        </div>
      ) : null}

      <ManualOverrideModal
        open={overrideModalOpen}
        onClose={() => setOverrideModalOpen(false)}
        runId={selectedRunId}
        target={overrideTarget}
        otherSessions={otherSessions}
        rooms={rooms}
        timeslots={allTimeslots}
        onSaved={handleOverrideSaved}
      />
    </>
  );
}

/* ── Skeleton ── */

function ScheduleSkeleton() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonBlock} style={{ width: 200, height: 28 }} />
      <div className={styles.skeletonToolbar}>
        <div className={styles.skeletonBlock} style={{ width: 300, height: 34 }} />
        <div className={styles.skeletonBlock} style={{ width: 140, height: 34 }} />
        <div className={styles.skeletonBlock} style={{ width: 140, height: 34 }} />
      </div>
      <ScheduleGridSkeleton />
    </div>
  );
}

function ScheduleGridSkeleton() {
  return (
    <div className={styles.skeletonGrid}>
      <div className={styles.skeletonGridHeader} />
      {Array.from({ length: 5 }, (_, i) => (
        <div key={`h-${i}`} className={styles.skeletonGridHeader} />
      ))}
      {Array.from({ length: 48 }, (_, i) => (
        <div
          key={`c-${i}`}
          className={styles.skeletonGridCell}
          style={{ animationDelay: `${(i % 6) * 100}ms` }}
        />
      ))}
    </div>
  );
}
