import { useState, useEffect, useCallback, useMemo } from 'react'
import { Clock, Plus, Pencil, Trash2, LayoutGrid, List } from 'lucide-react'
import { PageHeader } from '../components/ContentArea'
import { DataTable, type Column } from '../components/DataTable'
import { Button } from '../components/Button'
import { Modal, ConfirmDialog } from '../components/Modal'
import { Select, FormSection, FormActions, TimeInput } from '../components/Form'
import type { SelectOption } from '../components/Form'
import { useToastStore } from '../store/toastStore'
import { useAuthStore } from '../store/authStore'
import { get, post, patch, del } from '../lib/api'
import type { ApiRequestError } from '../lib/api'
import styles from './TimeslotManagementPage.module.css'

/* ── Types ── */

type Weekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

interface TimeSlot {
  id: number
  semesterId: number
  day: Weekday
  startTime: string
  endTime: string
}

interface LecturerWire {
  id: number
  preferredTimeSlotIds: number[]
}

interface Semester {
  id: number
  code: string
  isActive: boolean
}

interface ListResponse<T> {
  data: T[]
  meta: { page: number; pageSize: number; total: number }
}

interface TimeSlotEnriched extends TimeSlot {
  durationMin: number
  lecturerCount: number
}

type ViewMode = 'grid' | 'table'

interface FormState {
  day: Weekday | ''
  startTime: string
  endTime: string
}

interface FormErrors {
  day?: string
  startTime?: string
  endTime?: string
  overlap?: string
}

const EMPTY_FORM: FormState = { day: '', startTime: '', endTime: '' }

const WEEKDAYS: Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
]

const WEEKDAY_SHORT: Record<Weekday, string> = {
  MONDAY: 'Mon',
  TUESDAY: 'Tue',
  WEDNESDAY: 'Wed',
  THURSDAY: 'Thu',
  FRIDAY: 'Fri',
  SATURDAY: 'Sat',
  SUNDAY: 'Sun',
}

const DAY_OPTIONS: SelectOption[] = WEEKDAYS.map((d) => ({
  value: d,
  label: d.charAt(0) + d.slice(1).toLowerCase(),
}))

/* ── Helpers ── */

function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + m
}

