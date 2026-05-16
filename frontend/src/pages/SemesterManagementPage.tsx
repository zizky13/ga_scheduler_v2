import { useState, useEffect, useCallback } from 'react'
import { GraduationCap, Plus, Pencil, Trash2, CheckCircle } from 'lucide-react'
import { PageHeader } from '../components/ContentArea'
import { DataTable, type Column } from '../components/DataTable'
import { Button } from '../components/Button'
import { BooleanTag } from '../components/Badge'
import { Modal, ConfirmDialog } from '../components/Modal'
import { TextInput, FormSection, FormActions } from '../components/Form'
import { useToastStore } from '../store/toastStore'
import { get, post, patch, del } from '../lib/api'
import type { ApiRequestError } from '../lib/api'
import styles from './SemesterManagementPage.module.css'

/* ── Types ── */

interface Semester {
  id: number
  code: string
  label: string
  startsOn: string
  endsOn: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface ListResponse<T> {
  data: T[]
  meta: { page: number; pageSize: number; total: number }
}

interface FormState {
  code: string
  label: string
  startsOn: string
  endsOn: string
}

interface FormErrors {
  code?: string
  label?: string
  startsOn?: string
  endsOn?: string
}

const EMPTY_FORM: FormState = { code: '', label: '', startsOn: '', endsOn: '' }

/* ── Helpers ── */

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function toInputDate(iso: string): string {
  return iso.slice(0, 10)
}

function validate(form: FormState, isEdit: boolean): FormErrors {
  const errors: FormErrors = {}
  if (!isEdit && !form.code.trim()) errors.code = 'Code is required'
  if (!form.label.trim()) errors.label = 'Label is required'
  if (!form.startsOn) errors.startsOn = 'Start date is required'
  if (!form.endsOn) errors.endsOn = 'End date is required'
  if (form.startsOn && form.endsOn && form.startsOn >= form.endsOn) {
    errors.endsOn = 'End date must be after start date'
  }
  return errors
}

/* ── Component ── */

export function SemesterManagementPage() {
  const addToast = useToastStore((s) => s.addToast)

  const [semesters, setSemesters] = useState<Semester[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<Semester | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)

  // Activate confirm
  const [activateTarget, setActivateTarget] = useState<Semester | null>(null)
  const [activating, setActivating] = useState(false)
  const activeSemester = semesters.find((s) => s.isActive)

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<Semester | null>(null)
  const [deleting, setDeleting] = useState(false)

  /* ── Fetch ── */

  const fetchSemesters = useCallback(
    async (p: number, ps: number) => {
      setLoading(true)
      try {
        const res = await get<ListResponse<Semester>>('/semesters', {
          page: p,
          pageSize: ps,
          sort: '-createdAt',
        })
        setSemesters(res.data)
        setTotal(res.meta.total)
      } catch {
        addToast({ type: 'error', title: 'Failed to load semesters' })
      } finally {
        setLoading(false)
      }
    },
    [addToast],
  )

  useEffect(() => {
    fetchSemesters(page, pageSize)
  }, [page, pageSize, fetchSemesters])

  /* ── Create / Edit ── */

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setModalOpen(true)
  }

