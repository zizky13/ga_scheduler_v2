import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DoorOpen,
  Users,
  BookOpen,
  Layers,
  Play,
  CalendarDays,
  Eye,
  Calendar,
  ArrowRight,
  UserCog,
  FileText,
  Settings,
  Trash2,
  Pencil,
  Plus,
} from 'lucide-react';
import { PageHeader } from '../components/ContentArea';
import { StatCard } from '../components/Card';
import { Button } from '../components/Button';
import { StatusBadge } from '../components/Badge';
import { useToastStore } from '../store/toastStore';
import { useSemesterStore } from '../store/semesterStore';
import type { SemesterItem } from '../store/semesterStore';
import { get } from '../lib/api';
import styles from './DashboardPage.module.css';

/* ── Types ── */

type RunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'STAGNATED'
  | 'SSA_INFEASIBLE'
  | 'PRE_GA_EMPTY'
  | 'CANCELLED'
  | 'FAILED';

interface ScheduleRunSummary {
  id: string;
  status: RunStatus;
  bestFitness: number;
  durationMs: number | null;
  createdAt: string;
}

interface AuditLogEntry {
  id: number;
  actorId: number | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: string | null;
  createdAt: string;
}

interface ListResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

interface DashboardData {
  semester: SemesterItem | null;
  roomCount: number;
  lecturerCount: number;
  courseCount: number;
  offeringCount: number;
  recentRuns: ScheduleRunSummary[];
  recentActivity: AuditLogEntry[];
}

/* ── Helpers ── */

