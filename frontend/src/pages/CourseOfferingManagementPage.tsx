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
  semesterId: number
  name: string
  maxSks: number
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
  roomName: string | null
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
  parentOfferingId?: string
  fixedTimeSlotIds?: string
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
  // Phase 10 #10: when Lock Room is toggled on, a room must be picked. Task #9
  // guarantees roomId is null whenever lockRoom is off, so this predicate
  // cleanly catches the "user toggled lock on but didn't pick a room" case
  // without false positives on un-toggled offerings.
  if (form.lockRoom && form.roomId == null) {
    errors.roomId = 'Pick a room to lock or turn off Room Lock'
  }
  return errors
}

/* ── CSV Export ── */

function exportCsv(offerings: OfferingEnriched[]) {
  const header = 'Course Code,Course Name,Room,Lecturers,Students,Fixed,Parent'
  const rows = offerings.map(
    (o) =>
      `"${o.courseCode}","${o.courseName.replace(/"/g, '""')}","${o.roomName ?? ''}","${o.lecturerNames.join(', ')}",${o.effectiveStudentCount},${o.isFixed ? 'Yes' : 'No'},"${o.parentCourseCode ?? ''}"`,
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
  // Full semester offering list (unpaginated) — drives `loadInfoByLecturerId`
  // so per-lecturer SKS sums stay correct across pagination.
  const [allOfferings, setAllOfferings] = useState<CourseOfferingWire[]>([])
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
          setAllOfferings([])
          setTotal(0)
          setAllLockedRooms([])
          setLoading(false)
          return
        }

        const semesterScope = { semesterId: activeSemesterId }
        const [offRes, allOffRes, courseRes, roomRes, lecRes, tsRes, lockRes] = await Promise.all([
          get<ListResponse<CourseOfferingWire>>('/course-offerings', {
            ...semesterScope,
            page: p,
            pageSize: ps,
          }),
          get<ListResponse<CourseOfferingWire>>('/course-offerings', {
            ...semesterScope,
            page: 1,
            pageSize: 5000,
          }),
          get<ListResponse<CourseWire>>('/courses', { ...semesterScope, page: 1, pageSize: 5000 }),
          get<ListResponse<RoomWire>>('/rooms', { ...semesterScope, page: 1, pageSize: 5000 }),
          get<ListResponse<LecturerWire>>('/lecturers', { ...semesterScope, page: 1, pageSize: 5000 }),
          get<ListResponse<TimeSlotWire>>('/timeslots', { ...semesterScope, page: 1, pageSize: 5000 }),
          get<ListResponse<LockedRoomWire>>('/locked-rooms', {
            ...semesterScope,
            page: 1,
            pageSize: 5000,
          }),
        ])

        setAllOfferings(allOffRes.data)
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
          const room = o.roomId != null ? roomMap.get(o.roomId) : undefined
          const parentOff = o.parentOfferingId
            ? offRes.data.find((x) => x.id === o.parentOfferingId)
            : null
          const parentCourse = parentOff ? courseMap.get(parentOff.courseId) : null
          const lock = lockByOffering.get(o.id)
          return {
            ...o,
            courseCode: course?.code ?? `#${o.courseId}`,
            courseName: course?.name ?? 'Unknown',
            roomName: o.roomId == null ? null : (room?.name ?? `#${o.roomId}`),
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

  // Per-lecturer load info derived from all offerings in the active semester.
  // Team-taught offerings contribute full course.sks to each assigned lecturer
  // — mirrors LecturerManagementPage's `currentSksByLecturerId` and the GA's
  // `calculateLoadPenalty` so UI and fitness agree.
  const loadInfoByLecturerId = useMemo<
    Record<number, { currentSks: number; maxSks: number; isOverloaded: boolean }>
  >(() => {
    const sksByCourse = new Map<number, number>()
    for (const c of allCourses) sksByCourse.set(c.id, c.sks)
    const currentSks: Record<number, number> = {}
    for (const l of allLecturers) currentSks[l.id] = 0
    for (const off of allOfferings) {
      const sks = sksByCourse.get(off.courseId) ?? 0
      if (sks === 0) continue
      for (const lid of off.lecturerIds) {
        currentSks[lid] = (currentSks[lid] ?? 0) + sks
      }
    }
    const result: Record<
      number,
      { currentSks: number; maxSks: number; isOverloaded: boolean }
    > = {}
    for (const l of allLecturers) {
      const cs = currentSks[l.id] ?? 0
      result[l.id] = { currentSks: cs, maxSks: l.maxSks, isOverloaded: cs > l.maxSks }
    }
    return result
  }, [allLecturers, allOfferings, allCourses])

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

  // Phase 15 task #21 — shared-cohort info banner. Detects whether the chosen
  // course already has another offering in the active semester that is NOT
  // linked to `editTarget` via the parent-split tree. When true, the scheduler
  // (`src/pre-ga/validator.ts` cohort aggregation) will merge them into a
  // single cohort and split sessions across the union of lecturers — this
  // banner just makes that behavior visible to the user. We exclude any
  // offering that shares the parent-split tree with `editTarget` because the
  // existing `parallelBanner` already covers that case.
  const hasCohortSibling = useMemo(() => {
    if (!activeSemesterId) return false
    if (!form.courseId) return false
    const editId = editTarget?.id ?? null
    const editParentId = editTarget?.parentOfferingId ?? null
    return allOfferings.some((o) => {
      if (o.courseId !== form.courseId) return false
      if (editId !== null && o.id === editId) return false
      // Exclude parent-split relatives of editTarget so we don't double-banner.
      if (editId !== null && o.parentOfferingId === editId) return false
      if (editParentId !== null && o.id === editParentId) return false
      if (editParentId !== null && o.parentOfferingId === editParentId) return false
      return true
    })
  }, [activeSemesterId, form.courseId, allOfferings, editTarget])

  const courseOptions: SelectOption[] = useMemo(
    () => allCourses.map((c) => ({ value: String(c.id), label: `${c.code} — ${c.name}` })),
    [allCourses],
  )

  // Phase 10 #8: room options for the Room Lock section. Per design-spec §12.9
  // "Room Lock Interaction Detail", the dropdown filters to rooms whose
  // facilities cover the selected course's requiredFacilities and whose
  // capacity ≥ effectiveStudentCount. The currently-selected room (e.g., from
  // a pre-existing LockedRoom row whose filter inputs have since changed) is
  // always included so the edit modal accurately reflects the saved lock.
  const compatibleRoomOptions: SelectOption[] = useMemo(() => {
    const required = selectedCourse?.requiredFacilities ?? []
    const minCapacity = form.effectiveStudentCount
    const compatible = allRooms.filter(
      (r) => r.capacity >= minCapacity && required.every((f) => r.facilities.includes(f)),
    )
    if (form.roomId !== null && !compatible.some((r) => r.id === form.roomId)) {
      const current = allRooms.find((r) => r.id === form.roomId)
      if (current) compatible.push(current)
    }
    return compatible.map((r) => ({
      value: String(r.id),
      label: `${r.name} (capacity: ${r.capacity})`,
    }))
  }, [allRooms, selectedCourse, form.effectiveStudentCount, form.roomId])

  // Phase 11 task #15 — UX hint when null-room overflow will trigger a parallel
  // split. Mirrors the validator's null-room branch in src/pre-ga/validator.ts:
  // qualifying rooms are filtered by facility match alone (capacity is not a
  // gate for null-room offerings), then the cohort is split into
  // ⌈students / largestQualifyingCapacity⌉ sessions. Only shown when Lock Room
  // is off and the cohort actually exceeds the largest qualifying room — at
  // smaller counts the GA keeps parallelSessionCount=1 (OQ-17).
  const parallelSplitHint = useMemo<string | undefined>(() => {
    if (form.lockRoom) return undefined
    if (form.effectiveStudentCount <= 0) return undefined
    if (!selectedCourse) return undefined
    const required = selectedCourse.requiredFacilities
    const qualifying = allRooms.filter((r) =>
      required.every((f) => r.facilities.includes(f)),
    )
    if (qualifying.length === 0) return undefined
    const maxCapacity = Math.max(...qualifying.map((r) => r.capacity))
    if (form.effectiveStudentCount <= maxCapacity) return undefined
    const n = Math.ceil(form.effectiveStudentCount / maxCapacity)
    return `This offering will be split into ${n} parallel sessions across multiple rooms.`
  }, [form.lockRoom, form.effectiveStudentCount, selectedCourse, allRooms])

  const lecturerOptions = useMemo(
    () =>
      // Phase 14 #3 — defensive filter against stale cache; Phase 14 #1 already
      // scopes the fetch, this is belt-and-suspenders.
      allLecturers
        .filter((l) => l.semesterId === activeSemesterId)
        .map((l) => ({
          value: String(l.id),
          label: l.competencies.length > 0 ? `${l.name} — ${l.competencies.join(', ')}` : l.name,
        })),
    [allLecturers, activeSemesterId],
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
      // Phase 10 #7: form.roomId is sourced from the LockedRoom row, not from
      // offering.roomId. Phase 7 decoupled the two: an offering's stored
      // roomId no longer drives the lock; the LockedRoom table is the single
      // source of truth. If no lock exists, the form's roomId stays null and
      // the Room Lock section's room selector (task #8) starts empty.
      roomId: lock?.roomId ?? null,
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
            // invariant: form.roomId is non-null here — Phase 10 #10's
            // validateForm() check (`if (form.lockRoom && form.roomId == null)`)
            // already short-circuited handleSave on the null case, so this
            // branch only fires with a real numeric roomId. Same invariant
            // holds for the PATCH branch below.
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
      // Phase 14 #9: richer toast + per-field inline highlight for
      // CROSS_SEMESTER_REFERENCE. Read metadata.fields (plural, source of
      // truth) defensively, falling back to a synthetic single-entry array
      // built from the singular metadata keys if absent.
      if (e.code === 'CROSS_SEMESTER_REFERENCE') {
        const metadata =
          e.details && typeof e.details === 'object'
            ? ((e.details as Record<string, unknown>).metadata as
                | Record<string, unknown>
                | undefined)
            : undefined

        type Mismatch = { id: number; actualSemesterId: number }
        type FieldEntry = {
          field: string
          expectedSemesterId: number
          mismatches: Mismatch[]
        }

        let fields: FieldEntry[] = []
        if (metadata && Array.isArray(metadata.fields)) {
          fields = metadata.fields as FieldEntry[]
        } else if (metadata && typeof metadata.field === 'string') {
          fields = [
            {
              field: metadata.field as string,
              expectedSemesterId: Number(metadata.expectedSemesterId),
              mismatches: Array.isArray(metadata.mismatches)
                ? (metadata.mismatches as Mismatch[])
                : [],
            },
          ]
        }

        const FIELD_LABELS: Record<string, string> = {
          lecturerIds: 'Lecturer',
          roomId: 'Room',
          courseId: 'Course',
          fixedTimeSlotIds: 'Fixed time slot',
          parentOfferingId: 'Parent offering',
        }

        const formErrorKeys = new Set<keyof FormErrors>([
          'courseId',
          'roomId',
          'effectiveStudentCount',
          'lecturerIds',
          'parentOfferingId',
          'fixedTimeSlotIds',
        ])

        const first = fields[0]
        let message: string
        if (first && first.mismatches.length > 0) {
          const label = FIELD_LABELS[first.field] ?? first.field
          const m = first.mismatches[0]
          message = `${label} #${m.id} belongs to semester ${m.actualSemesterId} but this offering is in semester ${first.expectedSemesterId}. Switch the active semester or pick a current-semester ${label.toLowerCase()}.`
        } else {
          message = e.message
        }

        const title =
          fields.length > 1
            ? `Cross-semester reference (${fields.length} fields)`
            : 'Cross-semester reference'

        addToast({ type: 'error', title, message })

        const inlineErrors: Partial<FormErrors> = {}
        for (const entry of fields) {
          if (!formErrorKeys.has(entry.field as keyof FormErrors)) continue
          const m = entry.mismatches[0]
          inlineErrors[entry.field as keyof FormErrors] = m
            ? `Belongs to semester ${m.actualSemesterId}`
            : `Belongs to a different semester`
        }
        if (Object.keys(inlineErrors).length > 0) {
          setFormErrors((prev) => ({ ...prev, ...inlineErrors }))
        }
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
      if (e.code === 'OFFERING_REFERENCED_BY_RUN') {
        addToast({
          type: 'error',
          title: 'Cannot delete offering',
          message: `${e.message} Open Schedule Runs (/runs) to delete them first.`,
        })
      } else {
        addToast({ type: 'error', title: 'Failed to delete', message: e.message })
      }
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
      render: (row) =>
        row.roomName ? (
          <span>{row.roomName}</span>
        ) : (
          <span className={styles.dashPlaceholder}>GA-assigned</span>
        ),
    },
    {
      key: 'lecturers',
      header: 'Lecturers',
      width: '180px',
      render: (row) => {
        if (row.lecturerIds.length === 0)
          return <span className={styles.dashPlaceholder}>—</span>
        const visibleCount = Math.min(2, row.lecturerIds.length)
        const visible = row.lecturerIds.slice(0, visibleCount).map((lid, idx) => {
          const name = row.lecturerNames[idx] ?? `#${lid}`
          const load = loadInfoByLecturerId[lid]
          return (
            <span key={lid}>
              {idx > 0 && ', '}
              {name}
              {load?.isOverloaded && (
                <>
                  {' '}
                  <span
                    className={styles.lecturerOverChip}
                    title={`Over max SKS (${load.currentSks} / ${load.maxSks})`}
                    aria-label={`Over max SKS (${load.currentSks} / ${load.maxSks})`}
                  >
                    <AlertTriangle size={12} aria-hidden="true" />
                  </span>
                </>
              )}
            </span>
          )
        })
        const hiddenCount = row.lecturerIds.length - visibleCount
        return (
          <span className={styles.lecturerCell}>
            {visible}
            {hiddenCount > 0 && (
              <span className={styles.lecturerMore}> +{hiddenCount} more</span>
            )}
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

          {/* Phase 15 task #21 — shared-cohort info banner */}
          {hasCohortSibling && (
            <div className={styles.parallelBanner}>
              <Info size={14} className={styles.parallelBannerIcon} />
              <span>
                This course already has an offering in this semester. The scheduler will treat
                both as <strong>ONE cohort</strong> and split the parallel sessions across all
                assigned lecturers.
              </span>
            </div>
          )}

          <NumberInput
            label="Effective Student Count"
            value={form.effectiveStudentCount}
            onChange={(v) => {
              setForm((prev) => ({ ...prev, effectiveStudentCount: v }))
              setFormErrors((prev) => ({ ...prev, effectiveStudentCount: undefined }))
            }}
            error={formErrors.effectiveStudentCount}
            helperText={parallelSplitHint}
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
              onChange={(v) => {
                setForm((prev) => ({ ...prev, parentOfferingId: v ? Number(v) : null }))
                setFormErrors((prev) => ({ ...prev, parentOfferingId: undefined }))
              }}
              error={formErrors.parentOfferingId}
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
                        error={formErrors.fixedTimeSlotIds}
                      >
                        <FixedSlotsGrid
                          timeslots={allTimeslots}
                          selected={form.fixedTimeSlotIds}
                          onChange={(ids) => {
                            setForm((prev) => ({ ...prev, fixedTimeSlotIds: ids }))
                            setFormErrors((prev) => ({ ...prev, fixedTimeSlotIds: undefined }))
                          }}
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
                // Phase 10 #9: clear form.roomId when the toggle flips off so a
                // stale room pick doesn't survive a toggle-on → pick → toggle-off
                // → re-toggle-on sequence. The Select beneath shows blank again
                // until the user re-picks — semantically consistent with
                // "not locking anymore" and gates task #10's validation cleanly.
                onChange={(v) =>
                  setForm((prev) => ({
                    ...prev,
                    lockRoom: v,
                    roomId: v ? prev.roomId : null,
                  }))
                }
              />

              {/* Phase 10 #12: reassure the user that "no room field" is the
                  intended state when Lock Room is off — mirrors the table's
                  "GA-assigned" / "—" placeholder from Phase 7 #13. */}
              {!form.lockRoom && (
                <p className={styles.gaAssignedHint}>
                  Room will be assigned automatically by the scheduler.
                </p>
              )}

              {form.lockRoom && (
                <>
                  <Select
                    label="Room"
                    placeholder="Select a room to lock"
                    options={compatibleRoomOptions}
                    value={form.roomId !== null ? String(form.roomId) : ''}
                    onChange={(v) => {
                      setForm((prev) => ({ ...prev, roomId: v ? Number(v) : null }))
                      setFormErrors((prev) => ({ ...prev, roomId: undefined }))
                    }}
                    error={formErrors.roomId}
                    helperText={
                      selectedCourse
                        ? `Showing rooms compatible with ${selectedCourse.code} (capacity ≥ ${form.effectiveStudentCount}${selectedCourse.requiredFacilities.length > 0 ? `, facilities: ${selectedCourse.requiredFacilities.join(', ')}` : ''}).`
                        : 'Select a course first to see compatible rooms.'
                    }
                    required
                  />
                  <TextInput
                    label="Reason"
                    placeholder="Why are you locking this room?"
                    value={form.lockReason}
                    onChange={(e) => setForm((prev) => ({ ...prev, lockReason: e.target.value }))}
                  />
                </>
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
