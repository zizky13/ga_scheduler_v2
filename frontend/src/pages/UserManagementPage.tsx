import { useState, useEffect, useCallback, useMemo } from 'react'
import { Shield, Plus, Pencil, UserX, UserCheck, Key, X } from 'lucide-react'
import { PageHeader } from '../components/ContentArea'
import { DataTable, type Column } from '../components/DataTable'
import { TableToolbar } from '../components/TableToolbar'
import { Button } from '../components/Button'
import { RoleBadge, BooleanTag } from '../components/Badge'
import { Modal, ConfirmDialog } from '../components/Modal'
import { TextInput, Select, Toggle, FormSection, FormActions } from '../components/Form'
import { useToastStore } from '../store/toastStore'
import { useAuthStore } from '../store/authStore'
import { get, post, patch, del } from '../lib/api'
import type { ApiRequestError } from '../lib/api'
import styles from './UserManagementPage.module.css'

/* ── Types ── */

type WireRole = 'admin' | 'user'

interface UserWire {
  id: number
  email: string
  fullName: string
  role: WireRole
  isActive: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
}

interface ListResponse<T> {
  data: T[]
  meta: { page: number; pageSize: number; total: number }
}

interface FormState {
  fullName: string
  email: string
  password: string
  role: WireRole
  isActive: boolean
}

interface FormErrors {
  fullName?: string
  email?: string
  password?: string
}

const EMPTY_FORM: FormState = {
  fullName: '',
  email: '',
  password: '',
  role: 'user',
  isActive: true,
}

const ROLE_OPTIONS = [
  { value: 'user', label: 'User' },
  { value: 'admin', label: 'Admin' },
]

function validateCreate(form: FormState): FormErrors {
  const errors: FormErrors = {}
  if (!form.fullName.trim()) errors.fullName = 'Name is required'
  if (!form.email.trim()) errors.email = 'Email is required'
  if (!form.password || form.password.length < 10)
    errors.password = 'Password must be at least 10 characters'
  return errors
}

function validateEdit(form: FormState): FormErrors {
  const errors: FormErrors = {}
  if (!form.fullName.trim()) errors.fullName = 'Name is required'
  return errors
}

function formatRelativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

/* ══════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════ */