function formatRelativeTime(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 30) return `${diffDay}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatDuration(ms: number | null): string {
  if (ms === null) return '—';
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatActionLabel(action: string, entityType: string): { verb: string; icon: typeof Plus } {
  const parts = action.split('.');
  const verb = parts[parts.length - 1] ?? action;
  switch (verb) {
    case 'create': return { verb: 'created', icon: Plus };
    case 'update': return { verb: 'updated', icon: Pencil };
    case 'delete': return { verb: 'deleted', icon: Trash2 };
    case 'cancel': return { verb: 'cancelled', icon: Trash2 };
    default: return { verb, icon: FileText };
  }
}

function entityLabel(entityType: string): string {
  switch (entityType) {
    case 'User': return 'user';
    case 'Room': return 'room';
    case 'Lecturer': return 'lecturer';
    case 'Course': return 'course';
    case 'CourseOffering': return 'offering';
    case 'Semester': return 'semester';
    case 'Facility': return 'facility';
    case 'TimeSlot': return 'timeslot';
    case 'LockedRoom': return 'locked room';
    case 'ScheduleRun': return 'schedule run';
    case 'ScheduleAssignment': return 'assignment';
    default: return entityType.toLowerCase();
  }
}

/* ── Component ── */

export function DashboardPage() {
  const navigate = useNavigate();
  const addToast = useToastStore((s) => s.addToast);
  const activeSemester = useSemesterStore((s) => s.activeSemester);

  const [data, setData] = useState<DashboardData>({
    semester: null,
    roomCount: 0,
    lecturerCount: 0,
    courseCount: 0,
    offeringCount: 0,
    recentRuns: [],
    recentActivity: [],
  });
  const [loading, setLoading] = useState(true);

  const fetchDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const semesterId = activeSemester?.id;
      const semesterScope = semesterId ? { semesterId } : {};

      const [roomsRes, lecturersRes, coursesRes, offeringsRes, runsRes] =
        await Promise.all([
          get<ListResponse<{ id: number }>>('/rooms', {
            ...semesterScope,
            page: 1,
            pageSize: 1,
          }),
          get<ListResponse<{ id: number }>>('/lecturers', {
            ...semesterScope,
            page: 1,
            pageSize: 1,
          }),
          get<ListResponse<{ id: number }>>('/courses', {
            ...semesterScope,
            page: 1,
            pageSize: 1,
          }),
          get<ListResponse<{ id: number }>>('/course-offerings', {
            ...semesterScope,
            page: 1,
            pageSize: 1,
          }),
          get<ListResponse<ScheduleRunSummary>>('/schedule-runs', {
            page: 1,
            pageSize: 5,
            sort: '-createdAt',
          }),
        ]);

      let recentActivity: AuditLogEntry[] = [];
      try {
        const auditRes = await get<ListResponse<AuditLogEntry>>('/audit-logs', {
          page: 1,
          pageSize: 10,
          sort: '-createdAt',
        });
        recentActivity = auditRes.data;
      } catch {
        // audit-log endpoint may not exist yet
      }

      setData({
        semester: activeSemester,
        roomCount: roomsRes.meta.total,
        lecturerCount: lecturersRes.meta.total,
        courseCount: coursesRes.meta.total,
        offeringCount: offeringsRes.meta.total,
        recentRuns: runsRes.data,
        recentActivity,
      });
    } catch {
      addToast({
        type: 'error',
        title: 'Failed to load dashboard',
        message: 'Could not fetch dashboard data.',
      });
    } finally {
      setLoading(false);
    }
  }, [addToast, activeSemester]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const semesterLabel = data.semester
    ? `Overview of semester ${data.semester.label || data.semester.code}`
    : 'No active semester';

  return (
    <>
      <PageHeader title="Dashboard" description={semesterLabel} />

      {/* ── Stat Cards ── */}
      <div className={styles.statsRow}>
        {loading ? (
          <>
            <div className={styles.statSkeleton} />
            <div className={styles.statSkeleton} />
            <div className={styles.statSkeleton} />
            <div className={styles.statSkeleton} />
          </>
        ) : (
          <>
            <StatCard
              icon={<DoorOpen size={24} />}
              label="Total Rooms"
              value={data.roomCount}
              iconBgColor="var(--color-primary-50)"
              iconColor="var(--color-primary-500)"
              onClick={() => navigate('/rooms')}
            />
            <StatCard
              icon={<Users size={24} />}
              label="Active Lecturers"
              value={data.lecturerCount}
              iconBgColor="var(--color-success-50)"
              iconColor="var(--color-success-500)"
              onClick={() => navigate('/lecturers')}
            />
            <StatCard
              icon={<BookOpen size={24} />}
              label="Courses"
              value={data.courseCount}
              iconBgColor="var(--color-warning-50)"
              iconColor="var(--color-warning-500)"
              onClick={() => navigate('/courses')}
            />
            <StatCard
              icon={<Layers size={24} />}
              label="Course Offerings"
              value={data.offeringCount}
              iconBgColor="var(--color-info-50)"
              iconColor="var(--color-info-500)"
              onClick={() => navigate('/offerings')}
            />
          </>
        )}
      </div>

      {/* ── Recent Runs + Quick Actions ── */}
      <div className={styles.middleRow}>
        {/* Recent Runs */}
        <div className={styles.recentRunsCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderLeft}>
              <CalendarDays size={18} className={styles.cardHeaderIcon} />
              <h2 className={styles.cardTitle}>Recent Runs</h2>
            </div>
            <button
              type="button"
              className={styles.viewAllLink}
              onClick={() => navigate('/runs')}
            >
              View all <ArrowRight size={14} />
            </button>
          </div>

          <div className={styles.cardBody}>
            {loading ? (
              <RunsSkeleton />
            ) : data.recentRuns.length === 0 ? (
              <div className={styles.emptyState}>
                <CalendarDays size={32} className={styles.emptyIcon} />
                <p className={styles.emptyText}>
                  No schedule runs yet. Run your first schedule to see results here.
                </p>
              </div>
            ) : (
              <div className={styles.compactTableScroll}>
                <table className={styles.compactTable}>
                  <thead>
                    <tr>
                      <th className={styles.compactTh}>Status</th>
                      <th className={styles.compactTh}>Created</th>
                      <th className={styles.compactTh}>Best Fitness</th>
                      <th className={styles.compactTh}>Duration</th>
                      <th className={styles.compactTh}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentRuns.map((run) => (
                      <tr key={run.id} className={styles.compactTr}>
                        <td className={styles.compactTd}>
                          <StatusBadge status={run.status} />
                        </td>
                        <td className={styles.compactTd}>
                          <span className={styles.relativeTime}>
                            {formatRelativeTime(run.createdAt)}
                          </span>
                        </td>
                        <td className={`${styles.compactTd} ${styles.mono}`}>
                          {run.bestFitness.toFixed(4)}
                        </td>
                        <td className={`${styles.compactTd} ${styles.mono}`}>
                          {formatDuration(run.durationMs)}
                        </td>
                        <td className={styles.compactTd}>
                          <div className={styles.actionsCell}>
                            <Button
                              variant="icon"
                              size="sm"
                              icon={<Eye size={16} />}
                              onClick={() => navigate(`/runs/${run.id}`)}
                              aria-label="View run details"
                            />
                            {run.status === 'COMPLETED' && (
                              <Button
                                variant="icon"
                                size="sm"
                                icon={<Calendar size={16} />}
                                onClick={() => navigate(`/schedule?runId=${run.id}`)}
                                aria-label="View schedule"
                              />
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className={styles.quickActionsCard}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>Quick Actions</h2>
          </div>
          <div className={styles.quickActionsBody}>
            <Button
              variant="secondary"
              icon={<Play size={16} />}
              className={styles.quickActionButton}
              onClick={() => navigate('/runs/new')}
            >
              Run New Schedule
            </Button>
            <Button
              variant="secondary"
              icon={<CalendarDays size={16} />}
              className={styles.quickActionButton}
              onClick={() => navigate('/schedule')}
            >
              View Latest Schedule
            </Button>
            <Button
              variant="secondary"
              icon={<DoorOpen size={16} />}
              className={styles.quickActionButton}
              onClick={() => navigate('/rooms')}
            >
              Manage Rooms
            </Button>
            <Button
              variant="secondary"
              icon={<Users size={16} />}
              className={styles.quickActionButton}
              onClick={() => navigate('/lecturers')}
            >
              Manage Lecturers
            </Button>
            <Button
              variant="secondary"
              icon={<Layers size={16} />}
              className={styles.quickActionButton}
              onClick={() => navigate('/offerings')}
            >
              Manage Offerings
            </Button>
          </div>
        </div>
      </div>

      {/* ── Recent Activity ── */}
      <div className={styles.activityCard}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Recent Activity</h2>
        </div>
        <div className={styles.cardBody}>
          {loading ? (
            <ActivitySkeleton />
          ) : data.recentActivity.length === 0 ? (
            <div className={styles.emptyState}>
              <FileText size={32} className={styles.emptyIcon} />
              <p className={styles.emptyText}>No recent activity.</p>
            </div>
          ) : (
            <ul className={styles.activityList}>
              {data.recentActivity.map((entry) => {
                const { verb, icon: ActionIcon } = formatActionLabel(
                  entry.action,
                  entry.entityType,
                );
                const entity = entityLabel(entry.entityType);
                const actorLabel = entry.actorId
                  ? `User #${entry.actorId}`
                  : 'System';

                return (
                  <li key={entry.id} className={styles.activityItem}>
                    <div className={styles.activityIconContainer}>
                      <ActionIcon size={14} />
                    </div>
                    <div className={styles.activityContent}>
                      <span className={styles.activityText}>
                        <strong>{actorLabel}</strong> {verb} {entity}{' '}
                        <span className={styles.mono}>#{entry.entityId}</span>
                      </span>
                      <span className={styles.activityTime}>
                        {formatRelativeTime(entry.createdAt)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

/* ── Skeletons ── */

function RunsSkeleton() {
  return (
    <div className={styles.skeletonList}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={styles.skeletonRow}
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}

function ActivitySkeleton() {
  return (
    <div className={styles.skeletonList}>
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className={styles.skeletonRow}
          style={{ animationDelay: `${i * 80}ms` }}
        />
      ))}
    </div>
  );
}
