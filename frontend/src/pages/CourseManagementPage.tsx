import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { BookOpen, Plus, Pencil, Trash2, Download, X } from 'lucide-react';
import { PageHeader } from '../components/ContentArea';
import { DataTable, type Column } from '../components/DataTable';
import { TableToolbar } from '../components/TableToolbar';
import { Button } from '../components/Button';
import { Modal, ConfirmDialog } from '../components/Modal';
import { TextInput, NumberInput, MultiSelect, FormSection, FormActions } from '../components/Form';
import { useToastStore } from '../store/toastStore';
import { useAuthStore } from '../store/authStore';
import { get, post, patch, del } from '../lib/api';
import type { ApiRequestError } from '../lib/api';
import styles from './CourseManagementPage.module.css';

/* ── Types ── */

interface Course {
  id: number;
  semesterId: number;
  code: string;
  name: string;
  sks: number;
  requiredFacilities: string[];
  requiredCompetencies: string[];
}

interface Facility {
  id: number;
  code: string;
  label: string;
}

interface OfferingWire {
  id: number;
  courseId: number;
}

interface Semester {
  id: number;
  isActive: boolean;
}

interface ListResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

interface CourseEnriched extends Course {
  offeringCount: number;
}

interface FormState {
  code: string;
  name: string;
  sks: number;
  requiredCompetencies: string[];
  requiredFacilities: string[];
}

interface FormErrors {
  code?: string;
  name?: string;
  sks?: string;
}

const EMPTY_FORM: FormState = {
  code: '',
  name: '',
  sks: 2,
  requiredCompetencies: [],
  requiredFacilities: [],
};

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.code.trim()) errors.code = 'Code is required';
  if (!form.name.trim()) errors.name = 'Name is required';
  if (form.sks < 1 || form.sks > 6) errors.sks = 'SKS must be between 1 and 6';
  return errors;
}

/* ── CSV Export ── */

