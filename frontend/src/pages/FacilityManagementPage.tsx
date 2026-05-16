import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wrench, Plus, Pencil, Trash2, ArrowRight } from 'lucide-react'
import { PageHeader } from '../components/ContentArea'
import { DataTable, type Column } from '../components/DataTable'
import { Button } from '../components/Button'
import { Modal, ConfirmDialog } from '../components/Modal'
import { TextInput, FormSection, FormActions } from '../components/Form'
import { useToastStore } from '../store/toastStore'
import { get, post, patch, del } from '../lib/api'
import type { ApiRequestError } from '../lib/api'
import styles from './FacilityManagementPage.module.css'

/* ── Types ── */

interface Facility {
  id: number
  code: string
  label: string
}

interface RoomWire {
  id: number
  name: string
  facilities: string[]
}

interface CourseWire {
  id: number
  code: string
  name: string
  requiredFacilities: string[]
}

interface ListResponse<T> {
  data: T[]
  meta: { page: number; pageSize: number; total: number }
}

interface FacilityWithCounts extends Facility {
  roomCount: number
  courseCount: number
  rooms: { id: number; name: string }[]
  courses: { id: number; code: string; name: string }[]
}

interface FormState {
  code: string
  label: string
}

interface FormErrors {
  code?: string
  label?: string
}

const EMPTY_FORM: FormState = { code: '', label: '' }

function validate(form: FormState, isEdit: boolean): FormErrors {
  const errors: FormErrors = {}
  if (!isEdit && !form.code.trim()) errors.code = 'Code is required'
  if (!form.label.trim()) errors.label = 'Label is required'
  return errors
}

/* ── Popover ── */

interface PopoverProps {
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
  children: React.ReactNode
}

function Popover({ anchorRef, open, onClose, children }: PopoverProps) {
  const popRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 })

  useEffect(() => {
    if (!open || !anchorRef.current) return
    const rect = anchorRef.current.getBoundingClientRect()
    setPosition({
      top: rect.bottom + 4,
      left: Math.max(8, rect.left),
    })
  }, [open, anchorRef])

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (
        popRef.current &&
        !popRef.current.contains(e.target as Node) &&
        anchorRef.current &&
        !anchorRef.current.contains(e.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open, onClose, anchorRef])

  if (!open) return null

  return (
    <div ref={popRef} className={styles.popover} style={{ top: position.top, left: position.left }}>
      {children}
    </div>
  )
}

/* ── Count Cell (clickable with popover) ── */

interface CountCellProps {
  count: number
  facilityCode: string
  items: { id: number; label: string }[]
  popoverTitle: string
  viewAllRoute: string
  viewAllLabel: string
}

