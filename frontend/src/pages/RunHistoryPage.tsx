import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Play,
  Eye,
  Calendar,
  XCircle,
  Trash2,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'
import { PageHeader } from '../components/ContentArea'
import { Button } from '../components/Button'
import { StatusBadge } from '../components/Badge'
import { ConfirmDialog } from '../components/Modal'
import { useToastStore } from '../store/toastStore'
import { useAuthStore } from '../store/authStore'
import { get, post, del } from '../lib/api'
import type { ApiRequestError } from '../lib/api'
import styles from './RunHistoryPage.module.css'

type RunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'STAGNATED'
  | 'SSA_INFEASIBLE'
  | 'PRE_GA_EMPTY'
  | 'CANCELLED'
  | 'FAILED'

interface ScheduleRunSummary {
  id: string
  status: RunStatus
  semesterId: number
  createdById: number
  bestFitness: number
  hardViolations: number
  softPenalty: number
  competencyMismatch: number
  generationsRun: number
  currentGeneration: number
  stagnatedEarly: boolean
  durationMs: number | null
  errorCode: string | null
  errorMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
}

interface ListMeta {
  page: number
  pageSize: number
  total: number
}

interface RunListResponse {
  data: ScheduleRunSummary[]
  meta: ListMeta
}

const ALL_STATUSES: RunStatus[] = [
  'QUEUED',
  'RUNNING',
  'COMPLETED',
  'STAGNATED',
  'SSA_INFEASIBLE',
  'PRE_GA_EMPTY',
  'CANCELLED',
  'FAILED',
]

const PAGE_SIZE_OPTIONS = [10, 25, 50]

const AUTO_REFRESH_MS = 10_000

function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

function formatDate(iso: string): { date: string; time: string } {
  const d = new Date(iso)
  return {
    date: d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }),
    time: d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }),
  }
}

function fitnessClass(value: number): string {
  if (value > 0.9) return styles.fitnessGood
  if (value >= 0.7) return styles.fitnessWarning
  return styles.fitnessBad
}