function minutesToTime(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function computeDuration(start: string, end: string): number {
  return timeToMinutes(end) - timeToMinutes(start)
}

function slotsOverlap(
  a: { startTime: string; endTime: string },
  b: { startTime: string; endTime: string },
): boolean {
  const aStart = timeToMinutes(a.startTime)
  const aEnd = timeToMinutes(a.endTime)
  const bStart = timeToMinutes(b.startTime)
  const bEnd = timeToMinutes(b.endTime)
  return aStart < bEnd && bStart < aEnd
}

function validate(
  form: FormState,
  allSlots: TimeSlotEnriched[],
  editTargetId: number | null,
): FormErrors {
  const errors: FormErrors = {}
  if (!form.day) errors.day = 'Day is required'
  if (!form.startTime) errors.startTime = 'Start time is required'
  if (!form.endTime) errors.endTime = 'End time is required'

  if (form.startTime && form.endTime) {
    if (timeToMinutes(form.endTime) <= timeToMinutes(form.startTime)) {
      errors.endTime = 'End time must be after start time'
    }
  }

  if (!errors.day && !errors.startTime && !errors.endTime && form.day) {
    const overlapping = allSlots.find(
      (s) =>
        s.id !== editTargetId &&
        s.day === form.day &&
        slotsOverlap(
          { startTime: form.startTime, endTime: form.endTime },
          { startTime: s.startTime, endTime: s.endTime },
        ),
    )
    if (overlapping) {
      errors.overlap = `Overlaps with existing slot ${overlapping.startTime} – ${overlapping.endTime}`
    }
  }

  return errors
}

/* ── Component ── */

export function TimeslotManagementPage() {
  const addToast = useToastStore((s) => s.addToast)
  const userRole = useAuthStore((s) => s.user?.role)
  const isAdmin = userRole === 'ADMIN'

  const [slots, setSlots] = useState<TimeSlotEnriched[]>([])
  const [activeSemesterId, setActiveSemesterId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<ViewMode>('grid')

  // Pagination (table view only)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)

  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<TimeSlotEnriched | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<TimeSlotEnriched | null>(null)
  const [deleting, setDeleting] = useState(false)

  /* ── Fetch ── */

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const [slotRes, lecRes, semRes] = await Promise.all([
        get<ListResponse<TimeSlot>>('/timeslots', {
          page: 1,
          pageSize: 500,
          sort: 'day,startTime',
        }),
        get<ListResponse<LecturerWire>>('/lecturers', { page: 1, pageSize: 500 }),
        get<ListResponse<Semester>>('/semesters', { isActive: true, page: 1, pageSize: 1 }),
      ])

      setActiveSemesterId(semRes.data[0]?.id ?? null)

      const lecturerCountMap = new Map<number, number>()
      for (const lec of lecRes.data) {
        for (const tsId of lec.preferredTimeSlotIds ?? []) {
          lecturerCountMap.set(tsId, (lecturerCountMap.get(tsId) ?? 0) + 1)
        }
      }

      const enriched: TimeSlotEnriched[] = slotRes.data.map((s) => ({
        ...s,
        durationMin: computeDuration(s.startTime, s.endTime),
        lecturerCount: lecturerCountMap.get(s.id) ?? 0,
      }))

      setSlots(enriched)
    } catch {
      addToast({ type: 'error', title: 'Failed to load timeslots' })
    } finally {
      setLoading(false)
    }
  }, [addToast])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  /* ── Active days (for grid — skip empty weekend days) ── */

  const activeDays = useMemo(() => {
    const daysWithSlots = new Set(slots.map((s) => s.day))
    return WEEKDAYS.filter(
      (d) =>
        daysWithSlots.has(d) ||
        d === 'MONDAY' ||
        d === 'TUESDAY' ||
        d === 'WEDNESDAY' ||
        d === 'THURSDAY' ||
        d === 'FRIDAY',
    )
  }, [slots])

  /* ── Time range for grid ── */

  const { gridStartHour, gridEndHour } = useMemo(() => {
    if (slots.length === 0) return { gridStartHour: 7, gridEndHour: 18 }
    let minM = Infinity
    let maxM = -Infinity
    for (const s of slots) {
      minM = Math.min(minM, timeToMinutes(s.startTime))
      maxM = Math.max(maxM, timeToMinutes(s.endTime))
    }
    return {
      gridStartHour: Math.floor(minM / 60),
      gridEndHour: Math.ceil(maxM / 60),
    }
  }, [slots])

  const hourLabels = useMemo(() => {
    const labels: number[] = []
    for (let h = gridStartHour; h <= gridEndHour; h++) labels.push(h)
    return labels
  }, [gridStartHour, gridEndHour])

  const totalGridMinutes = (gridEndHour - gridStartHour) * 60
  const HOUR_HEIGHT = 60 // px per hour
  const gridHeight = (gridEndHour - gridStartHour) * HOUR_HEIGHT

  /* ── Group slots by day ── */

  const slotsByDay = useMemo(() => {
    const map = new Map<Weekday, TimeSlotEnriched[]>()
    for (const d of WEEKDAYS) map.set(d, [])
    for (const s of slots) {
      map.get(s.day)!.push(s)
    }
    return map
  }, [slots])

  /* ── Create / Edit ── */

  function openCreate(prefillDay?: Weekday) {
    setEditTarget(null)
    setForm({ ...EMPTY_FORM, day: prefillDay ?? '' })
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(slot: TimeSlotEnriched) {
    setEditTarget(slot)
    setForm({
      day: slot.day,
      startTime: slot.startTime,
      endTime: slot.endTime,
    })
    setFormErrors({})
    setModalOpen(true)
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFormErrors((prev) => {
      const next = { ...prev }
      delete next[key as keyof FormErrors]
      delete next.overlap
      return next
    })
  }

  async function handleSave() {
    const errors = validate(form, slots, editTarget?.id ?? null)
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    if (!editTarget && !activeSemesterId) {
      addToast({
        type: 'error',
        title: 'No active semester',
        message: 'Activate a semester before creating timeslots.',
      })
      return
    }

    setSaving(true)
    try {
      if (editTarget) {
        await patch(`/timeslots/${editTarget.id}`, {
          day: form.day,
          startTime: form.startTime,
          endTime: form.endTime,
        })
        addToast({ type: 'success', title: 'Timeslot updated' })
      } else {
        await post('/timeslots', {
          semesterId: activeSemesterId,
          day: form.day,
          startTime: form.startTime,
          endTime: form.endTime,
        })
        addToast({ type: 'success', title: 'Timeslot created' })
      }
      setModalOpen(false)
      fetchData()
    } catch (err) {
      const e = err as ApiRequestError
      if (e.code === 'TIMESLOT_OVERLAP') {
        setFormErrors((prev) => ({
          ...prev,
          overlap: 'This timeslot overlaps with an existing one.',
        }))
      } else if (e.code === 'TIMESLOT_DUPLICATE') {
        setFormErrors((prev) => ({ ...prev, overlap: 'An identical timeslot already exists.' }))
      } else {
        addToast({
          type: 'error',
          title: editTarget ? 'Failed to update' : 'Failed to create',
          message: e.message,
        })
      }
    } finally {
      setSaving(false)
    }
  }

  /* ── Delete ── */

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await del(`/timeslots/${deleteTarget.id}`)
      addToast({ type: 'success', title: 'Timeslot deleted' })
      setDeleteTarget(null)
      fetchData()
    } catch (err) {
      const e = err as ApiRequestError
      if (e.code === 'TIMESLOT_REFERENCED') {
        addToast({
          type: 'error',
          title: 'Cannot delete',
          message:
            'This timeslot is referenced by lecturers or offerings. Remove all references first.',
        })
      } else {
        addToast({ type: 'error', title: 'Failed to delete', message: e.message })
      }
    } finally {
      setDeleting(false)
    }
  }

  /* ── Table columns ── */

  const tableColumns: Column<TimeSlotEnriched>[] = [
    {
      key: 'day',
      header: 'Day',
      width: '120px',
      render: (row) => <span>{row.day}</span>,
    },
    {
      key: 'startTime',
      header: 'Start Time',
      width: '100px',
      render: (row) => <span className={styles.mono}>{row.startTime}</span>,
    },
    {
      key: 'endTime',
      header: 'End Time',
      width: '100px',
      render: (row) => <span className={styles.mono}>{row.endTime}</span>,
    },
    {
      key: 'duration',
      header: 'Duration',
      width: '100px',
      render: (row) => <span className={styles.duration}>{row.durationMin} min</span>,
    },
    {
      key: 'lecturerCount',
      header: 'Lecturers Preferring',
      width: '140px',
      render: (row) => <span className={styles.count}>{row.lecturerCount}</span>,
    },
  ]

  /* ── Sorted slots for table view ── */

  const sortedSlots = useMemo(() => {
    return [...slots].sort((a, b) => {
      const dayDiff = WEEKDAYS.indexOf(a.day) - WEEKDAYS.indexOf(b.day)
      if (dayDiff !== 0) return dayDiff
      return timeToMinutes(a.startTime) - timeToMinutes(b.startTime)
    })
  }, [slots])

  const pagedSlots = useMemo(() => {
    const start = (page - 1) * pageSize
    return sortedSlots.slice(start, start + pageSize)
  }, [sortedSlots, page, pageSize])

  /* ── Render ── */

  return (
    <>
      <PageHeader
        title="Timeslots"
        description="Define available time slots for the active semester."
        actions={
          isAdmin ? (
            <Button icon={<Plus size={16} />} onClick={() => openCreate()}>
              Add Timeslot
            </Button>
          ) : undefined
        }
      />

      {/* Toolbar with view switcher */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          <span style={{ fontSize: 'var(--text-body-sm)', color: 'var(--color-secondary-400)' }}>
            {slots.length} timeslot{slots.length !== 1 ? 's' : ''} configured
          </span>
        </div>
        <div className={styles.toolbarRight}>
          <div className={styles.viewToggle}>
            <button
              type="button"
              className={`${styles.viewButton} ${viewMode === 'grid' ? styles.viewButtonActive : ''}`}
              onClick={() => setViewMode('grid')}
              aria-label="Grid view"
              aria-pressed={viewMode === 'grid'}
            >
              <LayoutGrid size={16} />
              Grid
            </button>
            <button
              type="button"
              className={`${styles.viewButton} ${viewMode === 'table' ? styles.viewButtonActive : ''}`}
              onClick={() => setViewMode('table')}
              aria-label="Table view"
              aria-pressed={viewMode === 'table'}
            >
              <List size={16} />
              Table
            </button>
          </div>
        </div>
      </div>

      {/* Grid View */}
      {viewMode === 'grid' && (
        <div className={styles.gridContainer}>
          {loading ? (
            <div className={styles.gridSkeleton}>
              {Array.from({ length: 5 }, (_, i) => (
                <div key={i} className={styles.skeletonRow}>
                  {Array.from({ length: activeDays.length + 1 }, (_, j) => (
                    <div
                      key={j}
                      className={styles.skeletonCell}
                      style={{ animationDelay: `${(i + j) * 80}ms` }}
                    />
                  ))}
                </div>
              ))}
            </div>
          ) : slots.length === 0 ? (
            <div className={styles.gridEmpty}>
              <div className={styles.gridEmptyIcon}>
                <Clock size={48} />
              </div>
              <p className={styles.gridEmptyTitle}>No timeslots configured</p>
              <p className={styles.gridEmptyDescription}>
                Create your first timeslot to define the weekly schedule grid.
              </p>
              {isAdmin && (
                <Button icon={<Plus size={16} />} onClick={() => openCreate()}>
                  Add Timeslot
                </Button>
              )}
            </div>
          ) : (
            <div
              className={styles.grid}
              style={{
                gridTemplateColumns: `120px repeat(${activeDays.length}, 1fr)`,
              }}
            >
              {/* Header row */}
              <div className={styles.dayHeaderCorner}>Time</div>
              {activeDays.map((d) => (
                <div key={d} className={styles.dayHeader}>
                  {WEEKDAY_SHORT[d]}
                </div>
              ))}

              {/* Hour rows */}
              {hourLabels.map((hour, hi) => (
                <div key={hour} className={styles.gridRow}>
                  <div className={styles.timeLabel}>{minutesToTime(hour * 60)}</div>
                  {activeDays.map((day) => (
                    <div
                      key={day}
                      className={styles.dayCell}
                      style={{ height: HOUR_HEIGHT }}
                      onClick={isAdmin ? () => openCreate(day) : undefined}
                    >
                      {/* Render slot blocks only in first hour row */}
                      {hi === 0 &&
                        (slotsByDay.get(day) ?? []).map((slot) => {
                          const topMin = timeToMinutes(slot.startTime) - gridStartHour * 60
                          const heightMin = slot.durationMin
                          const topPx = (topMin / totalGridMinutes) * gridHeight
                          const heightPx = (heightMin / totalGridMinutes) * gridHeight

                          return (
                            <div
                              key={slot.id}
                              className={styles.slotBlock}
                              style={{
                                top: topPx,
                                height: Math.max(heightPx, 24),
                              }}
                              onClick={(e) => {
                                e.stopPropagation()
                                if (isAdmin) openEdit(slot)
                              }}
                            >
                              <span className={styles.slotBlockTime}>
                                {slot.startTime} – {slot.endTime}
                              </span>
                              {heightPx >= 36 && (
                                <span className={styles.slotBlockMeta}>
                                  {slot.durationMin}min
                                  {slot.lecturerCount > 0 && ` · ${slot.lecturerCount} pref`}
                                </span>
                              )}
                              {isAdmin && (
                                <div className={styles.slotBlockActions}>
                                  <button
                                    type="button"
                                    className={styles.slotBlockAction}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      openEdit(slot)
                                    }}
                                    aria-label="Edit timeslot"
                                  >
                                    <Pencil size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    className={`${styles.slotBlockAction} ${styles.slotBlockActionDanger}`}
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setDeleteTarget(slot)
                                    }}
                                    aria-label="Delete timeslot"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Table View */}
      {viewMode === 'table' && (
        <DataTable
          columns={tableColumns}
          data={pagedSlots}
          keyExtractor={(row) => row.id}
          page={page}
          pageSize={pageSize}
          total={sortedSlots.length}
          onPageChange={setPage}
          onPageSizeChange={(s) => {
            setPageSize(s)
            setPage(1)
          }}
          loading={loading}
          emptyIcon={<Clock size={48} />}
          emptyTitle="No timeslots configured"
          emptyDescription="Create your first timeslot to define the weekly schedule grid."
          emptyAction={
            isAdmin ? (
              <Button icon={<Plus size={16} />} onClick={() => openCreate()}>
                Add Timeslot
              </Button>
            ) : undefined
          }
          rowActions={
            isAdmin
              ? (row) => (
                  <>
                    <Button
                      variant="icon"
                      size="sm"
                      icon={<Pencil size={16} />}
                      onClick={() => openEdit(row)}
                      aria-label="Edit timeslot"
                    />
                    <Button
                      variant="icon"
                      size="sm"
                      icon={<Trash2 size={16} />}
                      onClick={() => setDeleteTarget(row)}
                      aria-label="Delete timeslot"
                    />
                  </>
                )
              : undefined
          }
        />
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? 'Edit Timeslot' : 'New Timeslot'}
        size="sm"
        footer={
          <FormActions>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Timeslot'}
            </Button>
          </FormActions>
        }
      >
        <FormSection>
          <Select
            label="Day"
            placeholder="Select day…"
            options={DAY_OPTIONS}
            value={form.day}
            onChange={(v) => updateField('day', v as Weekday)}
            error={formErrors.day}
            required
          />
          <TimeInput
            label="Start Time"
            value={form.startTime}
            onChange={(v) => updateField('startTime', v)}
            error={formErrors.startTime}
            required
          />
          <TimeInput
            label="End Time"
            value={form.endTime}
            onChange={(v) => updateField('endTime', v)}
            error={formErrors.endTime}
            required
          />
          {formErrors.overlap && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--color-danger-50)',
                color: 'var(--color-danger-700)',
                fontSize: 'var(--text-body-sm)',
                border: '1px solid var(--color-danger-200)',
              }}
            >
              {formErrors.overlap}
            </div>
          )}
        </FormSection>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        variant="danger"
        title="Delete Timeslot?"
        description={
          deleteTarget
            ? deleteTarget.lecturerCount > 0
              ? `This timeslot (${deleteTarget.day} ${deleteTarget.startTime} – ${deleteTarget.endTime}) is preferred by ${deleteTarget.lecturerCount} lecturer${deleteTarget.lecturerCount > 1 ? 's' : ''}. Deletion will fail if references still exist.`
              : `Are you sure you want to delete the timeslot ${deleteTarget.day} ${deleteTarget.startTime} – ${deleteTarget.endTime}? This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deleting}
      />
    </>
  )
}
