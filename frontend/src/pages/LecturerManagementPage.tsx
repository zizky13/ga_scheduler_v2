import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Users, Plus, Pencil, Trash2, Download, X } from 'lucide-react'
import { PageHeader } from '../components/ContentArea'
import { DataTable, type Column } from '../components/DataTable'
import { TableToolbar } from '../components/TableToolbar'
import { Button } from '../components/Button'
import { BooleanTag } from '../components/Badge'
import { Modal, ConfirmDialog } from '../components/Modal'
import { TextInput, Toggle, FormSection, FormActions, FormField } from '../components/Form'
import { useToastStore } from '../store/toastStore'
import { useAuthStore } from '../store/authStore'
import { get, post, patch, del } from '../lib/api'
import type { ApiRequestError } from '../lib/api'
import styles from './LecturerManagementPage.module.css'

/* ── Types ── */

type Weekday = 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY' | 'FRIDAY' | 'SATURDAY' | 'SUNDAY'

interface Lecturer {
  id: number
  semesterId: number
  name: string
  isStructural: boolean
  competencies: string[]
  preferredTimeSlotIds: number[]
}

interface TimeSlotWire {
  id: number
  day: Weekday
  startTime: string
  endTime: string
}

interface OfferingLecturerWire {
  lecturerId: number
}

interface OfferingWire {
  id: number
  lecturers?: OfferingLecturerWire[]
}

interface Semester {
  id: number
  isActive: boolean
}

interface ListResponse<T> {
  data: T[]
  meta: { page: number; pageSize: number; total: number }
}

interface LecturerEnriched extends Lecturer {
  offeringCount: number
}

interface FormState {
  name: string
  isStructural: boolean
  competencies: string[]
  preferredTimeSlotIds: number[]
}

interface FormErrors {
  name?: string
}

const EMPTY_FORM: FormState = {
  name: '',
  isStructural: false,
  competencies: [],
  preferredTimeSlotIds: [],
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

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {}
  if (!form.name.trim()) errors.name = 'Name is required'
  return errors
}

/* ── CSV Export ── */

function exportCsv(lecturers: LecturerEnriched[]) {
  const header = 'Name,Structural,Competencies,Preferred Slots,Offerings'
  const rows = lecturers.map(
    (l) =>
      `"${l.name.replace(/"/g, '""')}",${l.isStructural ? 'Yes' : 'No'},"${l.competencies.join(', ')}",${l.preferredTimeSlotIds.length},${l.offeringCount}`,
  )
  const csv = [header, ...rows].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'lecturers.csv'
  a.click()
  URL.revokeObjectURL(url)
}

/* ══════════════════════════════════════════
   TagInput — free-text tag entry component
   ══════════════════════════════════════════ */

interface TagInputProps {
  label?: string
  helperText?: string
  value: string[]
  onChange: (tags: string[]) => void
  placeholder?: string
}

function TagInput({
  label,
  helperText,
  value,
  onChange,
  placeholder = 'Type and press Enter…',
}: TagInputProps) {
  const [input, setInput] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase()
    if (tag && !value.includes(tag)) {
      onChange([...value, tag])
    }
    setInput('')
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag))
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      addTag(input)
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1])
    }
  }

  return (
    <FormField label={label} helperText={helperText}>
      <div className={styles.tagInputWrapper} onClick={() => inputRef.current?.focus()}>
        {value.map((tag) => (
          <span key={tag} className={styles.tagInputTag}>
            {tag}
            <button
              type="button"
              className={styles.tagInputRemove}
              onClick={(e) => {
                e.stopPropagation()
                removeTag(tag)
              }}
              aria-label={`Remove ${tag}`}
            >
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className={styles.tagInputField}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (input.trim()) addTag(input)
          }}
          placeholder={value.length === 0 ? placeholder : ''}
        />
      </div>
    </FormField>
  )
}

/* ══════════════════════════════════════════
   Preferred Slots Mini-Grid
   ══════════════════════════════════════════ */

interface SlotsGridProps {
  timeslots: TimeSlotWire[]
  selected: number[]
  onChange: (ids: number[]) => void
}