  function openEdit(sem: Semester) {
    setEditTarget(sem)
    setForm({
      code: sem.code,
      label: sem.label,
      startsOn: toInputDate(sem.startsOn),
      endsOn: toInputDate(sem.endsOn),
    })
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
        await patch(`/semesters/${editTarget!.id}`, {
          label: form.label,
          startsOn: form.startsOn,
          endsOn: form.endsOn,
        })
        addToast({ type: 'success', title: 'Semester updated' })
      } else {
        await post('/semesters', {
          code: form.code,
          label: form.label,
          startsOn: form.startsOn,
          endsOn: form.endsOn,
        })
        addToast({ type: 'success', title: 'Semester created' })
      }
      setModalOpen(false)
      fetchSemesters(page, pageSize)
    } catch (err) {
      const e = err as ApiRequestError
      if (e.code === 'SEMESTER_CODE_TAKEN') {
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

  /* ── Activate ── */

  async function handleActivate() {
    if (!activateTarget) return
    setActivating(true)
    try {
      await post(`/semesters/${activateTarget.id}/activate`, {})
      addToast({
        type: 'success',
        title: 'Semester activated',
        message: `${activateTarget.code} is now the active semester.`,
      })
      setActivateTarget(null)
      fetchSemesters(page, pageSize)
    } catch (err) {
      const e = err as ApiRequestError
      addToast({ type: 'error', title: 'Failed to activate', message: e.message })
    } finally {
      setActivating(false)
    }
  }

  /* ── Delete ── */

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await del(`/semesters/${deleteTarget.id}`)
      addToast({ type: 'success', title: 'Semester deleted' })
      setDeleteTarget(null)
      fetchSemesters(page, pageSize)
    } catch (err) {
      const e = err as ApiRequestError
      if (e.code === 'SEMESTER_ACTIVE') {
        addToast({
          type: 'error',
          title: 'Cannot delete',
          message: 'An active semester cannot be deleted. Deactivate it first.',
        })
      } else if (e.code === 'SEMESTER_HAS_RELATED_ROWS') {
        addToast({
          type: 'error',
          title: 'Cannot delete',
          message: 'This semester has related data. Remove all related records first.',
        })
      } else {
        addToast({ type: 'error', title: 'Failed to delete', message: e.message })
      }
    } finally {
      setDeleting(false)
    }
  }

  /* ── Columns ── */

  const columns: Column<Semester>[] = [
    {
      key: 'code',
      header: 'Code',
      width: '180px',
      render: (row) => <span className={styles.mono}>{row.code}</span>,
    },
    {
      key: 'label',
      header: 'Label',
      render: (row) => <span>{row.label}</span>,
    },
    {
      key: 'startsOn',
      header: 'Start Date',
      width: '140px',
      render: (row) => <span>{formatDate(row.startsOn)}</span>,
    },
    {
      key: 'endsOn',
      header: 'End Date',
      width: '140px',
      render: (row) => <span>{formatDate(row.endsOn)}</span>,
    },
    {
      key: 'isActive',
      header: 'Status',
      width: '100px',
      render: (row) => <BooleanTag value={row.isActive} trueLabel="Active" falseLabel="Inactive" />,
    },
  ]

  return (
    <>
      <PageHeader
        title="Semesters"
        description="Manage academic semesters. Only one semester can be active at a time."
        actions={
          <Button icon={<Plus size={16} />} onClick={openCreate}>
            New Semester
          </Button>
        }
      />

      <DataTable
        columns={columns}
        data={semesters}
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
        rowClassName={(row) => (row.isActive ? styles.activeRow : undefined)}
        emptyIcon={<GraduationCap size={48} />}
        emptyTitle="No semesters configured"
        emptyDescription="Create your first semester to begin setting up schedule data."
        emptyAction={
          <Button icon={<Plus size={16} />} onClick={openCreate}>
            New Semester
          </Button>
        }
        rowActions={(row) => (
          <>
            {!row.isActive && (
              <Button
                variant="icon"
                size="sm"
                icon={<CheckCircle size={16} />}
                onClick={() => setActivateTarget(row)}
                aria-label="Activate semester"
              />
            )}
            <Button
              variant="icon"
              size="sm"
              icon={<Pencil size={16} />}
              onClick={() => openEdit(row)}
              aria-label="Edit semester"
            />
            <Button
              variant="icon"
              size="sm"
              icon={<Trash2 size={16} />}
              onClick={() => setDeleteTarget(row)}
              aria-label="Delete semester"
            />
          </>
        )}
      />

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? 'Edit Semester' : 'New Semester'}
        size="md"
        footer={
          <FormActions>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Semester'}
            </Button>
          </FormActions>
        }
      >
        <FormSection>
          <TextInput
            label="Code"
            placeholder="2025-GANJIL"
            value={form.code}
            onChange={(e) => updateField('code', e.target.value)}
            error={formErrors.code}
            required
            disabled={editTarget !== null}
          />
          <TextInput
            label="Label"
            placeholder="Semester Ganjil 2025/2026"
            value={form.label}
            onChange={(e) => updateField('label', e.target.value)}
            error={formErrors.label}
            required
          />
          <div className={styles.dateRow}>
            <TextInput
              label="Start Date"
              type="date"
              value={form.startsOn}
              onChange={(e) => updateField('startsOn', e.target.value)}
              error={formErrors.startsOn}
              required
            />
            <TextInput
              label="End Date"
              type="date"
              value={form.endsOn}
              onChange={(e) => updateField('endsOn', e.target.value)}
              error={formErrors.endsOn}
              required
            />
          </div>
        </FormSection>
      </Modal>

      {/* Activate Confirmation */}
      <ConfirmDialog
        open={activateTarget !== null}
        onClose={() => setActivateTarget(null)}
        onConfirm={handleActivate}
        variant="warning"
        title="Activate Semester?"
        description={
          activateTarget
            ? activeSemester
              ? `This will deactivate the current semester "${activeSemester.code}" and activate "${activateTarget.code}". All data views will switch to the new semester.`
              : `This will activate "${activateTarget.code}". All data views will switch to this semester.`
            : ''
        }
        confirmLabel="Activate"
        cancelLabel="Cancel"
        loading={activating}
      />

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        variant="danger"
        title="Delete Semester?"
        description={
          deleteTarget
            ? `Are you sure you want to delete "${deleteTarget.code}"? This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deleting}
      />
    </>
  )
}
