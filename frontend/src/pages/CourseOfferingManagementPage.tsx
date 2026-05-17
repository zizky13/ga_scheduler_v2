import { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Layers,
  Plus,
  Pencil,
  Trash2,
  Download,
  Lock,
  Check,
  AlertTriangle,
  ChevronRight,
  Info,
} from 'lucide-react'
import { PageHeader } from '../components/ContentArea'
import { DataTable, type Column } from '../components/DataTable'
import { TableToolbar } from '../components/TableToolbar'
import { Button } from '../components/Button'
import { BooleanTag } from '../components/Badge'
import { Modal, ConfirmDialog } from '../components/Modal'
import {
  TextInput,
  NumberInput,
  Select,
  type SelectOption,
  MultiSelect,
  Toggle,
  FormSection,
  FormActions,
  FormField,
} from '../components/Form'
import { useToastStore } from '../store/toastStore'
import { useAuthStore } from '../store/authStore'
import { useSemesterStore } from '../store/semesterStore'
import { get, post, patch, del } from '../lib/api'
import type { ApiRequestError } from '../lib/api'
import styles from './CourseOfferingManagementPage.module.css'

/* ── Types ── */

type Weekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

interface CourseOfferingWire {
  id: number
  semesterId: number
  courseId: number
  roomId: number | null
  effectiveStudentCount: number
  lecturerIds: number[]
  isFixed: boolean
  fixedTimeSlotIds: number[]
  parentOfferingId: number | null
}

interface CourseWire {
  id: number
  code: string
  name: string
  sks: number
  requiredCompetencies: string[]
  requiredFacilities: string[]
}

interface RoomWire {
  id: number
  name: string
  capacity: number
  facilities: string[]
}

interface LecturerWire {
  id: number
  name: string
  competencies: string[]
}

interface TimeSlotWire {
  id: number
  day: Weekday
  startTime: string
  endTime: string
}

interface LockedRoomWire {
  id: number
  offeringId: number
  roomId: number
  reason: string | null
}

interface ListResponse<T> {
  data: T[]
  meta: { page: number; pageSize: number; total: number }
}

interface OfferingEnriched extends CourseOfferingWire {
  courseCode: string
  courseName: string
  roomName: string
  lecturerNames: string[]
  parentCourseCode: string | null
  lockedRoomId: number | null
}

interface FormState {
  courseId: number | null
  roomId: number | null
  effectiveStudentCount: number
  parentOfferingId: number | null
  lecturerIds: number[]
  isFixed: boolean
  fixedTimeSlotIds: number[]
  lockRoom: boolean
  lockReason: string
}

interface FormErrors {
  courseId?: string
  roomId?: string
  effectiveStudentCount?: string
  lecturerIds?: string
}

const EMPTY_FORM: FormState = {
  courseId: null,
  roomId: null,
  effectiveStudentCount: 0,
  parentOfferingId: null,
  lecturerIds: [],
  isFixed: false,
  fixedTimeSlotIds: [],
  lockRoom: false,
  lockReason: '',
}

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

function validateForm(form: FormState): FormErrors {
  const errors: FormErrors = {}
  if (!form.courseId) errors.courseId = 'Course is required'
  if (form.effectiveStudentCount < 0) errors.effectiveStudentCount = 'Must be 0 or greater'
  if (form.lecturerIds.length === 0) errors.lecturerIds = 'At least one lecturer is required'
  return errors
}

/* ── CSV Export ── */