function exportCsv(courses: CourseEnriched[]) {
  const header = 'Code,Name,SKS,Required Competencies,Required Facilities,Offerings';
  const rows = courses.map(
    (c) =>
      `"${c.code}","${c.name.replace(/"/g, '""')}",${c.sks},"${c.requiredCompetencies.join(', ')}","${c.requiredFacilities.join(', ')}",${c.offeringCount}`,
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'courses.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ══════════════════════════════════════════
   TagInput — free-text tag entry component
   ══════════════════════════════════════════ */

interface TagInputProps {
  label?: string;
  helperText?: string;
  value: string[];
  onChange: (tags: string[]) => void;
  placeholder?: string;
}

function TagInput({ label, helperText, value, onChange, placeholder = 'Type and press Enter…' }: TagInputProps) {
  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  function addTag(raw: string) {
    const tag = raw.trim().toLowerCase();
    if (tag && !value.includes(tag)) {
      onChange([...value, tag]);
    }
    setInput('');
  }

  function removeTag(tag: string) {
    onChange(value.filter((t) => t !== tag));
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTag(input);
    } else if (e.key === 'Backspace' && !input && value.length > 0) {
      removeTag(value[value.length - 1]);
    }
  }

  return (
    <div>
      {label && (
        <label style={{ display: 'block', fontSize: 'var(--text-body-sm)', fontWeight: 500, color: 'var(--color-secondary-700)', marginBottom: '6px' }}>
          {label}
        </label>
      )}
      <div
        className={styles.tagInputWrapper}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((tag) => (
          <span key={tag} className={styles.tagInputTag}>
            {tag}
            <button
              type="button"
              className={styles.tagInputRemove}
              onClick={(e) => {
                e.stopPropagation();
                removeTag(tag);
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
          onBlur={() => { if (input.trim()) addTag(input); }}
          placeholder={value.length === 0 ? placeholder : ''}
        />
      </div>
      {helperText && (
        <p style={{ fontSize: 'var(--text-caption)', color: 'var(--color-secondary-400)', marginTop: '4px', marginBottom: 0 }}>
          {helperText}
        </p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════ */

export function CourseManagementPage() {
  const addToast = useToastStore((s) => s.addToast);
  const userRole = useAuthStore((s) => s.user?.role);
  const isAdmin = userRole === 'ADMIN';

  const [courses, setCourses] = useState<CourseEnriched[]>([]);
  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const [activeSemesterId, setActiveSemesterId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Search & filters
  const [search, setSearch] = useState('');
  const [filterSks, setFilterSks] = useState<number[]>([]);
  const [filterFacilities, setFilterFacilities] = useState<string[]>([]);

  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<CourseEnriched | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<CourseEnriched | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteBlocked, setDeleteBlocked] = useState(false);

  // Bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  /* ── Fetch ── */

  const fetchData = useCallback(
    async (p: number, ps: number) => {
      setLoading(true);
      try {
        const [courseRes, facRes, offRes, semRes] = await Promise.all([
          get<ListResponse<Course>>('/courses', { page: p, pageSize: ps, sort: 'code' }),
          get<ListResponse<Facility>>('/facilities', { page: 1, pageSize: 500 }),
          get<ListResponse<OfferingWire>>('/course-offerings', { page: 1, pageSize: 5000 }),
          get<ListResponse<Semester>>('/semesters', { isActive: true, page: 1, pageSize: 1 }),
        ]);

        setAllFacilities(facRes.data);
        setActiveSemesterId(semRes.data[0]?.id ?? null);

        const offeringCountMap = new Map<number, number>();
        for (const off of offRes.data) {
          const cid = off.courseId;
          if (cid != null) offeringCountMap.set(cid, (offeringCountMap.get(cid) ?? 0) + 1);
        }

        const enriched: CourseEnriched[] = courseRes.data.map((c) => ({
          ...c,
          offeringCount: offeringCountMap.get(c.id) ?? 0,
        }));

        setCourses(enriched);
        setTotal(courseRes.meta.total);
      } catch {
        addToast({ type: 'error', title: 'Failed to load courses' });
      } finally {
        setLoading(false);
      }
    },
    [addToast],
  );

  useEffect(() => {
    fetchData(page, pageSize);
  }, [page, pageSize, fetchData]);

  /* ── Derived data for filters ── */

  const allSksValues = useMemo(() => {
    const set = new Set<number>();
    for (const c of courses) set.add(c.sks);
    return [...set].sort((a, b) => a - b);
  }, [courses]);

  /* ── Client-side filtering ── */

  const filteredCourses = useMemo(() => {
    let result = courses;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.code.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q),
      );
    }

    if (filterSks.length > 0) {
      result = result.filter((c) => filterSks.includes(c.sks));
    }

    if (filterFacilities.length > 0) {
      result = result.filter((c) =>
        filterFacilities.every((f) => c.requiredFacilities.includes(f)),
      );
    }

    return result;
  }, [courses, search, filterSks, filterFacilities]);

  /* ── Create / Edit ── */

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setModalOpen(true);
  }

  function openEdit(course: CourseEnriched) {
    setEditTarget(course);
    setForm({
      code: course.code,
      name: course.name,
      sks: course.sks,
      requiredCompetencies: [...course.requiredCompetencies],
      requiredFacilities: [...course.requiredFacilities],
    });
    setFormErrors({});
    setModalOpen(true);
  }

  function updateField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setFormErrors((prev) => {
      const next = { ...prev };
      delete next[key as keyof FormErrors];
      return next;
    });
  }

  async function handleSave() {
    const errors = validate(form);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    if (!editTarget && !activeSemesterId) {
      addToast({ type: 'error', title: 'No active semester', message: 'Activate a semester before creating courses.' });
      return;
    }

    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        code: form.code.toUpperCase(),
        name: form.name,
        sks: form.sks,
        requiredCompetencies: form.requiredCompetencies,
        requiredFacilities: form.requiredFacilities,
      };

      if (editTarget) {
        await patch(`/courses/${editTarget.id}`, body);
        addToast({ type: 'success', title: 'Course updated' });
      } else {
        await post('/courses', { semesterId: activeSemesterId, ...body });
        addToast({ type: 'success', title: 'Course created' });
      }
      setModalOpen(false);
      fetchData(page, pageSize);
    } catch (err) {
      const e = err as ApiRequestError;
      if (e.code === 'COURSE_CODE_TAKEN') {
        setFormErrors((prev) => ({ ...prev, code: 'This course code already exists for the active semester' }));
      } else if (e.code === 'UNKNOWN_FACILITY') {
        addToast({ type: 'error', title: 'Unknown facility', message: e.message });
      } else {
        addToast({
          type: 'error',
          title: editTarget ? 'Failed to update' : 'Failed to create',
          message: e.message,
        });
      }
    } finally {
      setSaving(false);
    }
  }

  /* ── Delete ── */

  function openDelete(course: CourseEnriched) {
    setDeleteTarget(course);
    setDeleteBlocked(course.offeringCount > 0);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del(`/courses/${deleteTarget.id}`);
      addToast({ type: 'success', title: 'Course deleted' });
      setDeleteTarget(null);
      setDeleteBlocked(false);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      fetchData(page, pageSize);
    } catch (err) {
      const e = err as ApiRequestError;
      if (e.code === 'COURSE_REFERENCED' || e.status === 409) {
        setDeleteBlocked(true);
      } else {
        addToast({ type: 'error', title: 'Failed to delete', message: e.message });
      }
    } finally {
      setDeleting(false);
    }
  }

  /* ── Bulk delete ── */

  async function handleBulkDelete() {
    setBulkDeleting(true);
    const ids = [...selected];
    let successCount = 0;
    let failCount = 0;

    for (const id of ids) {
      try {
        await del(`/courses/${id}`);
        successCount++;
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      addToast({ type: 'success', title: `${successCount} course${successCount > 1 ? 's' : ''} deleted` });
    }
    if (failCount > 0) {
      addToast({
        type: 'error',
        title: `${failCount} course${failCount > 1 ? 's' : ''} could not be deleted`,
        message: 'Some courses may be referenced by course offerings.',
      });
    }

    setSelected(new Set());
    setBulkDeleteOpen(false);
    setBulkDeleting(false);
    fetchData(page, pageSize);
  }

  /* ── Selection helpers ── */

  function toggleSelect(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectAll() {
    setSelected(new Set(filteredCourses.map((c) => c.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  /* ── Filter count ── */

  const activeFilterCount =
    (filterSks.length > 0 ? 1 : 0) +
    (filterFacilities.length > 0 ? 1 : 0);

  function clearFilters() {
    setFilterSks([]);
    setFilterFacilities([]);
  }

  /* ── Facility options for multi-select ── */

  const facilityOptions = allFacilities.map((f) => ({
    value: f.code,
    label: `${f.code} — ${f.label}`,
  }));

  /* ── Columns ── */

  const columns: Column<CourseEnriched>[] = [
    ...(isAdmin
      ? [
          {
            key: '__select',
            header: '',
            width: '44px',
            render: (row: CourseEnriched) => (
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onChange={() => toggleSelect(row.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select ${row.code}`}
                style={{ accentColor: 'var(--color-primary-500)' }}
              />
            ),
          } satisfies Column<CourseEnriched>,
        ]
      : []),
    {
      key: 'code',
      header: 'Code',
      width: '120px',
      render: (row) => <span className={styles.codeCell}>{row.code}</span>,
    },
    {
      key: 'name',
      header: 'Name',
      render: (row) => <span>{row.name}</span>,
    },
    {
      key: 'sks',
      header: 'SKS',
      width: '80px',
      render: (row) => <span className={styles.sksBadge}>{row.sks}</span>,
    },
    {
      key: 'requiredCompetencies',
      header: 'Required Competencies',
      width: '180px',
      render: (row) =>
        row.requiredCompetencies.length > 0 ? (
          <div className={styles.tagList}>
            {row.requiredCompetencies.map((c) => (
              <span key={c} className={styles.tag}>{c}</span>
            ))}
          </div>
        ) : (
          <span className={styles.tagEmpty}>None</span>
        ),
    },
    {
      key: 'requiredFacilities',
      header: 'Required Facilities',
      width: '160px',
      render: (row) =>
        row.requiredFacilities.length > 0 ? (
          <div className={styles.tagList}>
            {row.requiredFacilities.map((f) => (
              <span key={f} className={styles.tag}>{f}</span>
            ))}
          </div>
        ) : (
          <span className={styles.tagEmpty}>None</span>
        ),
    },
    {
      key: 'offeringCount',
      header: 'Offerings',
      width: '80px',
      render: (row) => <span className={styles.count}>{row.offeringCount}</span>,
    },
  ];

  /* ── Filter content for toolbar ── */

  const filterContent = (
    <div className={styles.filterPanel}>
      <div>
        <p className={styles.filterLabel}>SKS</p>
        <div className={styles.filterCheckboxGroup}>
          {(allSksValues.length > 0 ? allSksValues : [1, 2, 3, 4]).map((sks) => (
            <label key={sks} className={styles.filterCheckbox}>
              <input
                type="checkbox"
                checked={filterSks.includes(sks)}
                onChange={() => {
                  setFilterSks((prev) =>
                    prev.includes(sks) ? prev.filter((s) => s !== sks) : [...prev, sks],
                  );
                }}
              />
              {sks} SKS
            </label>
          ))}
        </div>
      </div>

      <div className={styles.filterDivider} />

      <div>
        <p className={styles.filterLabel}>Required Facility</p>
        <div className={styles.filterCheckboxGroup}>
          {allFacilities.map((f) => (
            <label key={f.code} className={styles.filterCheckbox}>
              <input
                type="checkbox"
                checked={filterFacilities.includes(f.code)}
                onChange={() => {
                  setFilterFacilities((prev) =>
                    prev.includes(f.code)
                      ? prev.filter((c) => c !== f.code)
                      : [...prev, f.code],
                  );
                }}
              />
              {f.code} — {f.label}
            </label>
          ))}
          {allFacilities.length === 0 && (
            <span className={styles.tagEmpty}>No facilities configured</span>
          )}
        </div>
      </div>

      {activeFilterCount > 0 && (
        <>
          <div className={styles.filterDivider} />
          <div className={styles.filterActions}>
            <button
              type="button"
              className={styles.filterClearButton}
              onClick={clearFilters}
            >
              Clear all filters
            </button>
          </div>
        </>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Courses"
        description="Manage courses for the active semester."
        actions={
          <Button icon={<Plus size={16} />} onClick={openCreate}>
            + Add Course
          </Button>
        }
      />

      <TableToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by code or name…"
        activeFilterCount={activeFilterCount}
        filterContent={filterContent}
        selectedCount={isAdmin ? selected.size : undefined}
        totalSelectableCount={isAdmin ? filteredCourses.length : undefined}
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
                onClick={() => exportCsv(filteredCourses.filter((c) => selected.has(c.id)))}
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
              onClick={() => exportCsv(filteredCourses)}
            >
              Export CSV
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={filteredCourses}
        keyExtractor={(row) => row.id}
        page={page}
        pageSize={pageSize}
        total={filteredCourses.length}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        loading={loading}
        emptyIcon={<BookOpen size={48} />}
        emptyTitle="No courses found"
        emptyDescription={
          search || activeFilterCount > 0
            ? 'Try adjusting your search or filters.'
            : 'Create your first course to begin scheduling.'
        }
        emptyAction={
          !search && activeFilterCount === 0 ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              + Add Course
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
                    aria-label="Edit course"
                  />
                  <Button
                    variant="icon"
                    size="sm"
                    icon={<Trash2 size={16} />}
                    onClick={() => openDelete(row)}
                    aria-label="Delete course"
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
        title={editTarget ? 'Edit Course' : 'New Course'}
        size="md"
        footer={
          <FormActions>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Course'}
            </Button>
          </FormActions>
        }
      >
        <FormSection>
          <TextInput
            label="Code"
            placeholder="IF101"
            value={form.code}
            onChange={(e) => updateField('code', e.target.value)}
            error={formErrors.code}
            required
            style={{ textTransform: 'uppercase' }}
          />
          <TextInput
            label="Name"
            placeholder="Introduction to Programming"
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            error={formErrors.name}
            required
          />
          <NumberInput
            label="SKS"
            value={form.sks}
            onChange={(v) => updateField('sks', v)}
            error={formErrors.sks}
            min={1}
            max={6}
            required
          />
          <TagInput
            label="Required Competencies"
            helperText="Type a competency and press Enter. E.g., algorithms, databases, ai-ml."
            value={form.requiredCompetencies}
            onChange={(tags) => updateField('requiredCompetencies', tags as string[] & FormState['requiredCompetencies'])}
            placeholder="Type and press Enter…"
          />
          <MultiSelect
            label="Required Facilities"
            placeholder="Select facilities…"
            options={facilityOptions}
            value={form.requiredFacilities}
            onChange={(v) => updateField('requiredFacilities', v)}
            helperText="Select the facilities required to teach this course."
          />
        </FormSection>
      </Modal>

      {/* Delete Confirmation — blocked variant if has offerings */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => { setDeleteTarget(null); setDeleteBlocked(false); }}
        onConfirm={deleteBlocked ? () => { setDeleteTarget(null); setDeleteBlocked(false); } : handleDelete}
        variant="danger"
        title="Delete Course?"
        description={
          deleteTarget
            ? deleteBlocked
              ? ''
              : `Are you sure you want to delete "${deleteTarget.code} — ${deleteTarget.name}"? This action cannot be undone.`
            : ''
        }
        confirmLabel={deleteBlocked ? 'OK' : 'Delete'}
        cancelLabel={deleteBlocked ? undefined : 'Cancel'}
        loading={deleting}
      >
        {deleteTarget && deleteBlocked && (
          <div className={styles.blockedBanner}>
            This course cannot be deleted because it has{' '}
            <strong>{deleteTarget.offeringCount} course offering{deleteTarget.offeringCount > 1 ? 's' : ''}</strong>.
            Remove all offerings for this course first.
          </div>
        )}
      </ConfirmDialog>

      {/* Bulk Delete Confirmation */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        variant="danger"
        title="Delete Selected Courses?"
        description={`Are you sure you want to delete ${selected.size} course${selected.size > 1 ? 's' : ''}? Courses referenced by offerings cannot be deleted.`}
        confirmLabel={`Delete ${selected.size}`}
        cancelLabel="Cancel"
        loading={bulkDeleting}
      />
    </>
  );
}
