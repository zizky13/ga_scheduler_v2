import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Copy,
  XCircle,
  Trash2,
  CalendarDays,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  XOctagon,
  Info,
  ArrowLeft,
  FileQuestion,
  WifiOff,
  Lightbulb,
  Scissors,
  Wrench,
} from 'lucide-react';
import { StatusBadge } from '../components/Badge';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/Modal';
import { FitnessChart } from '../components/Chart';
import { useToastStore } from '../store/toastStore';
import { useAuthStore } from '../store/authStore';
import { get, post, del } from '../lib/api';
import type { ApiRequestError } from '../lib/api';
import { useScheduleRunStream } from '../lib/useScheduleRunStream';
import type { SSEProgressPayload, SSEStatePayload, SSEErrorPayload, ConnectionStatus } from '../lib/useScheduleRunStream';
import styles from './RunDetailPage.module.css';

type RunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'STAGNATED'
  | 'SSA_INFEASIBLE'
  | 'PRE_GA_EMPTY'
  | 'CANCELLED'
  | 'FAILED';

interface RunConfig {
  populationSize: number;
  generations: number;
  mutationRate: number;
  elitismCount: number;
  tournamentSize: number;
  crossoverType: string;
  noiseRate: number;
  hardPenaltyWeight: number;
  softPenaltyWeight: number;
}

// Phase 16 #15 — mirrors ScheduleRunDetailWire's GroupedAssignmentWire from
// `src/api/routes/schedule-runs.ts`. The Fragmented Sessions panel reads
// `assignments[].sessions[].timeSlots[]` to visualize the slot sequence with
// gap markers; everything else is included for parity with the wire shape.
interface RunDetailTimeSlot {
  id: number;
  /** Raw Prisma `Weekday` enum value as it arrives on the wire (e.g. 'MONDAY'). */
  day: string;
  /** 'HH:MM' 24-hour. */
  startTime: string;
  /** 'HH:MM' 24-hour. */
  endTime: string;
}

interface RunDetailSession {
  assignmentId: number;
  sessionIndex: number;
  roomId: number;
  isFixedRoom?: boolean;
  manualOverride?: boolean;
  lecturerIds: number[];
  timeSlots: RunDetailTimeSlot[];
}

interface RunDetailAssignment {
  offeringId: number;
  offering: {
    id: number;
    courseCode: string;
    courseName: string;
    lecturers: Array<{ id: number; name: string }>;
  };
  sessions: RunDetailSession[];
}

interface ScheduleRunDetail {
  id: string;
  status: RunStatus;
  semesterId: number;
  createdById: number;
  bestFitness: number;
  hardViolations: number;
  softPenalty: number;
  competencyMismatch: number;
  loadPenalty: number;
  capacityShortfallPenalty: number;
  generationsRun: number;
  currentGeneration: number;
  stagnatedEarly: boolean;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  config: RunConfig | null;
  preGASummary: PreGASummaryPayload | null;
  ssaResult: SSAResultPayload | null;
  history: number[] | null;
  avgHistory: number[] | null;
  idempotencyKey: string | null;
  // Phase 16 #15 — typed as the grouped wire shape so the Fragmented Sessions
  // panel can index into `sessions[].timeSlots[]` without an extra cast.
  assignments: RunDetailAssignment[];
  // Phase 16 #13 — both fields default to `[]` on legacy rows (see
  // `extractDegradedOfferings` / `extractFragmentationRequired` in the route).
  // Typed as optional here for defensive client-side access in case the GET
  // response predates Phase 16 #13.
  degradedOfferings?: number[];
  fragmentationRequired?: number[];
}

interface DeadlockReportPayload {
  code: string;
  message: string;
  affectedOfferingIds: number[];
  recommendation: string;
}

interface SSAResultPayload {
  status: string;
  totalSessionsRequired: number;
  maximumAchievableMatching: number;
  deadlockReport?: DeadlockReportPayload;
}

interface CrossSemesterFieldMismatch {
  id: number;
  actualSemesterId?: number;
}

interface CrossSemesterFieldEntry {
  field: string;
  expectedSemesterId?: number;
  mismatches: CrossSemesterFieldMismatch[];
}

interface PreGAInfeasibleEntry {
  offeringId: number;
  code: string;
  message: string;
  // Phase 14 #10 — optional structured payload for CROSS_SEMESTER_DEFECT
  metadata?: {
    fields?: CrossSemesterFieldEntry[];
    field?: string;
    expectedSemesterId?: number;
    mismatches?: CrossSemesterFieldMismatch[];
  };
}

interface PreGASummaryPayload {
  feasible: number;
  infeasible: PreGAInfeasibleEntry[];
}

interface FitnessDataPoint {
  generation: number;
  bestFitness: number;
  avgFitness?: number;
}