function exportCsv(offerings: OfferingEnriched[]) {
  const header = 'Course Code,Course Name,Room,Lecturers,Students,Fixed,Parent'
  const rows = offerings.map(
    (o) =>
      `"${o.courseCode}","${o.courseName.replace(/"/g, '""')}","${o.roomName}","${o.lecturerNames.join(', ')}",${o.effectiveStudentCount},${o.isFixed ? 'Yes' : 'No'},"${o.parentCourseCode ?? ''}"`,
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'course-offerings.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/* ══════════════════════════════════════════
   Competency Match Indicator
   ══════════════════════════════════════════ */

function CompetencyIndicator({
  requiredCompetencies,
  lecturerCompetencies,
}: {
  requiredCompetencies: string[]
  lecturerCompetencies: string[]
}) {
  if (requiredCompetencies.length === 0) return null

  const covered = new Set(lecturerCompetencies)
  const missing = requiredCompetencies.filter((c) => !covered.has(c))

  if (missing.length === 0) {
    return (
      <div className={styles.competencyMatchSuccess}>
        <Check size={14} className={styles.competencyMatchIcon} />
        <span>All required competencies covered.</span>
      </div>
    )
  }

  return (
    <div className={styles.competencyMatchWarning}>
      <AlertTriangle size={14} className={styles.competencyMatchIcon} />
      <span>
        Missing competencies:
        <span className={styles.missingTags}>
          {missing.map((c) => (
            <span key={c} className={styles.missingTag}>
              {c}
            </span>
          ))}
        </span>
      </span>
    </div>
  )
}

/* ══════════════════════════════════════════
   Fixed Schedule Timeslot Grid
   ══════════════════════════════════════════ */

function FixedSlotsGrid({
  timeslots,
  selected,
  onChange,
}: {
  timeslots: TimeSlotWire[]
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  const slotsByDay = useMemo(() => {
    const map = new Map<Weekday, TimeSlotWire[]>()
    for (const d of WEEKDAYS) map.set(d, [])
    for (const ts of timeslots) map.get(ts.day)!.push(ts)
    for (const arr of map.values()) arr.sort((a, b) => a.startTime.localeCompare(b.startTime))
    return map
  }, [timeslots])

  const activeDays = useMemo(
    () => WEEKDAYS.filter((d) => (slotsByDay.get(d) ?? []).length > 0),
    [slotsByDay],
  )

  const allTimeLabels = useMemo(() => {
    const set = new Set<string>()
    for (const ts of timeslots) set.add(`${ts.startTime}-${ts.endTime}`)
    return [...set].sort()
  }, [timeslots])

  if (timeslots.length === 0) return null

  function toggle(id: number) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div
      className={styles.slotsGrid}
      style={{ gridTemplateColumns: `80px repeat(${activeDays.length}, 1fr)` }}
    >
      <div className={styles.slotsGridHeaderCell}>Time</div>
      {activeDays.map((d) => (
        <div key={d} className={styles.slotsGridHeaderCell}>
          {WEEKDAY_SHORT[d]}
        </div>
      ))}
      {allTimeLabels.map((timeLabel) => {
        const [start, end] = timeLabel.split('-')
        return (
          <div key={timeLabel} style={{ display: 'contents' }}>
            <div className={styles.slotsGridTimeLabel}>
              {start}–{end}
            </div>
            {activeDays.map((day) => {
              const slot = slotsByDay
                .get(day)!
                .find((s) => `${s.startTime}-${s.endTime}` === timeLabel)
              return (
                <div key={day} className={styles.slotsGridCell}>
                  {slot ? (
                    <input
                      type="checkbox"
                      className={styles.slotsGridCheckbox}
                      checked={selected.includes(slot.id)}
                      onChange={() => toggle(slot.id)}
                      aria-label={`${WEEKDAY_SHORT[day]} ${start}–${end}`}
                    />
                  ) : null}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

/* ══════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════ */

export function CourseOfferingManagementPage() {
  const addToast = useToastStore((s) => s.addToast)
  const userRole = useAuthStore((s) => s.user?.role)
  const isAdmin = userRole === 'ADMIN'
  const activeSemesterId = useSemesterStore((s) => s.activeSemester?.id ?? null)

  /* ── Reference data ── */
  const [allCourses, setAllCourses] = useState<CourseWire[]>([])
  const [allRooms, setAllRooms] = useState<RoomWire[]>([])
  const [allLecturers, setAllLecturers] = useState<LecturerWire[]>([])
  const [allTimeslots, setAllTimeslots] = useState<TimeSlotWire[]>([])
  const [allLockedRooms, setAllLockedRooms] = useState<LockedRoomWire[]>([])

  /* ── Table data ── */
  const [offerings, setOfferings] = useState<OfferingEnriched[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  /* ── Search & filters ── */
  const [search, setSearch] = useState('')
  const [filterFixed, setFilterFixed] = useState<boolean | null>(null)
  const [filterHasParent, setFilterHasParent] = useState<boolean | null>(null)
  const [filterRoom, setFilterRoom] = useState<number | null>(null)
  const [filterLecturer, setFilterLecturer] = useState<number | null>(null)

  /* ── Create/Edit modal ── */
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<OfferingEnriched | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [fixedSectionOpen, setFixedSectionOpen] = useState(false)

  /* ── Delete ── */
  const [deleteTarget, setDeleteTarget] = useState<OfferingEnriched | null>(null)
  const [deleting, setDeleting] = useState(false)

  /* ── Bulk selection ── */
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  /* ── Fetch ── */

  const fetchData = useCallback(
    async (p: number, ps: number) => {
      setLoading(true)
      try {
        if (activeSemesterId === null) {
          setOfferings([])
          setTotal(0)
          setAllLockedRooms([])
          setLoading(false)
          return
        }

        const semesterScope = { semesterId: activeSemesterId }
        const [offRes, courseRes, roomRes, lecRes, tsRes, lockRes] = await Promise.all([
          get<ListResponse<CourseOfferingWire>>('/course-offerings', {
            ...semesterScope,
            page: p,
            pageSize: ps,
          }),
          get<ListResponse<CourseWire>>('/courses', { page: 1, pageSize: 5000 }),
          get<ListResponse<RoomWire>>('/rooms', { page: 1, pageSize: 500 }),
          get<ListResponse<LecturerWire>>('/lecturers', { page: 1, pageSize: 500 }),
          get<ListResponse<TimeSlotWire>>('/timeslots', { page: 1, pageSize: 500 }),
          get<ListResponse<LockedRoomWire>>('/locked-rooms', {
            ...semesterScope,
            page: 1,
            pageSize: 5000,
          }),
        ])

        setAllCourses(courseRes.data)
        setAllRooms(roomRes.data)
        setAllLecturers(lecRes.data)
        setAllTimeslots(tsRes.data)
        setAllLockedRooms(lockRes.data)

        const courseMap = new Map(courseRes.data.map((c) => [c.id, c]))
        const roomMap = new Map(roomRes.data.map((r) => [r.id, r]))
        const lecMap = new Map(lecRes.data.map((l) => [l.id, l]))
        const lockByOffering = new Map(lockRes.data.map((l) => [l.offeringId, l]))

        const enriched: OfferingEnriched[] = offRes.data.map((o) => {
          const course = courseMap.get(o.courseId)
          const room = roomMap.get(o.roomId)
          const parentOff = o.parentOfferingId
            ? offRes.data.find((x) => x.id === o.parentOfferingId)
            : null
          const parentCourse = parentOff ? courseMap.get(parentOff.courseId) : null
          const lock = lockByOffering.get(o.id)
          return {
            ...o,
            courseCode: course?.code ?? `#${o.courseId}`,
            courseName: course?.name ?? 'Unknown',
            roomName: room?.name ?? `#${o.roomId}`,
            lecturerNames: o.lecturerIds.map((lid) => lecMap.get(lid)?.name ?? `#${lid}`),
            parentCourseCode:
              parentCourse?.code ?? (o.parentOfferingId ? `#${o.parentOfferingId}` : null),
            lockedRoomId: lock?.id ?? null,
          }
        })

        setOfferings(enriched)
        setTotal(offRes.meta.total)
      } catch {
        addToast({ type: 'error', title: 'Failed to load offerings' })
      } finally {
        setLoading(false)
      }
    },
    [addToast, activeSemesterId],
  )

  useEffect(() => {
    fetchData(page, pageSize)
  }, [page, pageSize, fetchData])

  /* ── Client-side filtering ── */

  const filteredOfferings = useMemo(() => {
    let result = offerings

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter(
        (o) => o.courseCode.toLowerCase().includes(q) || o.courseName.toLowerCase().includes(q),
      )
    }

    if (filterFixed !== null) {
      result = result.filter((o) => o.isFixed === filterFixed)
    }

    if (filterHasParent !== null) {
      result = result.filter((o) =>
        filterHasParent ? o.parentOfferingId !== null : o.parentOfferingId === null,
      )
    }

    if (filterRoom !== null) {
      result = result.filter((o) => o.roomId === filterRoom)
    }

    if (filterLecturer !== null) {
      result = result.filter((o) => o.lecturerIds.includes(filterLecturer))
    }

    return result
  }, [offerings, search, filterFixed, filterHasParent, filterRoom, filterLecturer])

  /* ── Form helpers ── */

  const selectedCourse = useMemo(
    () => (form.courseId ? (allCourses.find((c) => c.id === form.courseId) ?? null) : null),
    [form.courseId, allCourses],
  )

  const pooledLecturerCompetencies = useMemo(() => {
    const set = new Set<string>()
    for (const lid of form.lecturerIds) {
      const lec = allLecturers.find((l) => l.id === lid)
      if (lec) for (const c of lec.competencies) set.add(c)
    }
    return [...set]
  }, [form.lecturerIds, allLecturers])

  const parentOfferingOptions: SelectOption[] = useMemo(() => {
    if (!form.courseId) return []
    return offerings
      .filter((o) => o.courseId === form.courseId && (!editTarget || o.id !== editTarget.id))
      .map((o) => ({
        value: String(o.id),
        label: `Offering #${o.id} — ${o.courseCode}`,
      }))
  }, [form.courseId, offerings, editTarget])

  const courseOptions: SelectOption[] = useMemo(
    () => allCourses.map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` })),
    [allCourses],
  )

  const roomOptions: SelectOption[] = useMemo(
    () =>
      allRooms.map((r) => ({ value: String(r.id), label: `${r.name} (capacity: ${r.capacity})` })),
    [allRooms],
  )

  const lecturerOptions = useMemo(
    () =>
      allLecturers.map((l) => ({
        value: String(l.id),
        label: l.competencies.length > 0 ? `${l.name} — ${l.competencies.join(', ')}` : l.name,
      })),
    [allLecturers],
  )

  /* ── Create / Edit ── */

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setFixedSectionOpen(false)
    setModalOpen(true)
  }

  function openEdit(off: OfferingEnriched) {
    const lock = allLockedRooms.find((l) => l.offeringId === off.id)
    setEditTarget(off)
    setForm({
      courseId: off.courseId,
      roomId: off.roomId,
      effectiveStudentCount: off.effectiveStudentCount,
      parentOfferingId: off.parentOfferingId,
      lecturerIds: [...off.lecturerIds],
      isFixed: off.isFixed,
      fixedTimeSlotIds: [...off.fixedTimeSlotIds],
      lockRoom: !!lock,
      lockReason: lock?.reason ?? '',
    })
    setFormErrors({})
    setFixedSectionOpen(off.isFixed)
    setModalOpen(true)
  }

  async function handleSave() {
    const errors = validateForm(form)
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    if (!editTarget && !activeSemesterId) {
      addToast({
        type: 'error',
        title: 'No active semester',
        message: 'Activate a semester first.',
      })
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        courseId: form.courseId,
        effectiveStudentCount: form.effectiveStudentCount,
        lecturerIds: form.lecturerIds,
      }

      if (form.parentOfferingId) {
        body.parentOfferingId = form.parentOfferingId
      }

      if (isAdmin) {
        body.isFixed = form.isFixed
        if (form.isFixed) {
          body.fixedTimeSlotIds = form.fixedTimeSlotIds
        }
      }

      let savedOfferingId: number

      if (editTarget) {
        const res = await patch<CourseOfferingWire>(`/course-offerings/${editTarget.id}`, body)
        savedOfferingId = res.id
        addToast({ type: 'success', title: 'Offering updated' })
      } else {
        const res = await post<CourseOfferingWire>('/course-offerings', {
          semesterId: activeSemesterId,
          ...body,
        })
        savedOfferingId = res.id
        addToast({ type: 'success', title: 'Offering created' })
      }

      // Handle room lock
      if (isAdmin) {
        const existingLock = allLockedRooms.find(
          (l) => l.offeringId === (editTarget?.id ?? savedOfferingId),
        )

        if (form.lockRoom && !existingLock) {
          try {
            await post('/locked-rooms', {
              semesterId: activeSemesterId,
              offeringId: savedOfferingId,
              roomId: form.roomId,
              reason: form.lockReason.trim() || undefined,
            })
          } catch {
            addToast({
              type: 'warning',
              title: 'Room lock failed',
              message: 'The offering was saved but the room lock could not be created.',
            })
          }
        } else if (form.lockRoom && existingLock) {
          try {
            await patch(`/locked-rooms/${existingLock.id}`, {
              roomId: form.roomId,
              reason: form.lockReason.trim() || null,
            })
          } catch {
            // silently ignore lock update failure
          }
        } else if (!form.lockRoom && existingLock) {
          try {
            await del(`/locked-rooms/${existingLock.id}`)
          } catch {
            // silently ignore unlock failure
          }
        }
      }

      setModalOpen(false)
      fetchData(page, pageSize)
    } catch (err) {
      const e = err as ApiRequestError
      addToast({
        type: 'error',
        title: editTarget ? 'Failed to update' : 'Failed to create',
        message: e.message,
      })
    } finally {
      setSaving(false)
    }
  }

  /* ── Delete ── */

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await del(`/course-offerings/${deleteTarget.id}`)
      addToast({ type: 'success', title: 'Offering deleted' })
      setDeleteTarget(null)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(deleteTarget.id)
        return next
      })
      fetchData(page, pageSize)
    } catch (err) {
      const e = err as ApiRequestError
      addToast({ type: 'error', title: 'Failed to delete', message: e.message })
    } finally {
      setDeleting(false)
    }
  }

  /* ── Bulk delete ── */

  async function handleBulkDelete() {
    setBulkDeleting(true)
    const ids = [...selected]
    let ok = 0
    let fail = 0
    for (const id of ids) {
      try {
        await del(`/course-offerings/${id}`)
        ok++
      } catch {
        fail++
      }
    }
    if (ok > 0) addToast({ type: 'success', title: `${ok} offering${ok > 1 ? 's' : ''} deleted` })
    if (fail > 0)
      addToast({
        type: 'error',
        title: `${fail} offering${fail > 1 ? 's' : ''} could not be deleted`,
      })
    setSelected(new Set())
    setBulkDeleteOpen(false)
    setBulkDeleting(false)
    fetchData(page, pageSize)
  }

  /* ── Selection ── */

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(filteredOfferings.map((o) => o.id)))
  }
  function clearSelection() {
    setSelected(new Set())
  }

  /* ── Filter count ── */

  const activeFilterCount =
    (filterFixed !== null ? 1 : 0) +
    (filterHasParent !== null ? 1 : 0) +
    (filterRoom !== null ? 1 : 0) +
    (filterLecturer !== null ? 1 : 0)

  function clearFilters() {
    setFilterFixed(null)
    setFilterHasParent(null)
    setFilterRoom(null)
    setFilterLecturer(null)
  }

  /* ── Columns ── */

  const columns: Column<OfferingEnriched>[] = [
    ...(isAdmin
      ? [
          {
            key: '__select',
            header: '',
            width: '44px',
            render: (row: OfferingEnriched) => (
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onChange={() => toggleSelect(row.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select offering ${row.courseCode}`}
                style={{ accentColor: 'var(--color-primary-500)' }}
              />
            ),
          } satisfies Column<OfferingEnriched>,
        ]
      : []),
    {
      key: 'course',
      header: 'Course',
      width: '180px',
      render: (row) => (
        <div className={styles.courseCell}>
          <span className={styles.courseCode}>{row.courseCode}</span>
          <span className={styles.courseName}>{row.courseName}</span>
        </div>
      ),
    },
    {
      key: 'room',
      header: 'Room',
      width: '140px',
      render: (row) => <span>{row.roomName}</span>,
    },
    {
      key: 'lecturers',
      header: 'Lecturers',
      width: '180px',
      render: (row) => {
        const names = row.lecturerNames
        if (names.length === 0) return <span className={styles.dashPlaceholder}>—</span>
        if (names.length <= 2)
          return <span className={styles.lecturerCell}>{names.join(', ')}</span>
        return (
          <span className={styles.lecturerCell}>
            {names.slice(0, 2).join(', ')}{' '}
            <span className={styles.lecturerMore}>+{names.length - 2} more</span>
          </span>
        )
      },
    },
    {
      key: 'students',
      header: 'Students',
      width: '100px',
      render: (row) => <span className={styles.count}>{row.effectiveStudentCount}</span>,
    },
    {
      key: 'isFixed',
      header: 'Fixed',
      width: '80px',
      render: (row) => <BooleanTag value={row.isFixed} trueLabel="Yes" falseLabel="No" />,
    },
    {
      key: 'parent',
      header: 'Parent',
      width: '100px',
      render: (row) =>
        row.parentCourseCode ? (
          <span className={styles.courseCode}>{row.parentCourseCode}</span>
        ) : (
          <span className={styles.dashPlaceholder}>—</span>
        ),
    },
    {
      key: 'locked',
      header: 'Locked',
      width: '80px',
      render: (row) =>
        row.lockedRoomId ? (
          <Lock size={16} className={styles.lockIcon} />
        ) : (
          <span className={styles.dashPlaceholder}>—</span>
        ),
    },
  ]

  /* ── Filter content ── */

  const filterContent = (
    <div className={styles.filterPanel}>
      <div>
        <p className={styles.filterLabel}>Fixed Schedule</p>
        <div className={styles.filterCheckboxGroup}>
          {([null, true, false] as const).map((v) => (
            <label key={String(v)} className={styles.filterCheckbox}>
              <input
                type="radio"
                name="fixed"
                checked={filterFixed === v}
                onChange={() => setFilterFixed(v)}
              />
              {v === null ? 'All' : v ? 'Fixed only' : 'Non-fixed only'}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.filterDivider} />

      <div>
        <p className={styles.filterLabel}>Has Parent</p>
        <div className={styles.filterCheckboxGroup}>
          {([null, true, false] as const).map((v) => (
            <label key={String(v)} className={styles.filterCheckbox}>
              <input
                type="radio"
                name="hasParent"
                checked={filterHasParent === v}
                onChange={() => setFilterHasParent(v)}
              />
              {v === null ? 'All' : v ? 'With parent' : 'Without parent'}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.filterDivider} />

      <div>
        <p className={styles.filterLabel}>Room</p>
        <div className={styles.filterCheckboxGroup}>
          <label className={styles.filterCheckbox}>
            <input
              type="radio"
              name="room"
              checked={filterRoom === null}
              onChange={() => setFilterRoom(null)}
            />
            All rooms
          </label>
          {allRooms.map((r) => (
            <label key={r.id} className={styles.filterCheckbox}>
              <input
                type="radio"
                name="room"
                checked={filterRoom === r.id}
                onChange={() => setFilterRoom(r.id)}
              />
              {r.name}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.filterDivider} />

      <div>
        <p className={styles.filterLabel}>Lecturer</p>
        <div className={styles.filterCheckboxGroup}>
          <label className={styles.filterCheckbox}>
            <input
              type="radio"
              name="lecturer"
              checked={filterLecturer === null}
              onChange={() => setFilterLecturer(null)}
            />
            All lecturers
          </label>
          {allLecturers.map((l) => (
            <label key={l.id} className={styles.filterCheckbox}>
              <input
                type="radio"
                name="lecturer"
                checked={filterLecturer === l.id}
                onChange={() => setFilterLecturer(l.id)}
              />
              {l.name}
            </label>
          ))}
        </div>
      </div>

      {activeFilterCount > 0 && (
        <>
          <div className={styles.filterDivider} />
          <div className={styles.filterActions}>
            <button type="button" className={styles.filterClearButton} onClick={clearFilters}>
              Clear all filters
            </button>
          </div>
        </>
      )}
    </div>
  )

  return (
    <>
      <PageHeader
        title="Course Offerings"
        description="Link courses to rooms and lecturers. Configure parallel splits and fixed schedules."
        actions={
          <Button icon={<Plus size={16} />} onClick={openCreate}>
            Create Offering
          </Button>
        }
      />

      <TableToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by course code or name…"
        activeFilterCount={activeFilterCount}
        filterContent={filterContent}
        selectedCount={isAdmin ? selected.size : undefined}
        totalSelectableCount={isAdmin ? filteredOfferings.length : undefined}
        onSelectAll={isAdmin ? selectAll : undefined}
        onClearSelection={isAdmin ? clearSelection : undefined}
        selectionActions={
          isAdmin && selected.size > 0 ? (
            <>
              <Button
                variant="danger"
                size="sm"
                icon={<Trash2 size={14} />}
                onClick={() => setBulkDeleteOpen(true)}
              >
                Delete ({selected.size})
              </Button>
              <Button
                variant="secondary"
                size="sm"
                icon={<Download size={14} />}
                onClick={() => exportCsv(filteredOfferings.filter((o) => selected.has(o.id)))}
              >
                Export CSV
              </Button>
            </>
          ) : undefined
        }
        actions={
          !selected.size ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Download size={14} />}
              onClick={() => exportCsv(filteredOfferings)}
            >
              Export CSV
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={filteredOfferings}
        keyExtractor={(row) => row.id}
        page={page}
        pageSize={pageSize}
        total={filteredOfferings.length}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s)
          setPage(1)
        }}
        loading={loading}
        emptyIcon={<Layers size={48} />}
        emptyTitle="No course offerings"
        emptyDescription={
          search || activeFilterCount > 0
            ? 'Try adjusting your search or filters.'
            : 'Create offerings to link courses with rooms and lecturers before running the scheduler.'
        }
        emptyAction={
          !search && activeFilterCount === 0 ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              Create Offering
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
                    aria-label="Edit offering"
                  />
                  <Button
                    variant="icon"
                    size="sm"
                    icon={<Trash2 size={16} />}
                    onClick={() => setDeleteTarget(row)}
                    aria-label="Delete offering"
                  />
                </>
              )
            : undefined
        }
      />

      {/* ══════════════════════════════════════════
          Create / Edit Modal (modal-lg, 4 sections)
          ══════════════════════════════════════════ */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? 'Edit Offering' : 'New Offering'}
        size="lg"
        footer={
          <FormActions>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Offering'}
            </Button>
          </FormActions>
        }
      >
        {/* Parallel split banner */}
        {form.parentOfferingId && selectedCourse && (
          <div className={styles.parallelBanner}>
            <Info size={14} className={styles.parallelBannerIcon} />
            <span>
              This is a parallel split of <strong>{selectedCourse.code}</strong>. The GA will
              schedule this session independently.
            </span>
          </div>
        )}

        {/* Section 1: Course */}
        <FormSection>
          <p className={styles.sectionTitle}>Course</p>

          <Select
            label="Course"
            placeholder="Select a course…"
            options={courseOptions}
            value={form.courseId ? String(form.courseId) : ''}
            onChange={(v) => {
              setForm((prev) => ({
                ...prev,
                courseId: v ? Number(v) : null,
                parentOfferingId: null,
              }))
              setFormErrors((prev) => ({ ...prev, courseId: undefined }))
            }}
            error={formErrors.courseId}
            required
          />

          <NumberInput
            label="Effective Student Count"
            value={form.effectiveStudentCount}
            onChange={(v) => {
              setForm((prev) => ({ ...prev, effectiveStudentCount: v }))
              setFormErrors((prev) => ({ ...prev, effectiveStudentCount: undefined }))
            }}
            error={formErrors.effectiveStudentCount}
            min={0}
            max={10000}
            required
          />

          {parentOfferingOptions.length > 0 && (
            <Select
              label="Parent Offering"
              placeholder="None (standalone)"
              options={parentOfferingOptions}
              value={form.parentOfferingId ? String(form.parentOfferingId) : ''}
              onChange={(v) =>
                setForm((prev) => ({ ...prev, parentOfferingId: v ? Number(v) : null }))
              }
            />
          )}
        </FormSection>

        <div className={styles.sectionDivider} />

        {/* Section 2: Lecturers */}
        <FormSection>
          <p className={styles.sectionTitle}>Lecturers</p>

          <FormField label="Lecturers" error={formErrors.lecturerIds} required>
            <MultiSelect
              placeholder="Select lecturers…"
              options={lecturerOptions}
              value={form.lecturerIds.map(String)}
              onChange={(v) => {
                setForm((prev) => ({ ...prev, lecturerIds: v.map(Number) }))
                setFormErrors((prev) => ({ ...prev, lecturerIds: undefined }))
              }}
              helperText="Select at least one lecturer. Competencies are pooled for team teaching."
            />
          </FormField>

          {selectedCourse && form.lecturerIds.length > 0 && (
            <CompetencyIndicator
              requiredCompetencies={selectedCourse.requiredCompetencies}
              lecturerCompetencies={pooledLecturerCompetencies}
            />
          )}
        </FormSection>

        <div className={styles.sectionDivider} />

        {/* Section 3: Fixed Schedule (collapsible, admin only) */}
        {isAdmin && (
          <>
            <div>
              <button
                type="button"
                className={styles.collapsibleToggle}
                onClick={() => {
                  setFixedSectionOpen((prev) => !prev)
                  if (!fixedSectionOpen && !form.isFixed) {
                    setForm((prev) => ({ ...prev, isFixed: true }))
                  }
                }}
              >
                <ChevronRight
                  size={16}
                  className={
                    fixedSectionOpen ? styles.collapsibleChevronOpen : styles.collapsibleChevron
                  }
                />
                Fixed Schedule
              </button>

              {fixedSectionOpen && (
                <div style={{ paddingLeft: 4 }}>
                  <FormSection>
                    <Toggle
                      label="Is Fixed"
                      checked={form.isFixed}
                      onChange={(v) =>
                        setForm((prev) => ({
                          ...prev,
                          isFixed: v,
                          fixedTimeSlotIds: v ? prev.fixedTimeSlotIds : [],
                        }))
                      }
                    />

                    {form.isFixed && allTimeslots.length > 0 && (
                      <FormField
                        label="Fixed Time Slots"
                        helperText="Select the timeslots for this fixed offering."
                      >
                        <FixedSlotsGrid
                          timeslots={allTimeslots}
                          selected={form.fixedTimeSlotIds}
                          onChange={(ids) =>
                            setForm((prev) => ({ ...prev, fixedTimeSlotIds: ids }))
                          }
                        />
                      </FormField>
                    )}
                  </FormSection>
                </div>
              )}
            </div>

            <div className={styles.sectionDivider} />

            {/* Section 4: Room Lock */}
            <FormSection>
              <p className={styles.sectionTitle}>Room Lock</p>

              <div className={styles.lockInfo}>
                <Info size={14} className={styles.lockInfoIcon} />
                <span>
                  Locking a room ensures the GA always assigns this offering to the selected room.
                </span>
              </div>

              <Toggle
                label="Lock Room"
                checked={form.lockRoom}
                onChange={(v) => setForm((prev) => ({ ...prev, lockRoom: v }))}
              />

              {form.lockRoom && (
                <TextInput
                  label="Reason"
                  placeholder="Why are you locking this room?"
                  value={form.lockReason}
                  onChange={(e) => setForm((prev) => ({ ...prev, lockReason: e.target.value }))}
                />
              )}
            </FormSection>
          </>
        )}
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        variant="danger"
        title="Delete Offering?"
        description={
          deleteTarget
            ? `Are you sure you want to delete the offering for "${deleteTarget.courseCode} — ${deleteTarget.courseName}"? This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deleting}
      />

      {/* Bulk Delete */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        variant="danger"
        title="Delete Selected Offerings?"
        description={`Are you sure you want to delete ${selected.size} offering${selected.size > 1 ? 's' : ''}?`}
        confirmLabel={`Delete ${selected.size}`}
        cancelLabel="Cancel"
        loading={bulkDeleting}
      />
    </>
  )
}