export function UserManagementPage() {
  const addToast = useToastStore((s) => s.addToast)
  const currentUser = useAuthStore((s) => s.user)

  const [users, setUsers] = useState<UserWire[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  // Search & filters
  const [search, setSearch] = useState('')
  const [filterRole, setFilterRole] = useState<WireRole | null>(null)
  const [filterActive, setFilterActive] = useState<boolean | null>(null)

  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<UserWire | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)

  // Reset password in edit mode
  const [resetPwOpen, setResetPwOpen] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Deactivate/Activate confirm
  const [deactivateTarget, setDeactivateTarget] = useState<UserWire | null>(null)
  const [deactivating, setDeactivating] = useState(false)

  /* ── Fetch ── */

  const fetchData = useCallback(
    async (p: number, ps: number) => {
      setLoading(true)
      try {
        const params: Record<string, unknown> = { page: p, pageSize: ps, sort: 'fullName' }
        if (filterRole) params.role = filterRole
        if (filterActive !== null) params.isActive = filterActive
        const res = await get<ListResponse<UserWire>>('/users', params)
        setUsers(res.data)
        setTotal(res.meta.total)
      } catch {
        addToast({ type: 'error', title: 'Failed to load users' })
      } finally {
        setLoading(false)
      }
    },
    [addToast, filterRole, filterActive],
  )

  useEffect(() => {
    fetchData(page, pageSize)
  }, [page, pageSize, fetchData])

  /* ── Client-side search (server handles role/active filters) ── */

  const filteredUsers = useMemo(() => {
    if (!search.trim()) return users
    const q = search.toLowerCase()
    return users.filter(
      (u) => u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    )
  }, [users, search])

  /* ── Create / Edit ── */

  function openCreate() {
    setEditTarget(null)
    setForm(EMPTY_FORM)
    setFormErrors({})
    setResetPwOpen(false)
    setNewPassword('')
    setConfirmPassword('')
    setModalOpen(true)
  }

  function openEdit(user: UserWire) {
    setEditTarget(user)
    setForm({
      fullName: user.fullName,
      email: user.email,
      password: '',
      role: user.role,
      isActive: user.isActive,
    })
    setFormErrors({})
    setResetPwOpen(false)
    setNewPassword('')
    setConfirmPassword('')
    setModalOpen(true)
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFormErrors((prev) => {
      const next = { ...prev }
      delete next[key as keyof FormErrors]
      return next
    })
  }

  async function handleSave() {
    if (editTarget) {
      // Edit mode
      const errors = validateEdit(form)
      setFormErrors(errors)
      if (Object.keys(errors).length > 0) return

      // Check password reset validation
      if (resetPwOpen) {
        if (newPassword.length < 10) {
          setFormErrors({ password: 'Password must be at least 10 characters' })
          return
        }
        if (newPassword !== confirmPassword) {
          setFormErrors({ password: 'Passwords do not match' })
          return
        }
      }

      const isSelf = currentUser && String(currentUser.id) === String(editTarget.id)

      setSaving(true)
      try {
        const body: Record<string, unknown> = {}
        if (form.fullName !== editTarget.fullName) body.fullName = form.fullName
        if (form.role !== editTarget.role && !isSelf) body.role = form.role
        if (form.isActive !== editTarget.isActive && !isSelf) body.isActive = form.isActive

        if (Object.keys(body).length > 0) {
          await patch(`/users/${editTarget.id}`, body)
        }

        addToast({ type: 'success', title: 'User updated' })
        setModalOpen(false)
        fetchData(page, pageSize)
      } catch (err) {
        const e = err as ApiRequestError
        if (e.code === 'SELF_DEMOTION_FORBIDDEN') {
          addToast({ type: 'error', title: 'Cannot demote yourself' })
        } else if (e.code === 'SELF_DEACTIVATION_FORBIDDEN') {
          addToast({ type: 'error', title: 'Cannot deactivate yourself' })
        } else {
          addToast({ type: 'error', title: 'Failed to update user', message: e.message })
        }
      } finally {
        setSaving(false)
      }
    } else {
      // Create mode
      const errors = validateCreate(form)
      setFormErrors(errors)
      if (Object.keys(errors).length > 0) return

      setSaving(true)
      try {
        await post('/auth/register', {
          email: form.email,
          password: form.password,
          fullName: form.fullName,
          role: form.role,
        })
        addToast({ type: 'success', title: 'User created' })
        setModalOpen(false)
        fetchData(page, pageSize)
      } catch (err) {
        const e = err as ApiRequestError
        if (e.code === 'EMAIL_ALREADY_USED') {
          setFormErrors({ email: 'This email is already registered' })
        } else {
          addToast({ type: 'error', title: 'Failed to create user', message: e.message })
        }
      } finally {
        setSaving(false)
      }
    }
  }

  /* ── Deactivate / Activate ── */

  async function handleDeactivate() {
    if (!deactivateTarget) return
    setDeactivating(true)
    try {
      if (deactivateTarget.isActive) {
        await del(`/users/${deactivateTarget.id}`)
        addToast({ type: 'success', title: `${deactivateTarget.fullName} deactivated` })
      } else {
        await patch(`/users/${deactivateTarget.id}`, { isActive: true })
        addToast({ type: 'success', title: `${deactivateTarget.fullName} activated` })
      }
      setDeactivateTarget(null)
      fetchData(page, pageSize)
    } catch (err) {
      const e = err as ApiRequestError
      if (e.code === 'SELF_DEACTIVATION_FORBIDDEN') {
        addToast({ type: 'error', title: 'Cannot deactivate yourself' })
      } else if (e.code === 'ALREADY_DEACTIVATED') {
        addToast({ type: 'warning', title: 'User is already deactivated' })
        fetchData(page, pageSize)
      } else {
        addToast({ type: 'error', title: 'Action failed', message: e.message })
      }
    } finally {
      setDeactivating(false)
    }
  }

  /* ── Filter count ── */

  const activeFilterCount = (filterRole !== null ? 1 : 0) + (filterActive !== null ? 1 : 0)

  function clearFilters() {
    setFilterRole(null)
    setFilterActive(null)
  }

  /* ── Columns ── */

  const columns: Column<UserWire>[] = [
    {
      key: 'fullName',
      header: 'Name',
      width: '200px',
      render: (row) => <span>{row.fullName}</span>,
    },
    {
      key: 'email',
      header: 'Email',
      width: '220px',
      render: (row) => <span className={styles.emailCell}>{row.email}</span>,
    },
    {
      key: 'role',
      header: 'Role',
      width: '100px',
      render: (row) => <RoleBadge role={row.role.toUpperCase() as 'ADMIN' | 'USER'} />,
    },
    {
      key: 'isActive',
      header: 'Status',
      width: '100px',
      render: (row) => <BooleanTag value={row.isActive} trueLabel="Active" falseLabel="Inactive" />,
    },
    {
      key: 'lastLoginAt',
      header: 'Last Login',
      width: '160px',
      render: (row) =>
        row.lastLoginAt ? (
          <span className={styles.loginCell}>{formatRelativeTime(row.lastLoginAt)}</span>
        ) : (
          <span className={styles.loginNever}>Never</span>
        ),
    },
    {
      key: 'createdAt',
      header: 'Created',
      width: '140px',
      render: (row) => <span className={styles.dateCell}>{formatDate(row.createdAt)}</span>,
    },
  ]

  /* ── Filter content ── */

  const filterContent = (
    <div className={styles.filterPanel}>
      <div>
        <p className={styles.filterLabel}>Role</p>
        <div className={styles.filterCheckboxGroup}>
          {([null, 'admin', 'user'] as const).map((v) => (
            <label key={String(v)} className={styles.filterCheckbox}>
              <input
                type="radio"
                name="filterRole"
                checked={filterRole === v}
                onChange={() => setFilterRole(v)}
              />
              {v === null ? 'All' : v === 'admin' ? 'Admin' : 'User'}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.filterDivider} />

      <div>
        <p className={styles.filterLabel}>Status</p>
        <div className={styles.filterCheckboxGroup}>
          {([null, true, false] as const).map((v) => (
            <label key={String(v)} className={styles.filterCheckbox}>
              <input
                type="radio"
                name="filterActive"
                checked={filterActive === v}
                onChange={() => setFilterActive(v)}
              />
              {v === null ? 'All' : v ? 'Active only' : 'Inactive only'}
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

  const isSelfTarget = (u: UserWire) => currentUser && String(currentUser.id) === String(u.id)

  return (
    <>
      <PageHeader
        title="Users"
        description="Manage user accounts and roles."
        actions={
          <Button icon={<Plus size={16} />} onClick={openCreate}>
            Add User
          </Button>
        }
      />

      <TableToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name or email…"
        activeFilterCount={activeFilterCount}
        filterContent={filterContent}
      />

      <DataTable
        columns={columns}
        data={filteredUsers}
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
        emptyIcon={<Shield size={48} />}
        emptyTitle="No users found"
        emptyDescription={
          search || activeFilterCount > 0
            ? 'Try adjusting your search or filters.'
            : 'Create your first user to get started.'
        }
        emptyAction={
          !search && activeFilterCount === 0 ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              Add User
            </Button>
          ) : undefined
        }
        rowActions={(row) => (
          <>
            <Button
              variant="icon"
              size="sm"
              icon={<Pencil size={16} />}
              onClick={() => openEdit(row)}
              aria-label="Edit user"
            />
            {!isSelfTarget(row) && (
              <Button
                variant="icon"
                size="sm"
                icon={row.isActive ? <UserX size={16} /> : <UserCheck size={16} />}
                onClick={() => setDeactivateTarget(row)}
                aria-label={row.isActive ? 'Deactivate user' : 'Activate user'}
              />
            )}
          </>
        )}
      />

      {/* Create / Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editTarget ? 'Edit User' : 'New User'}
        size="md"
        footer={
          <FormActions>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create User'}
            </Button>
          </FormActions>
        }
      >
        <FormSection>
          <TextInput
            label="Full Name"
            placeholder="John Doe"
            value={form.fullName}
            onChange={(e) => updateField('fullName', e.target.value)}
            error={formErrors.fullName}
            required
          />

          {!editTarget ? (
            <TextInput
              label="Email"
              type="email"
              placeholder="john@example.com"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              error={formErrors.email}
              required
            />
          ) : (
            <TextInput label="Email" value={editTarget.email} disabled onChange={() => {}} />
          )}

          {/* Password: show on create, reset button on edit */}
          {!editTarget ? (
            <TextInput
              label="Password"
              type="password"
              placeholder="Min 10 characters"
              value={form.password}
              onChange={(e) => updateField('password', e.target.value)}
              error={formErrors.password}
              required
            />
          ) : (
            <div>
              {!resetPwOpen ? (
                <button
                  type="button"
                  className={styles.resetPasswordTrigger}
                  onClick={() => setResetPwOpen(true)}
                >
                  <Key size={14} />
                  Reset Password
                </button>
              ) : (
                <div className={styles.resetPasswordPanel}>
                  <div className={styles.resetPasswordHeader}>
                    <span className={styles.resetPasswordTitle}>Reset Password</span>
                    <button
                      type="button"
                      className={styles.resetPasswordClose}
                      onClick={() => {
                        setResetPwOpen(false)
                        setNewPassword('')
                        setConfirmPassword('')
                      }}
                      aria-label="Cancel password reset"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <TextInput
                    label="New Password"
                    type="password"
                    placeholder="Min 10 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <TextInput
                    label="Confirm Password"
                    type="password"
                    placeholder="Re-enter new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                  />
                  {confirmPassword && newPassword !== confirmPassword && (
                    <p className={styles.passwordMismatch}>Passwords do not match.</p>
                  )}
                </div>
              )}
            </div>
          )}

          <Select
            label="Role"
            options={ROLE_OPTIONS}
            value={form.role}
            onChange={(v) => updateField('role', v as WireRole)}
            disabled={editTarget ? (isSelfTarget(editTarget) ?? false) : false}
            required
          />

          <Toggle
            label="Active"
            checked={form.isActive}
            onChange={(v) => updateField('isActive', v)}
            disabled={editTarget ? (isSelfTarget(editTarget) ?? false) : false}
          />
        </FormSection>
      </Modal>

      {/* Deactivate / Activate Confirmation */}
      <ConfirmDialog
        open={deactivateTarget !== null}
        onClose={() => setDeactivateTarget(null)}
        onConfirm={handleDeactivate}
        variant={deactivateTarget?.isActive ? 'warning' : 'warning'}
        title={deactivateTarget?.isActive ? 'Deactivate User?' : 'Activate User?'}
        description={
          deactivateTarget
            ? deactivateTarget.isActive
              ? `Deactivate ${deactivateTarget.fullName}? They will no longer be able to log in.`
              : `Activate ${deactivateTarget.fullName}? They will be able to log in again.`
            : ''
        }
        confirmLabel={deactivateTarget?.isActive ? 'Deactivate' : 'Activate'}
        cancelLabel="Cancel"
        loading={deactivating}
      />
    </>
  )
}