export function RunHistoryPage() {
  const navigate = useNavigate()
  const addToast = useToastStore((s) => s.addToast)
  const currentUser = useAuthStore((s) => s.user)

  const [runs, setRuns] = useState<ScheduleRunSummary[]>([])
  const [meta, setMeta] = useState<ListMeta>({ page: 1, pageSize: 25, total: 0 })
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<RunStatus | ''>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [sortDesc, setSortDesc] = useState(true)

  const [cancelTarget, setCancelTarget] = useState<ScheduleRunSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ScheduleRunSummary | null>(null)
  const [cancelling, setCancelling] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const autoRefreshRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchRuns = useCallback(
    async (page: number, pageSize: number, status: RunStatus | '', sort: boolean) => {
      setLoading(true)
      try {
        const params: Record<string, unknown> = {
          page,
          pageSize,
          sort: sort ? '-createdAt' : 'createdAt',
        }
        if (status) params.status = status
        const res = await get<RunListResponse>('/schedule-runs', params)
        setRuns(res.data)
        setMeta(res.meta)
      } catch {
        addToast({
          type: 'error',
          title: 'Failed to load runs',
          message: 'Could not fetch schedule run history.',
        })
      } finally {
        setLoading(false)
      }
    },
    [addToast],
  )

  useEffect(() => {
    fetchRuns(meta.page, meta.pageSize, statusFilter, sortDesc)
  }, [meta.page, meta.pageSize, statusFilter, sortDesc, fetchRuns])

  useEffect(() => {
    const hasActiveRuns = runs.some((r) => r.status === 'RUNNING' || r.status === 'QUEUED')

    if (hasActiveRuns) {
      autoRefreshRef.current = setInterval(() => {
        fetchRuns(meta.page, meta.pageSize, statusFilter, sortDesc)
      }, AUTO_REFRESH_MS)
    }

    return () => {
      if (autoRefreshRef.current) {
        clearInterval(autoRefreshRef.current)
        autoRefreshRef.current = null
      }
    }
  }, [runs, meta.page, meta.pageSize, statusFilter, sortDesc, fetchRuns])

  const handlePageChange = useCallback((newPage: number) => {
    setMeta((prev) => ({ ...prev, page: newPage }))
  }, [])

  const handlePageSizeChange = useCallback((newSize: number) => {
    setMeta((prev) => ({ ...prev, pageSize: newSize, page: 1 }))
  }, [])

  const handleCancelConfirm = useCallback(async () => {
    if (!cancelTarget) return
    setCancelling(true)
    try {
      await post(`/schedule-runs/${cancelTarget.id}/cancel`)
      addToast({
        type: 'success',
        title: 'Run cancelled',
        message: 'The schedule run has been cancelled.',
      })
      setCancelTarget(null)
      fetchRuns(meta.page, meta.pageSize, statusFilter, sortDesc)
    } catch (err) {
      const e = err as ApiRequestError
      addToast({ type: 'error', title: 'Failed to cancel', message: e.message })
    } finally {
      setCancelling(false)
    }
  }, [cancelTarget, addToast, fetchRuns, meta.page, meta.pageSize, statusFilter, sortDesc])

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await del('/schedule-runs/' + deleteTarget.id)
      addToast({
        type: 'success',
        title: 'Run deleted',
        message: 'The schedule run and its assignments have been removed.',
      })
      setDeleteTarget(null)
      fetchRuns(meta.page, meta.pageSize, statusFilter, sortDesc)
    } catch (err) {
      const e = err as ApiRequestError
      addToast({ type: 'error', title: 'Failed to delete', message: e.message })
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, addToast, fetchRuns, meta.page, meta.pageSize, statusFilter, sortDesc])

  const filteredRuns = searchQuery
    ? runs.filter((r) => r.id.toLowerCase().includes(searchQuery.toLowerCase()))
    : runs

  const totalPages = Math.max(1, Math.ceil(meta.total / meta.pageSize))
  const rangeStart = meta.total === 0 ? 0 : (meta.page - 1) * meta.pageSize + 1
  const rangeEnd = Math.min(meta.page * meta.pageSize, meta.total)

  return (
    <>
      <PageHeader
        title="Schedule Runs"
        description="View past runs and create new schedule generations."
        actions={
          <Button icon={<Play size={16} />} onClick={() => navigate('/runs/new')}>
            New Run
          </Button>
        }
      />

      <div className={styles.toolbar}>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => {
            setStatusFilter(e.target.value as RunStatus | '')
            setMeta((prev) => ({ ...prev, page: 1 }))
          }}
          aria-label="Filter by status"
        >
          <option value="">All Statuses</option>
          {ALL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>

        <div className={styles.searchWrapper}>
          <Search className={styles.searchIcon} aria-hidden="true" />
          <input
            className={styles.searchInput}
            type="text"
            placeholder="Search by run ID..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search by run ID"
          />
        </div>

        <button
          type="button"
          className={styles.sortButton}
          onClick={() => setSortDesc((prev) => !prev)}
          aria-label={`Sort by created date ${sortDesc ? 'ascending' : 'descending'}`}
        >
          <ArrowUpDown className={styles.sortButtonIcon} aria-hidden="true" />
          {sortDesc ? 'Newest first' : 'Oldest first'}
        </button>
      </div>

      <div className={styles.tableContainer}>
        {loading ? (
          <LoadingSkeleton />
        ) : filteredRuns.length === 0 && meta.total === 0 && !statusFilter && !searchQuery ? (
          <div className={styles.emptyState}>
            <Play size={48} className={styles.emptyIcon} aria-hidden="true" />
            <h2 className={styles.emptyTitle}>No schedule runs yet</h2>
            <p className={styles.emptyDescription}>
              Run your first schedule to generate an optimized timetable.
            </p>
            <Button icon={<Play size={16} />} onClick={() => navigate('/runs/new')}>
              New Run
            </Button>
          </div>
        ) : (
          <>
            <div className={styles.tableScroll}>
              <table className={styles.table} role="table">
                <thead className={styles.thead}>
                  <tr className={styles.theadRow}>
                    <th className={`${styles.th} ${styles.thStatus}`}>Status</th>
                    <th className={`${styles.th} ${styles.thCreated}`}>Created</th>
                    <th className={`${styles.th} ${styles.thGeneration}`}>Generation</th>
                    <th className={`${styles.th} ${styles.thFitness}`}>Best Fitness</th>
                    <th className={`${styles.th} ${styles.thViolations}`}>Hard Violations</th>
                    <th className={`${styles.th} ${styles.thPenalty}`}>Soft Penalty</th>
                    <th className={`${styles.th} ${styles.thDuration}`}>Duration</th>
                    <th className={`${styles.th} ${styles.thActions}`}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.map((run) => {
                    const created = formatDate(run.createdAt)
                    return (
                      <tr key={run.id} className={styles.tr}>
                        <td className={styles.td}>
                          <StatusBadge status={run.status} />
                        </td>
                        <td className={styles.td}>
                          <div className={styles.createdPrimary}>
                            {created.date} {created.time}
                          </div>
                          <div className={styles.createdSecondary}>by User #{run.createdById}</div>
                        </td>
                        <td className={`${styles.td} ${styles.mono}`}>
                          {run.currentGeneration} / {run.generationsRun}
                        </td>
                        <td
                          className={`${styles.td} ${styles.mono} ${fitnessClass(run.bestFitness)}`}
                        >
                          {run.bestFitness.toFixed(4)}
                        </td>
                        <td
                          className={`${styles.td} ${styles.mono} ${run.hardViolations === 0 ? styles.violationsZero : styles.violationsNonZero}`}
                        >
                          {run.hardViolations}
                        </td>
                        <td className={`${styles.td} ${styles.mono}`}>
                          {run.softPenalty.toFixed(2)}
                        </td>
                        <td className={`${styles.td} ${styles.mono}`}>
                          {formatDuration(run.durationMs)}
                        </td>
                        <td className={styles.td}>
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
                            {(run.status === 'RUNNING' || run.status === 'QUEUED') && (
                              <Button
                                variant="icon"
                                size="sm"
                                icon={<XCircle size={16} />}
                                onClick={() => setCancelTarget(run)}
                                aria-label="Cancel run"
                              />
                            )}
                            {run.status !== 'RUNNING' &&
                              currentUser &&
                              (currentUser.role === 'ADMIN' ||
                                String(run.createdById) === currentUser.id) && (
                                <Button
                                  variant="icon"
                                  size="sm"
                                  icon={<Trash2 size={16} />}
                                  onClick={() => setDeleteTarget(run)}
                                  aria-label="Delete run"
                                />
                              )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div className={styles.pagination}>
              <span className={styles.paginationInfo}>
                Showing {rangeStart}–{rangeEnd} of {meta.total}
              </span>
              <div className={styles.paginationControls}>
                <select
                  className={styles.pageSizeSelect}
                  value={meta.pageSize}
                  onChange={(e) => handlePageSizeChange(Number(e.target.value))}
                  aria-label="Page size"
                >
                  {PAGE_SIZE_OPTIONS.map((size) => (
                    <option key={size} value={size}>
                      {size} / page
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={styles.pageButton}
                  disabled={meta.page <= 1}
                  onClick={() => handlePageChange(meta.page - 1)}
                  aria-label="Previous page"
                >
                  <ChevronLeft className={styles.pageButtonIcon} />
                </button>
                <button
                  type="button"
                  className={styles.pageButton}
                  disabled={meta.page >= totalPages}
                  onClick={() => handlePageChange(meta.page + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className={styles.pageButtonIcon} />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={cancelTarget !== null}
        onClose={() => setCancelTarget(null)}
        onConfirm={handleCancelConfirm}
        variant="warning"
        title="Cancel this run?"
        description="The schedule run will be stopped. This action cannot be undone."
        confirmLabel="Cancel Run"
        cancelLabel="Keep Running"
        loading={cancelling}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDeleteConfirm}
        variant="danger"
        title="Delete this run?"
        description="Deleting this run also removes all of its schedule assignments and frees any course offerings it referenced for deletion. This cannot be undone."
        confirmLabel="Delete Run"
        cancelLabel="Keep Run"
        loading={deleting}
      />
    </>
  )
}

function LoadingSkeleton() {
  const widths = [
    [140, 160, 120, 120, 120, 100, 100, 100],
    [120, 180, 100, 110, 80, 90, 80, 100],
    [140, 150, 120, 100, 120, 100, 90, 100],
    [100, 170, 110, 120, 100, 80, 100, 100],
    [130, 160, 120, 110, 120, 100, 80, 100],
  ]

  return (
    <>
      {widths.map((row, i) => (
        <div key={i} className={styles.skeletonRow}>
          {row.map((w, j) => (
            <div
              key={j}
              className={styles.skeletonCell}
              style={{ width: w, animationDelay: `${i * 100}ms` }}
            />
          ))}
        </div>
      ))}
    </>
  )
}