function CountCell({
  count,
  facilityCode,
  items,
  popoverTitle,
  viewAllRoute,
  viewAllLabel,
}: CountCellProps) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={styles.countButton}
        onClick={() => setOpen((prev) => !prev)}
      >
        {count}
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)}>
        <p className={styles.popoverHeader}>{popoverTitle}</p>
        {items.length === 0 ? (
          <p className={styles.popoverEmpty}>None</p>
        ) : (
          <ul className={styles.popoverList}>
            {items.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={styles.popoverItem}
                  onClick={() => {
                    setOpen(false)
                    navigate(viewAllRoute)
                  }}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className={styles.popoverFooter}
          onClick={() => {
            setOpen(false)
            navigate(viewAllRoute)
          }}
        >
          {viewAllLabel} <ArrowRight size={12} />
        </button>
      </Popover>
    </>
  )
}

/* ── Main Component ── */

export function FacilityManagementPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [facilities, setFacilities] = useState<FacilityWithCounts[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<FacilityWithCounts | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<FacilityWithCounts | null>(null)
  const [deleting, setDeleting] = useState(false)

  /* ── Fetch ── */

  const fetchFacilities = useCallback(
    async (p: number, ps: number) => {
      setLoading(true)
      try {
        const [facRes, roomsRes, coursesRes] = await Promise.all([
          get<ListResponse<Facility>>('/facilities', { page: p, pageSize: ps, sort: 'code' }),
          get<ListResponse<RoomWire>>('/rooms', { page: 1, pageSize: 500 }),
          get<ListResponse<CourseWire>>('/courses', { page: 1, pageSize: 500 }),
        ])

        const enriched: FacilityWithCounts[] = facRes.data.map((fac) => {
          const matchingRooms = roomsRes.data.filter((r) => r.facilities.includes(fac.code))
          const matchingCourses = coursesRes.data.filter((c) =>
            c.requiredFacilities.includes(fac.code),
          )
          return {
            ...fac,
            roomCount: matchingRooms.length,
            courseCount: matchingCourses.length,
            rooms: matchingRooms.map((r) => ({ id: r.id, name: r.name })),
            courses: matchingCourses.map((c) => ({ id: c.id, code: c.code, name: c.name })),
          }
        })

        setFacilities(enriched)
        setTotal(facRes.meta.total)
      } catch {
        addToast({ type: 'error', title: 'Failed to load facilities' })
      } finally {
        setLoading(false)
      }
    },
    [addToast],
  )

  useEffect(() => {
    fetchFacilities(page, pageSize)
  }, [page, pageSize, fetchFacilities])

  /* ── Create / Edit ── */

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(fac: FacilityWithCounts) {
    setEditTarget(fac)
    setForm({ code: fac.code, label: fac.label })
    setFormErrors({})
    setModalOpen(true)
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFormErrors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  async function handleSave() {
    const isEdit = editTarget !== null
    const errors = validate(form, isEdit)
    setFormErrors(errors)
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    try {
      if (isEdit) {
        await patch(`/facilities/${editTarget!.id}`, { label: form.label })
        addToast({ type: 'success', title: 'Facility updated' })
      } else {
        await post('/facilities', { code: form.code.toUpperCase(), label: form.label })
        addToast({ type: 'success', title: 'Facility created' })
      }
      setModalOpen(false)
      fetchFacilities(page, pageSize)
    } catch (err) {
      const e = err as ApiRequestError
      if (e.code === 'FACILITY_CODE_TAKEN') {
        setFormErrors((prev) => ({ ...prev, code: 'This code is already in use' }))
      } else {
        addToast({
          type: 'error',
          title: isEdit ? 'Failed to update' : 'Failed to create',
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
      await del(`/facilities/${deleteTarget.id}`)
      addToast({ type: 'success', title: 'Facility deleted' })
      setDeleteTarget(null)
      fetchFacilities(page, pageSize)
    } catch (err) {
      const e = err as ApiRequestError
      if (e.code === 'FACILITY_REFERENCED') {
        addToast({
          type: 'error',
          title: 'Cannot delete',
          message: 'This facility is referenced by rooms or courses. Remove all references first.',
        })
      } else {
        addToast({ type: 'error', title: 'Failed to delete', message: e.message })
      }
    } finally {
      setDeleting(false)
    }
  }

  /* ── Columns ── */

  const columns: Column<FacilityWithCounts>[] = [
    {
      key: 'code',
      header: 'Code',
      width: '200px',
      render: (row) => <span className={styles.mono}>{row.code}</span>,
    },
    {
      key: 'label',
      header: 'Label',
      render: (row) => <span>{row.label}</span>,
    },
    {
      key: 'roomCount',
      header: 'Rooms Using',
      width: '120px',
      render: (row) => (
        <CountCell
          count={row.roomCount}
          facilityCode={row.code}
          items={row.rooms.map((r) => ({ id: r.id, label: r.name }))}
          popoverTitle={`Rooms with ${row.code}`}
          viewAllRoute={`/rooms?facility=${row.code}`}
          viewAllLabel="View all in Rooms"
        />
      ),
    },
    {
      key: 'courseCount',
      header: 'Courses Requiring',
      width: '140px',
      render: (row) => (
        <CountCell
          count={row.courseCount}
          facilityCode={row.code}
          items={row.courses.map((c) => ({ id: c.id, label: `${c.code} — ${c.name}` }))}
          popoverTitle={`Courses requiring ${row.code}`}
          viewAllRoute={`/courses?facility=${row.code}`}
          viewAllLabel="View all in Courses"
        />
      ),
    },
  ]

  /* ── Delete description with cascade warning ── */
  const deleteDescription = deleteTarget
    ? (() => {
        const parts: string[] = [`Are you sure you want to delete "${deleteTarget.code}"?`]
        if (deleteTarget.roomCount > 0 || deleteTarget.courseCount > 0) {
          parts.push('This facility is currently referenced by:')
          if (deleteTarget.roomCount > 0)
            parts.push(`• ${deleteTarget.roomCount} room${deleteTarget.roomCount > 1 ? 's' : ''}`)
          if (deleteTarget.courseCount > 0)
            parts.push(
              `• ${deleteTarget.courseCount} course${deleteTarget.courseCount > 1 ? 's' : ''}`,
            )
          parts.push('Deletion will fail if references still exist.')
        }
        return parts.join('\n')
      })()
    : ''

  return (
    <>
      <PageHeader
        title="Facilities"
        description="Manage room facility types (LAB, PROJECTOR, STUDIO, etc.)."
        actions={
          <Button icon={<Plus size={16} />} onClick={openCreate}>
            New Facility
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={facilities}
        keyExtractor={(row) => row.id}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s)
          setPage(1)
        }}
        loading={loading}
        emptyIcon={<Wrench size={48} />}
        emptyTitle="No facilities configured"
        emptyDescription="Create your first facility to categorize room capabilities."
        emptyAction={
          <Button icon={<Plus size={16} />} onClick={openCreate}>
            New Facility
          </Button>
        }
        rowActions={(row) => (
          <>
            <Button
              variant="icon"
              size="sm"
              icon={<Pencil size={16} />}
              onClick={() => openEdit(row)}
              aria-label="Edit facility"
            />
            <Button
              variant="icon"
              size="sm"
              icon={<Trash2 size={16} />}
              onClick={() => setDeleteTarget(row)}
              aria-label="Delete facility"
            />
          </>
        )}
      />

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? 'Edit Facility' : 'New Facility'}
        size="sm"
        footer={
          <FormActions>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Facility'}
            </Button>
          </FormActions>
        }
      >
        <FormSection>
          <TextInput
            label="Code"
            placeholder="LAB"
            value={form.code}
            onChange={(e) => updateField('code', e.target.value.toUpperCase())}
            error={formErrors.code}
            required
            disabled={editTarget !== null}
          />
          <TextInput
            label="Label"
            placeholder="Computer Laboratory"
            value={form.label}
            onChange={(e) => updateField('label', e.target.value)}
            error={formErrors.label}
            required
          />
        </FormSection>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        variant="danger"
        title="Delete Facility?"
        description={deleteDescription}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deleting}
      />
    </>
  )
}