const TERMINAL_STATUSES: ReadonlySet<RunStatus> = new Set([
  'COMPLETED',
  'STAGNATED',
  'SSA_INFEASIBLE',
  'PRE_GA_EMPTY',
  'CANCELLED',
  'FAILED',
]);

function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

function formatElapsed(ms: number): string {
  const totalSeconds = ms / 1000;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;
  return `${minutes}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function fitnessColorClass(value: number): string {
  if (value > 0.9) return styles.statGreen;
  if (value >= 0.7) return styles.statYellow;
  return styles.statRed;
}

function buildChartData(
  history: number[] | null,
  avgHistory: number[] | null,
): FitnessDataPoint[] {
  if (!history || history.length === 0) return [];
  return history.map((best, i) => ({
    generation: i,
    bestFitness: best,
    avgFitness: avgHistory?.[i],
  }));
}

export function RunDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const currentUser = useAuthStore((s) => s.user);

  const [run, setRun] = useState<ScheduleRunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [chartData, setChartData] = useState<FitnessDataPoint[]>([]);
  const [hasAvgData, setHasAvgData] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [elapsed, setElapsed] = useState(0);
  const elapsedRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ── REST fetch ── */

  const fetchRun = useCallback(async () => {
    if (!id) return;
    try {
      const data = await get<ScheduleRunDetail>(`/schedule-runs/${id}`);
      setRun(data);
      setChartData(buildChartData(data.history, data.avgHistory));
      setHasAvgData(data.avgHistory !== null && data.avgHistory.length > 0);
      setNotFound(false);
    } catch (err) {
      const e = err as ApiRequestError;
      if (e.status === 404) {
        setNotFound(true);
      } else {
        addToast({ type: 'error', title: 'Failed to load run', message: e.message });
      }
    } finally {
      setLoading(false);
    }
  }, [id, addToast]);

  useEffect(() => {
    setLoading(true);
    fetchRun();
  }, [fetchRun]);

  /* ── SSE stream ── */

  const sseEnabled = !!run && !isTerminal(run.status);

  const handleSSEProgress = useCallback((data: SSEProgressPayload) => {
    setRun((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status: 'RUNNING' as RunStatus,
        currentGeneration: data.currentGeneration,
        bestFitness: data.bestFitness,
        hardViolations: data.hardViolations,
        softPenalty: data.softPenalty,
        competencyMismatch: data.competencyMismatch,
        loadPenalty: data.loadPenalty,
        capacityShortfallPenalty: data.capacityShortfallPenalty,
      };
    });
    setChartData((prev) => [
      ...prev,
      {
        generation: data.currentGeneration,
        bestFitness: data.bestFitness,
        avgFitness: data.avgFitness,
      },
    ]);
    if (data.avgFitness !== undefined) setHasAvgData(true);
  }, []);

  const handleSSEState = useCallback((data: SSEStatePayload) => {
    const newStatus = data.status as RunStatus;
    setRun((prev) => {
      if (!prev) return prev;
      return { ...prev, status: newStatus };
    });
    if (newStatus === 'COMPLETED') {
      addToast({ type: 'success', title: 'Run completed', message: 'Schedule optimization completed successfully.' });
      setShowConfetti(true);
    }
    if (TERMINAL_STATUSES.has(newStatus)) {
      fetchRun();
    }
  }, [fetchRun, addToast]);

  const handleSSEError = useCallback((data: SSEErrorPayload) => {
    addToast({ type: 'error', title: 'Stream error', message: data.message });
  }, [addToast]);

  const handleSSEReconnected = useCallback(() => {
    fetchRun();
  }, [fetchRun]);

  const connectionStatus = useScheduleRunStream(id, sseEnabled, {
    onProgress: handleSSEProgress,
    onState: handleSSEState,
    onError: handleSSEError,
    onReconnected: handleSSEReconnected,
  });

  /* ── Confetti auto-dismiss ── */

  useEffect(() => {
    if (!showConfetti) return;
    const timer = setTimeout(() => setShowConfetti(false), 1500);
    return () => clearTimeout(timer);
  }, [showConfetti]);

  /* ── Elapsed timer ── */

  useEffect(() => {
    if (!run) return;

    if (run.completedAt) {
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
      if (run.durationMs !== null) {
        setElapsed(run.durationMs);
      } else {
        const start = new Date(run.startedAt!).getTime();
        const end = new Date(run.completedAt).getTime();
        setElapsed(end - start);
      }
      return;
    }

    if (!run.startedAt) {
      setElapsed(0);
      return;
    }

    const start = new Date(run.startedAt).getTime();

    function tick() {
      setElapsed(Date.now() - start);
    }

    tick();
    elapsedRef.current = setInterval(tick, 100);

    return () => {
      if (elapsedRef.current) {
        clearInterval(elapsedRef.current);
        elapsedRef.current = null;
      }
    };
  }, [run?.startedAt, run?.completedAt, run?.durationMs]);

  /* ── Copy handler ── */

  const handleCopy = useCallback(() => {
    if (!id) return;
    navigator.clipboard.writeText(id).then(() => {
      setCopied(true);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    });
  }, [id]);

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    };
  }, []);

  /* ── Cancel handler ── */

  const handleCancelConfirm = useCallback(async () => {
    if (!id) return;
    setCancelling(true);
    try {
      await post<{ id: string; status: string }>(`/schedule-runs/${id}/cancel`);
      addToast({ type: 'success', title: 'Run cancelled', message: 'The schedule run has been cancelled.' });
      setCancelOpen(false);
      fetchRun();
    } catch (err) {
      const e = err as ApiRequestError;
      addToast({ type: 'error', title: 'Failed to cancel', message: e.message });
    } finally {
      setCancelling(false);
    }
  }, [id, addToast, fetchRun]);

  /* ── Delete handler ── */

  const handleDeleteConfirm = useCallback(async () => {
    if (!id) return;
    setDeleting(true);
    try {
      await del(`/schedule-runs/${id}`);
      addToast({
        type: 'success',
        title: 'Run deleted',
        message: 'The schedule run and its assignments have been removed.',
      });
      setDeleteOpen(false);
      navigate('/runs');
    } catch (err) {
      const e = err as ApiRequestError;
      addToast({ type: 'error', title: 'Failed to delete', message: e.message });
    } finally {
      setDeleting(false);
    }
  }, [id, addToast, navigate]);

  /* ── Render ── */

  if (loading) {
    return <LoadingSkeleton />;
  }

  if (notFound || !run) {
    return (
      <div className={styles.notFound}>
        <FileQuestion size={48} className={styles.notFoundIcon} aria-hidden="true" />
        <h2 className={styles.notFoundTitle}>Run not found</h2>
        <p className={styles.notFoundDescription}>
          The schedule run you are looking for does not exist or has been removed.
        </p>
        <Button
          variant="secondary"
          icon={<ArrowLeft size={16} />}
          onClick={() => navigate('/runs')}
        >
          Back to Runs
        </Button>
      </div>
    );
  }

  const shortId = run.id.slice(0, 8);
  const isCompleted = run.status === 'COMPLETED';
  const progressPercent = isCompleted
    ? 100
    : run.generationsRun > 0
      ? Math.round((run.currentGeneration / run.generationsRun) * 100)
      : 0;
  const progressWidth = isCompleted
    ? 100
    : run.generationsRun > 0
      ? (run.currentGeneration / run.generationsRun) * 100
      : 0;
  const isActive = run.status === 'RUNNING' || run.status === 'QUEUED';
  const isQueued = run.status === 'QUEUED';
  const showViewSchedule = run.status === 'COMPLETED' || run.status === 'STAGNATED';
  const canDelete =
    run.status !== 'RUNNING' &&
    !!currentUser &&
    (currentUser.role === 'ADMIN' || String(run.createdById) === currentUser.id);

  return (
    <div className={styles.page}>
      {showConfetti && <ConfettiDots />}
      <ConnectionBanner status={connectionStatus} />

      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <p className={styles.breadcrumb}>
            <Link to="/runs" className={styles.breadcrumbLink}>Schedule Runs</Link>
            <span className={styles.breadcrumbSeparator} aria-hidden="true">&rsaquo;</span>
            <span className={styles.breadcrumbCurrent}>Run {shortId}</span>
          </p>
          <StatusBadge status={run.status} />
        </div>
        <div className={styles.headerRight}>
          <span className={styles.elapsed} aria-label="Elapsed time">
            {formatElapsed(elapsed)}
          </span>
          <button
            type="button"
            className={styles.runIdButton}
            onClick={handleCopy}
            aria-label="Copy full run ID"
          >
            <Copy className={styles.copyIcon} aria-hidden="true" />
            {shortId}
            {copied && <span className={styles.copyTooltip}>Copied!</span>}
          </button>
        </div>
      </div>

      {run.status === 'SSA_INFEASIBLE' && run.ssaResult ? (
        <SSAFailurePanel ssaResult={run.ssaResult} onNavigate={navigate} />
      ) : run.status === 'PRE_GA_EMPTY' && run.preGASummary ? (
        <PreGAFailurePanel preGASummary={run.preGASummary} onNavigate={navigate} />
      ) : (
        <>
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Generation</p>
              <p className={styles.statValue}>
                {run.currentGeneration} / {run.generationsRun}
              </p>
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Best Fitness</p>
              <p className={`${styles.statValue} ${fitnessColorClass(run.bestFitness)}`}>
                {run.bestFitness.toFixed(4)}
              </p>
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Hard Violations</p>
              <p className={`${styles.statValue} ${run.hardViolations === 0 ? styles.statGreen : styles.statRed}`}>
                {run.hardViolations}
              </p>
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Soft Penalty</p>
              <p className={styles.statValue}>
                {run.softPenalty.toFixed(2)}
              </p>
            </div>
            <div className={styles.statCard}>
              <p className={styles.statLabel}>Competency Mismatch</p>
              <p className={`${styles.statValue} ${run.competencyMismatch === 0 ? styles.statGreen : styles.statRed}`}>
                {run.competencyMismatch}
              </p>
            </div>
            <div
              className={styles.statCard}
              title="Sum of SKS over each lecturer's maxSks cap (soft constraint)."
            >
              <p className={styles.statLabel}>Load Penalty (SKS over cap)</p>
              <p className={`${styles.statValue} ${run.loadPenalty === 0 ? styles.statGreen : styles.statRed}`}>
                {run.loadPenalty}
              </p>
            </div>
            <div
              className={styles.statCard}
              title="Sum of students over each null-room offering's combined session capacity (soft constraint)."
            >
              <p className={styles.statLabel}>Capacity Shortfall (students over cap)</p>
              <p className={`${styles.statValue} ${run.capacityShortfallPenalty === 0 ? styles.statGreen : styles.statRed}`}>
                {run.capacityShortfallPenalty}
              </p>
            </div>
          </div>

          <div className={styles.progressSection}>
            <div className={styles.progressTrack}>
              {isQueued ? (
                <div className={styles.progressFillIndeterminate} />
              ) : (
                <div
                  className={styles.progressFill}
                  style={{ width: `${progressWidth}%` }}
                />
              )}
            </div>
            <p className={styles.progressLabel}>
              {run.currentGeneration} / {run.generationsRun} ({progressPercent}%)
            </p>
          </div>

          {chartData.length > 0 && (
            <div className={styles.chartSection}>
              <h3 className={styles.chartTitle}>Fitness Curve</h3>
              <FitnessChart
                data={chartData}
                showAverage={hasAvgData}
                showViolations={false}
              />
            </div>
          )}

          <StatusBanner run={run} />

          {/*
            note (Phase 16 #15): the Fragmented Sessions panel is sibling-of-
            PreGAFailurePanel surface area for non-failing runs. It is the
            user-facing symptom display; the Timetable Management warning
            banner (Phase 16 #14) is the actionable long-term fix. BOTH are
            required to close the visibility loop for OQ-33/OQ-34 fragmentation
            outcomes — surface the symptom here, point users at /timeslots to
            change the underlying timetable.
          */}
          <FragmentedSessionsPanel
            assignments={run.assignments}
            degradedOfferings={run.degradedOfferings ?? []}
            fragmentationRequired={run.fragmentationRequired ?? []}
            onNavigate={navigate}
          />

          {(isActive || showViewSchedule || canDelete) && (
            <div className={styles.actionBar}>
              <div className={styles.actionBarLeft}>
                {isActive && (
                  <Button
                    variant="danger"
                    icon={<XCircle size={16} />}
                    onClick={() => setCancelOpen(true)}
                  >
                    Cancel Run
                  </Button>
                )}
                {canDelete && (
                  <Button
                    variant="danger"
                    icon={<Trash2 size={16} />}
                    onClick={() => setDeleteOpen(true)}
                  >
                    Delete Run
                  </Button>
                )}
              </div>
              <div className={styles.actionBarRight}>
                {showViewSchedule && (
                  <Button
                    variant="primary"
                    icon={<CalendarDays size={16} />}
                    onClick={() => navigate(`/schedule?runId=${run.id}`)}
                  >
                    View Schedule
                  </Button>
                )}
              </div>
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirm={handleCancelConfirm}
        variant="danger"
        title="Cancel Schedule Run?"
        description="This will stop the current optimization. The run cannot be resumed. Any partial results will be discarded."
        confirmLabel="Cancel Run"
        cancelLabel="Keep Running"
        loading={cancelling}
      />

      <ConfirmDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDeleteConfirm}
        variant="danger"
        title="Delete this run?"
        description="Deleting this run also removes all of its schedule assignments and frees any course offerings it referenced for deletion. This cannot be undone."
        confirmLabel="Delete Run"
        cancelLabel="Keep Run"
        loading={deleting}
      />
    </div>
  );
}

/* ── SSA Failure Panel ── */

function SSAFailurePanel({
  ssaResult,
  onNavigate,
}: {
  ssaResult: SSAResultPayload;
  onNavigate: (path: string) => void;
}) {
  const gap = ssaResult.totalSessionsRequired - ssaResult.maximumAchievableMatching;
  const report = ssaResult.deadlockReport;

  return (
    <div className={styles.ssaPanel}>
      <div className={styles.ssaHeader}>
        <div className={styles.ssaHeaderTop}>
          <AlertTriangle size={24} className={styles.ssaHeaderIcon} aria-hidden="true" />
          <h2 className={styles.ssaHeaderTitle}>
            Structural Infeasibility Detected — GA Not Executed
          </h2>
        </div>
        <p className={styles.ssaHeaderDescription}>
          The current configuration cannot produce a valid schedule. The Genetic Algorithm was not run to prevent wasted computation.
        </p>
      </div>

      <div className={styles.ssaStatsTriad}>
        <div className={styles.ssaStatCard}>
          <p className={styles.ssaStatLabel}>Sessions Required</p>
          <p className={styles.ssaStatValue}>{ssaResult.totalSessionsRequired}</p>
        </div>
        <div className={styles.ssaStatCard}>
          <p className={styles.ssaStatLabel}>Max Schedulable</p>
          <p className={`${styles.ssaStatValue} ${styles.ssaStatSuccess}`}>
            {ssaResult.maximumAchievableMatching}
          </p>
        </div>
        <div className={styles.ssaStatCard}>
          <p className={styles.ssaStatLabel}>Unresolvable</p>
          <p className={`${styles.ssaStatValue} ${styles.ssaStatError}`}>{gap}</p>
        </div>
      </div>

      {report && (
        <div className={styles.ssaDeadlockCard}>
          <p className={styles.ssaDeadlockMessage}>{report.message}</p>

          {report.affectedOfferingIds.length > 0 && (
            <div className={styles.ssaOfferingPills}>
              {report.affectedOfferingIds.map((oid) => (
                <span key={oid} className={styles.ssaOfferingPill}>
                  Offering #{oid}
                </span>
              ))}
            </div>
          )}

          {report.recommendation && (
            <div className={styles.ssaRecommendation}>
              <p className={styles.ssaRecommendationLabel}>
                <Lightbulb size={12} aria-hidden="true" />
                Recommended Action
              </p>
              <p className={styles.ssaRecommendationBody}>{report.recommendation}</p>
            </div>
          )}
        </div>
      )}

      <div className={styles.actionBar}>
        <div className={styles.actionBarLeft}>
          <Button variant="secondary" onClick={() => onNavigate('/runs')}>
            Back to Runs
          </Button>
        </div>
        <div className={styles.actionBarRight}>
          <Button
            variant="primary"
            onClick={() => {
              const ids = report?.affectedOfferingIds;
              const query = ids && ids.length > 0 ? `?highlight=${ids.join(',')}` : '';
              onNavigate(`/offerings${query}`);
            }}
          >
            Edit Offerings
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Pre-GA Failure Panel ── */

const REASON_BADGE_VARIANT: Record<string, string> = {
  COMPETENCY_MISMATCH: 'warning',
  CROSS_SEMESTER_DEFECT: 'warning', // Phase 14 #10
  ROOM_MISSING: 'error',
  NO_ROOMS_QUALIFY: 'error',
  ROOM_ZERO_CAPACITY: 'error',
  TEMPORAL_INSUFFICIENT: 'error',
  POLICY_FIXED_NO_SLOTS: 'error',
  FACILITY_MISMATCH: 'error',
};

function reasonBadgeClass(code: string): string {
  const variant = REASON_BADGE_VARIANT[code];
  if (variant === 'warning') return styles.reasonBadgeWarning;
  if (variant === 'error') return styles.reasonBadgeError;
  return styles.reasonBadgeDefault;
}

function formatReasonCode(code: string): string {
  return code
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

// Phase 14 #10 — derive normalized field entries for CROSS_SEMESTER_DEFECT
function crossSemesterFieldEntries(
  metadata: PreGAInfeasibleEntry['metadata'],
): CrossSemesterFieldEntry[] {
  if (!metadata) return [];
  if (Array.isArray(metadata.fields) && metadata.fields.length > 0) {
    return metadata.fields;
  }
  if (metadata.field && Array.isArray(metadata.mismatches)) {
    return [
      {
        field: metadata.field,
        expectedSemesterId: metadata.expectedSemesterId,
        mismatches: metadata.mismatches,
      },
    ];
  }
  return [];
}

// Phase 14 #10 — terse tooltip summarizing each offending field & mismatch
function crossSemesterTooltip(entry: PreGAInfeasibleEntry): string | undefined {
  if (entry.code !== 'CROSS_SEMESTER_DEFECT') return undefined;
  const fields = crossSemesterFieldEntries(entry.metadata);
  if (fields.length === 0) return undefined;
  const parts: string[] = [];
  for (const f of fields) {
    const expected =
      f.expectedSemesterId !== undefined ? `${f.expectedSemesterId}` : '?';
    for (const m of f.mismatches) {
      const actual =
        m.actualSemesterId !== undefined ? `${m.actualSemesterId}` : '?';
      parts.push(`${f.field} #${m.id} → semester ${actual} (expected ${expected})`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

function PreGAFailurePanel({
  preGASummary,
  onNavigate,
}: {
  preGASummary: PreGASummaryPayload;
  onNavigate: (path: string) => void;
}) {
  const { feasible, infeasible } = preGASummary;

  return (
    <div className={styles.ssaPanel}>
      <div className={styles.ssaHeader}>
        <div className={styles.ssaHeaderTop}>
          <AlertCircle size={24} className={styles.ssaHeaderIcon} aria-hidden="true" />
          <h2 className={styles.ssaHeaderTitle}>
            No Feasible Candidates — GA Not Executed
          </h2>
        </div>
        <p className={styles.ssaHeaderDescription}>
          All course offerings were rejected during pre-validation. The Genetic Algorithm cannot run without at least one valid candidate.
        </p>
      </div>

      <div className={styles.preGAStatsGrid}>
        <div className={styles.ssaStatCard}>
          <p className={styles.ssaStatLabel}>Passed Validation</p>
          <p className={`${styles.ssaStatValue} ${styles.ssaStatSuccess}`}>{feasible}</p>
        </div>
        <div className={styles.ssaStatCard}>
          <p className={styles.ssaStatLabel}>Rejected</p>
          <p className={`${styles.ssaStatValue} ${styles.ssaStatError}`}>{infeasible.length}</p>
        </div>
      </div>

      {infeasible.length > 0 && (
        <div className={styles.rejectionTable}>
          <table className={styles.rejectionTableInner}>
            <thead>
              <tr className={styles.rejectionTheadRow}>
                <th className={styles.rejectionTh}>Offering</th>
                <th className={styles.rejectionTh}>Reason</th>
                <th className={styles.rejectionTh}>Details</th>
              </tr>
            </thead>
            <tbody>
              {infeasible.map((entry) => {
                // Phase 14 #10 — receiver wiring is a future task; URL carries the field key already
                const fields = crossSemesterFieldEntries(entry.metadata);
                const primaryField =
                  entry.code === 'CROSS_SEMESTER_DEFECT' && fields.length > 0
                    ? fields[0].field
                    : undefined;
                const href = primaryField
                  ? `/offerings?highlight=${entry.offeringId}&field=${encodeURIComponent(primaryField)}`
                  : `/offerings?highlight=${entry.offeringId}`;
                const tooltip = crossSemesterTooltip(entry);
                return (
                  <tr
                    key={entry.offeringId}
                    className={styles.rejectionTr}
                    onClick={() => onNavigate(href)}
                    title={tooltip}
                  >
                    <td className={styles.rejectionTd}>
                      <span className={styles.rejectionOfferingId}>#{entry.offeringId}</span>
                    </td>
                    <td className={styles.rejectionTd}>
                      <span className={`${styles.reasonBadge} ${reasonBadgeClass(entry.code)}`}>
                        {formatReasonCode(entry.code)}
                      </span>
                    </td>
                    <td className={styles.rejectionTd}>
                      <span className={styles.rejectionDetails}>{entry.message}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.preGAActionBar}>
        <Button variant="secondary" onClick={() => onNavigate('/runs')}>
          Back to Runs
        </Button>
        <div className={styles.preGAActionBarRight}>
          <Button variant="secondary" onClick={() => onNavigate('/lecturers')}>
            Fix Lecturers
          </Button>
          <Button variant="primary" onClick={() => onNavigate('/offerings')}>
            Fix Offerings
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Fragmented Sessions Panel (Phase 16 #15) ────────────────────────── */

/**
 * Phase 16 #15 — Surfaces sessions whose slot sequence is non-contiguous
 * because the GA had to fall back to the per-slot adjacency / fragmentation-
 * permitted seeder. The union of `degradedOfferings` (SSA bipartite fallback)
 * and `fragmentationRequired` (Pre-GA `longestContiguousRun < sessionDuration`)
 * is the panel's source of truth; both lists may overlap, and the panel
 * de-duplicates by offering id.
 *
 * Click-through pattern: navigates to `/offerings?highlight={id}&edit=1`
 * (matching the existing PreGA/SSA failure panel convention of pushing a
 * `?highlight=` query). The `edit=1` flag is a forward-compatible signal —
 * `CourseOfferingManagementPage` will need a small `useSearchParams` reader
 * in a follow-up to auto-open its edit modal on that query. The click-
 * through still routes correctly today; the modal auto-open is a wiring
 * gap, not a missing surface here. Decision rationale: an inline modal would
 * duplicate the full offering edit form (lecturers, room, fixed-slot policy)
 * already living on /offerings — navigation keeps a single source of truth
 * for that form and matches the SSA/PreGA panels' click-through pattern.
 */
function FragmentedSessionsPanel({
  assignments,
  degradedOfferings,
  fragmentationRequired,
  onNavigate,
}: {
  assignments: RunDetailAssignment[];
  degradedOfferings: number[];
  fragmentationRequired: number[];
  onNavigate: (path: string) => void;
}) {
  // Union the two id lists; preserve first-seen ordering so the panel is
  // deterministic across renders.
  const fragmentedIds = (() => {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const id of degradedOfferings) {
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
    for (const id of fragmentationRequired) {
      if (!seen.has(id)) { seen.add(id); out.push(id); }
    }
    return out;
  })();

  const assignmentByOfferingId = new Map<number, RunDetailAssignment>();
  for (const a of assignments) assignmentByOfferingId.set(a.offeringId, a);

  const isEmpty = fragmentedIds.length === 0;

  return (
    <div className={styles.fragPanel}>
      <div className={styles.fragHeader}>
        <Scissors size={20} className={styles.fragHeaderIcon} aria-hidden="true" />
        <div className={styles.fragHeaderText}>
          <h3 className={styles.fragHeaderTitle}>Fragmented Sessions</h3>
          <p className={styles.fragHeaderSubtitle}>
            Sessions whose assigned slots are not back-to-back. The GA fell back to a fragmented layout because the active timetable could not host them contiguously.
          </p>
        </div>
      </div>

      {isEmpty ? (
        <div className={styles.fragEmpty} role="status">
          <CheckCircle size={20} className={styles.fragEmptyIcon} aria-hidden="true" />
          <p className={styles.fragEmptyMessage}>No fragmented sessions in this run.</p>
        </div>
      ) : (
        <ul className={styles.fragList}>
          {fragmentedIds.map((offeringId) => {
            const assignment = assignmentByOfferingId.get(offeringId);
            const courseLabel = assignment
              ? `${assignment.offering.courseCode} — ${assignment.offering.courseName}`
              : `Offering #${offeringId}`;
            // Navigate-with-query, mirroring the SSA / PreGA panels' click-
            // through. `edit=1` is a forward-compatible hint for #15 follow-up.
            const offeringHref = `/offerings?highlight=${offeringId}&edit=1`;

            return (
              <li key={offeringId} className={styles.fragItem}>
                <div className={styles.fragItemHeader}>
                  <button
                    type="button"
                    className={styles.fragItemTitle}
                    onClick={() => onNavigate(offeringHref)}
                    title="Open this offering on the Course Offerings page"
                  >
                    {courseLabel}
                  </button>
                  <Link
                    to="/timeslots"
                    className={styles.fragFixLink}
                    title="Open Timetable Management — the warning banner lists the courses that triggered this fragmentation."
                  >
                    <Wrench size={14} aria-hidden="true" />
                    Fix Timetable
                  </Link>
                </div>

                {assignment && assignment.sessions.length > 0 ? (
                  <div className={styles.fragSessions}>
                    {assignment.sessions.map((session) => (
                      <FragmentedSessionRow
                        key={session.assignmentId}
                        session={session}
                        showSessionLabel={assignment.sessions.length > 1}
                      />
                    ))}
                  </div>
                ) : (
                  <p className={styles.fragNoAssignment}>
                    No assignment data available for offering #{offeringId}.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Phase 16 #15 — Renders one session's slot sequence as
 *   `{day} {startTime} → {day} {startTime} → [BREAK end-start] → ...`
 * Per OQ-32 the contiguity test is strict string equality on endTime/startTime
 * (no minute tolerance). Per OQ-33 cross-day spans are not expected, but the
 * render is defensive: slots are sorted by `(day, startTime)` and a break
 * marker is inserted between any two adjacent slots whose endTime !==
 * startTime, including when the day changes mid-session.
 */
function FragmentedSessionRow({
  session,
  showSessionLabel,
}: {
  session: RunDetailSession;
  showSessionLabel: boolean;
}) {
  const sorted = [...session.timeSlots].sort((a, b) => {
    if (a.day !== b.day) return a.day.localeCompare(b.day);
    return a.startTime.localeCompare(b.startTime);
  });

  // Build a typed sequence: alternating slot + break markers.
  type Segment =
    | { kind: 'slot'; key: string; day: string; startTime: string }
    | { kind: 'break'; key: string; from: string; to: string };

  const segments: Segment[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const slot = sorted[i]!;
    segments.push({
      kind: 'slot',
      key: `slot-${slot.id}-${i}`,
      day: slot.day,
      startTime: slot.startTime,
    });
    const next = sorted[i + 1];
    if (next && slot.endTime !== next.startTime) {
      segments.push({
        kind: 'break',
        key: `break-${slot.id}-${next.id}`,
        from: slot.endTime,
        to: next.startTime,
      });
    }
  }

  return (
    <div className={styles.fragSessionRow}>
      {showSessionLabel && (
        <span className={styles.fragSessionLabel}>Session {session.sessionIndex + 1}</span>
      )}
      <div className={styles.fragSequence}>
        {segments.map((seg, idx) => (
          <span key={seg.key} className={styles.fragSegmentGroup}>
            {seg.kind === 'slot' ? (
              <span className={styles.fragSlotChip}>
                {seg.day} {seg.startTime}
              </span>
            ) : (
              <span className={styles.fragBreakChip}>
                [BREAK {seg.from}-{seg.to}]
              </span>
            )}
            {idx < segments.length - 1 && (
              <span className={styles.fragArrow} aria-hidden="true">→</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ── Confetti Dots ── */

function ConfettiDots() {
  const dots = useRef(
    Array.from({ length: 20 }, () => ({
      x: Math.random() * 100,
      top: 5 + Math.random() * 40,
      delay: Math.random() * 300,
      drift: (Math.random() - 0.5) * 80,
      size: 4 + Math.random() * 5,
    })),
  ).current;

  return (
    <div className={styles.confetti} aria-hidden="true">
      {dots.map((dot, i) => (
        <span
          key={i}
          className={styles.confettiDot}
          style={{
            left: `${dot.x}%`,
            top: `${dot.top}%`,
            width: dot.size,
            height: dot.size,
            animationDelay: `${dot.delay}ms`,
            '--drift': `${dot.drift}px`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  );
}

/* ── Connection Banner ── */

function ConnectionBanner({ status }: { status: ConnectionStatus }) {
  if (status === 'reconnecting') {
    return (
      <div className={`${styles.banner} ${styles.bannerWarning}`} role="alert">
        <WifiOff className={styles.bannerIcon} aria-hidden="true" />
        <p className={styles.bannerMessage}>Connection lost. Reconnecting...</p>
      </div>
    );
  }

  if (status === 'failed') {
    return (
      <div className={`${styles.banner} ${styles.bannerWarning}`} role="alert">
        <WifiOff className={styles.bannerIcon} aria-hidden="true" />
        <div className={styles.bannerContent}>
          <p className={styles.bannerMessage}>
            Unable to reconnect. Refresh the page to see current progress.
          </p>
          <button
            type="button"
            className={styles.refreshButton}
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
        </div>
      </div>
    );
  }

  return null;
}

/* ── Status Banner ── */

function StatusBanner({ run }: { run: ScheduleRunDetail }) {
  switch (run.status) {
    case 'COMPLETED':
      return (
        <div className={`${styles.banner} ${styles.bannerSuccess}`}>
          <CheckCircle className={styles.bannerIcon} aria-hidden="true" />
          <p className={styles.bannerMessage}>Run completed successfully.</p>
        </div>
      );
    case 'STAGNATED':
      return (
        <div className={`${styles.banner} ${styles.bannerWarning}`}>
          <AlertTriangle className={styles.bannerIcon} aria-hidden="true" />
          <p className={styles.bannerMessage}>
            The GA stagnated at generation {run.currentGeneration} due to insufficient fitness improvement.
          </p>
        </div>
      );
    case 'FAILED':
      return (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <XOctagon className={styles.bannerIcon} aria-hidden="true" />
          <div className={styles.bannerContent}>
            {run.errorCode && <p className={styles.errorCode}>{run.errorCode}</p>}
            <p className={styles.bannerMessage}>{run.errorMessage ?? 'An unexpected error occurred.'}</p>
          </div>
        </div>
      );
    case 'CANCELLED':
      return (
        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <Info className={styles.bannerIcon} aria-hidden="true" />
          <p className={styles.bannerMessage}>Run was cancelled by user.</p>
        </div>
      );
    case 'SSA_INFEASIBLE':
      return (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <XOctagon className={styles.bannerIcon} aria-hidden="true" />
          <p className={styles.bannerMessage}>
            Structural analysis detected that no valid schedule exists for the current data configuration.
          </p>
        </div>
      );
    case 'PRE_GA_EMPTY':
      return (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <XOctagon className={styles.bannerIcon} aria-hidden="true" />
          <p className={styles.bannerMessage}>
            No feasible candidates passed pre-GA validation. Check course offerings for constraint violations.
          </p>
        </div>
      );
    default:
      return null;
  }
}

/* ── Loading Skeleton ── */

function LoadingSkeleton() {
  return (
    <div className={styles.skeleton}>
      <div className={styles.skeletonHeader}>
        <div className={styles.skeletonBlock} style={{ width: 240, height: 24 }} />
        <div className={styles.skeletonBlock} style={{ width: 120, height: 24 }} />
      </div>
      <div className={styles.skeletonStatsGrid}>
        {Array.from({ length: 5 }, (_, i) => (
          <div
            key={i}
            className={styles.skeletonStatCard}
            style={{ animationDelay: `${i * 100}ms` }}
          />
        ))}
      </div>
      <div className={styles.skeletonBlock} style={{ width: '100%', height: 8, borderRadius: 'var(--radius-pill)' }} />
      <div className={styles.skeletonChart} style={{ animationDelay: '200ms' }} />
    </div>
  );
}