function SlotsGrid({ timeslots, selected, onChange }: SlotsGridProps) {
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

  if (timeslots.length === 0) {
    return (
      <FormField label="Preferred Time Slots">
        <div className={styles.slotsGrid} style={{ gridTemplateColumns: '1fr' }}>
          <div className={styles.slotsGridEmpty}>
            No timeslots configured. Create timeslots first.
          </div>
        </div>
      </FormField>
    )
  }

  function toggle(id: number) {
    if (selected.includes(id)) {
      onChange(selected.filter((s) => s !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <FormField
      label="Preferred Time Slots"
      helperText="Select the time slots this lecturer prefers."
    >
      <div
        className={styles.slotsGrid}
        style={{ gridTemplateColumns: `80px repeat(${activeDays.length}, 1fr)` }}
      >
        {/* Header */}
        <div className={styles.slotsGridHeaderCell}>Time</div>
        {activeDays.map((d) => (
          <div key={d} className={styles.slotsGridHeaderCell}>
            {WEEKDAY_SHORT[d]}
          </div>
        ))}

        {/* Rows — one per unique time range */}
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
    </FormField>
  )
}

/* ══════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════ */

export function LecturerManagementPage() {
  const addToast = useToastStore((s) => s.addToast)
  const userRole = useAuthStore((s) => s.user?.role)
  const isAdmin = userRole === 'ADMIN'

  const [lecturers, setLecturers] = useState<LecturerEnriched[]>([])
  const [timeslots, setTimeslots] = useState<TimeSlotWire[]>([])
  const [activeSemesterId, setActiveSemesterId] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // Search & filters
  const [search, setSearch] = useState('')
  const [filterCompetencies, setFilterCompetencies] = useState<string[]>([])
  const [filterStructural, setFilterStructural] = useState<boolean | null>(null)

  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<LecturerEnriched | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<LecturerEnriched | null>(null)
  const [deleteBlocked, setDeleteBlocked] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)

  /* ── Fetch ── */

  const fetchData = useCallback(
    async (p: number, ps: number) => {
      setLoading(true)
      try {
        const [lecRes, tsRes, offRes, semRes] = await Promise.all([
          get<ListResponse<Lecturer>>('/lecturers', { page: p, pageSize: ps, sort: 'name' }),
          get<ListResponse<TimeSlotWire>>('/timeslots', { page: 1, pageSize: 500 }),
          get<ListResponse<OfferingWire>>('/course-offerings', { page: 1, pageSize: 5000 }),
          get<ListResponse<Semester>>('/semesters', { isActive: true, page: 1, pageSize: 1 }),
        ])

        setTimeslots(tsRes.data)
        setActiveSemesterId(semRes.data[0]?.id ?? null)

        const offeringCountMap = new Map<number, number>()
        for (const off of offRes.data) {
          for (const lec of off.lecturers ?? []) {
            const lid = lec.lecturerId ?? (lec as unknown as { id: number }).id
            if (lid != null) offeringCountMap.set(lid, (offeringCountMap.get(lid) ?? 0) + 1)
          }
        }

        const enriched: LecturerEnriched[] = lecRes.data.map((l) => ({
          ...l,
          offeringCount: offeringCountMap.get(l.id) ?? 0,
        }))

        setLecturers(enriched)
        setTotal(lecRes.meta.total)
      } catch {
        addToast({ type: 'error', title: 'Failed to load lecturers' })
      } finally {
        setLoading(false)
      }
    },
    [addToast],
  )

  useEffect(() => {
    fetchData(page, pageSize)
  }, [page, pageSize, fetchData])

  /* ── All known competencies (for filter) ── */

  const allCompetencies = useMemo(() => {
    const set = new Set<string>()
    for (const l of lecturers) {
      for (const c of l.competencies) set.add(c)
    }
    return [...set].sort()
  }, [lecturers])

  /* ── Client-side filtering ── */

  const filteredLecturers = useMemo(() => {
    let result = lecturers

    if (search.trim()) {
      const q = search.toLowerCase()
      result = result.filter((l) => l.name.toLowerCase().includes(q))
    }

    if (filterCompetencies.length > 0) {
      result = result.filter((l) => filterCompetencies.every((c) => l.competencies.includes(c)))
    }

    if (filterStructural !== null) {
      result = result.filter((l) => l.isStructural === filterStructural)
    }

    return result
  }, [lecturers, search, filterCompetencies, filterStructural])

  /* ── Create / Edit ── */

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(lec: LecturerEnriched) {
    setEditTarget(lec)
    setForm({
      name: lec.name,
      isStructural: lec.isStructural,
      competencies: [...lec.competencies],
      preferredTimeSlotIds: [...lec.preferredTimeSlotIds],
    })
    setFormErrors({})
    setModalOpen(true)
  }

  async function handleSave() {
    const errors = validate(form)
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    if (!editTarget && !activeSemesterId) {
      addToast({
        type: 'error',
        title: 'No active semester',
        message: 'Activate a semester before creating lecturers.',
      })
      return
    }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        competencies: form.competencies,
        preferredTimeSlotIds: form.preferredTimeSlotIds,
      }
      if (isAdmin) {
        body.isStructural = form.isStructural
      }

      if (editTarget) {
        await patch(`/lecturers/${editTarget.id}`, body)
        addToast({ type: 'success', title: 'Lecturer updated' })
      } else {
        await post('/lecturers', { semesterId: activeSemesterId, ...body })
        addToast({ type: 'success', title: 'Lecturer created' })
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

  function openDelete(lec: LecturerEnriched) {
    setDeleteTarget(lec)
    setDeleteBlocked(lec.offeringCount > 0)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await del(`/lecturers/${deleteTarget.id}`)
      addToast({ type: 'success', title: 'Lecturer deleted' })
      setDeleteTarget(null)
      setSelected((prev) => {
        const next = new Set(prev)
        next.delete(deleteTarget.id)
        return next
      })
      fetchData(page, pageSize)
    } catch (err) {
      const e = err as ApiRequestError
      if (e.status === 409) {
        setDeleteBlocked(true)
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
    let successCount = 0
    let failCount = 0

    for (const id of ids) {
      try {
        await del(`/lecturers/${id}`)
        successCount++
      } catch {
        failCount++
      }
    }

    if (successCount > 0) {
      addToast({
        type: 'success',
        title: `${successCount} lecturer${successCount > 1 ? 's' : ''} deleted`,
      })
    }
    if (failCount > 0) {
      addToast({
        type: 'error',
        title: `${failCount} lecturer${failCount > 1 ? 's' : ''} could not be deleted`,
        message: 'Some lecturers may be assigned to course offerings.',
      })
    }

    setSelected(new Set())
    setBulkDeleteOpen(false)
    setBulkDeleting(false)
    fetchData(page, pageSize)
  }

  /* ── Selection helpers ── */

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    setSelected(new Set(filteredLecturers.map((l) => l.id)))
  }

  function clearSelection() {
    setSelected(new Set())
  }

  /* ── Filter count ── */

  const activeFilterCount =
    (filterCompetencies.length > 0 ? 1 : 0) + (filterStructural !== null ? 1 : 0)

  function clearFilters() {
    setFilterCompetencies([])
    setFilterStructural(null)
  }

  /* ── Columns ── */

  const columns: Column<LecturerEnriched>[] = [
    ...(isAdmin
      ? [
          {
            key: '__select',
            header: '',
            width: '44px',
            render: (row: LecturerEnriched) => (
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onChange={() => toggleSelect(row.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select ${row.name}`}
                style={{ accentColor: 'var(--color-primary-500)' }}
              />
            ),
          } satisfies Column<LecturerEnriched>,
        ]
      : []),
    {
      key: 'name',
      header: 'Name',
      width: '220px',
      render: (row) => <span>{row.name}</span>,
    },
    {
      key: 'isStructural',
      header: 'Structural',
      width: '100px',
      render: (row) => <BooleanTag value={row.isStructural} trueLabel="Yes" falseLabel="No" />,
    },
    {
      key: 'competencies',
      header: 'Competencies',
      render: (row) =>
        row.competencies.length > 0 ? (
          <div className={styles.tagList}>
            {row.competencies.map((c) => (
              <span key={c} className={styles.tag}>
                {c}
              </span>
            ))}
          </div>
        ) : (
          <span className={styles.tagEmpty}>None</span>
        ),
    },
    {
      key: 'preferredSlots',
      header: 'Preferred Slots',
      width: '140px',
      render: (row) => <span className={styles.count}>{row.preferredTimeSlotIds.length}</span>,
    },
    {
      key: 'offeringCount',
      header: 'Offerings',
      width: '100px',
      render: (row) => <span className={styles.count}>{row.offeringCount}</span>,
    },
  ]

  /* ── Filter content for toolbar ── */

  const filterContent = (
    <div className={styles.filterPanel}>
      <div>
        <p className={styles.filterLabel}>Competency</p>
        <div className={styles.filterCheckboxGroup}>
          {allCompetencies.map((c) => (
            <label key={c} className={styles.filterCheckbox}>
              <input
                type="checkbox"
                checked={filterCompetencies.includes(c)}
                onChange={() => {
                  setFilterCompetencies((prev) =>
                    prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
                  )
                }}
              />
              {c}
            </label>
          ))}
          {allCompetencies.length === 0 && (
            <span className={styles.tagEmpty}>No competencies yet</span>
          )}
        </div>
      </div>

      <div className={styles.filterDivider} />

      <div>
        <p className={styles.filterLabel}>Structural</p>
        <div className={styles.filterCheckboxGroup}>
          <label className={styles.filterCheckbox}>
            <input
              type="radio"
              name="structural"
              checked={filterStructural === null}
              onChange={() => setFilterStructural(null)}
            />
            All
          </label>
          <label className={styles.filterCheckbox}>
            <input
              type="radio"
              name="structural"
              checked={filterStructural === true}
              onChange={() => setFilterStructural(true)}
            />
            Structural only
          </label>
          <label className={styles.filterCheckbox}>
            <input
              type="radio"
              name="structural"
              checked={filterStructural === false}
              onChange={() => setFilterStructural(false)}
            />
            Non-structural only
          </label>
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
        title="Lecturers"
        description="Manage lecturers and their competencies for the active semester."
        actions={
          <Button icon={<Plus size={16} />} onClick={openCreate}>
            Add Lecturer
          </Button>
        }
      />

      <TableToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name…"
        activeFilterCount={activeFilterCount}
        filterContent={filterContent}
        selectedCount={isAdmin ? selected.size : undefined}
        totalSelectableCount={isAdmin ? filteredLecturers.length : undefined}
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
                onClick={() => exportCsv(filteredLecturers.filter((l) => selected.has(l.id)))}
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
              onClick={() => exportCsv(filteredLecturers)}
            >
              Export CSV
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={filteredLecturers}
        keyExtractor={(row) => row.id}
        page={page}
        pageSize={pageSize}
        total={filteredLecturers.length}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s)
          setPage(1)
        }}
        loading={loading}
        emptyIcon={<Users size={48} />}
        emptyTitle="No lecturers found"
        emptyDescription={
          search || activeFilterCount > 0
            ? 'Try adjusting your search or filters.'
            : 'Create your first lecturer to begin scheduling.'
        }
        emptyAction={
          !search && activeFilterCount === 0 ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              Add Lecturer
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
                    aria-label="Edit lecturer"
                  />
                  <Button
                    variant="icon"
                    size="sm"
                    icon={<Trash2 size={16} />}
                    onClick={() => openDelete(row)}
                    aria-label="Delete lecturer"
                  />
                </>
              )
            : undefined
        }
      />

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? 'Edit Lecturer' : 'New Lecturer'}
        size="md"
        footer={
          <FormActions>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Lecturer'}
            </Button>
          </FormActions>
        }
      >
        <FormSection>
          <TextInput
            label="Name"
            placeholder="Dr. Ahmad Fauzi"
            value={form.name}
            onChange={(e) => {
              setForm((prev) => ({ ...prev, name: e.target.value }))
              setFormErrors((prev) => ({ ...prev, name: undefined }))
            }}
            error={formErrors.name}
            required
          />

          {isAdmin && (
            <Toggle
              label="Structural"
              checked={form.isStructural}
              onChange={(v) => setForm((prev) => ({ ...prev, isStructural: v }))}
            />
          )}

          <TagInput
            label="Competencies"
            helperText="Type a competency and press Enter to add. E.g., algorithms, databases, ai-ml."
            value={form.competencies}
            onChange={(tags) => setForm((prev) => ({ ...prev, competencies: tags }))}
            placeholder="Type and press Enter…"
          />

          <SlotsGrid
            timeslots={timeslots}
            selected={form.preferredTimeSlotIds}
            onChange={(ids) => setForm((prev) => ({ ...prev, preferredTimeSlotIds: ids }))}
          />
        </FormSection>
      </Modal>

      {/* Delete Confirmation — blocked variant if has offerings */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => {
          setDeleteTarget(null)
          setDeleteBlocked(false)
        }}
        onConfirm={
          deleteBlocked
            ? () => {
                setDeleteTarget(null)
                setDeleteBlocked(false)
              }
            : handleDelete
        }
        variant="danger"
        title="Delete Lecturer?"
        description={
          deleteTarget
            ? deleteBlocked
              ? ''
              : `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.`
            : ''
        }
        confirmLabel={deleteBlocked ? 'OK' : 'Delete'}
        cancelLabel={deleteBlocked ? undefined : 'Cancel'}
        loading={deleting}
      >
        {deleteTarget && deleteBlocked && (
          <div className={styles.blockedBanner}>
            This lecturer cannot be deleted because they are assigned to{' '}
            <strong>
              {deleteTarget.offeringCount} course offering
              {deleteTarget.offeringCount > 1 ? 's' : ''}
            </strong>
            . Remove the lecturer from all course offerings first.
          </div>
        )}
      </ConfirmDialog>

      {/* Bulk Delete Confirmation */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        variant="danger"
        title="Delete Selected Lecturers?"
        description={`Are you sure you want to delete ${selected.size} lecturer${selected.size > 1 ? 's' : ''}? Lecturers assigned to course offerings cannot be deleted.`}
        confirmLabel={`Delete ${selected.size}`}
        cancelLabel="Cancel"
        loading={bulkDeleting}
      />
    </>
  )
}
