import { useState, useEffect, useCallback, useMemo } from 'react';
import { DoorOpen, Plus, Pencil, Trash2, Download } from 'lucide-react';
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
import styles from './RoomManagementPage.module.css';

/* ── Types ── */

interface Room {
  id: number;
  name: string;
  capacity: number;
  facilities: string[];
  semesterId: number;
}

interface Facility {
  id: number;
  code: string;
  label: string;
}

interface OfferingWire {
  id: number;
  roomId: number;
}

interface Semester {
  id: number;
  code: string;
  isActive: boolean;
}

interface ListResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

interface RoomEnriched extends Room {
  offeringCount: number;
}

interface FormState {
  name: string;
  capacity: number;
  facilities: string[];
}

interface FormErrors {
  name?: string;
  capacity?: string;
}

const EMPTY_FORM: FormState = { name: '', capacity: 0, facilities: [] };

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = 'Name is required';
  if (form.capacity < 1) errors.capacity = 'Capacity must be at least 1';
  return errors;
}

/* ── CSV Export ── */

function exportCsv(rooms: RoomEnriched[]) {
  const header = 'Name,Capacity,Facilities,Offerings';
  const rows = rooms.map(
    (r) =>
      `"${r.name.replace(/"/g, '""')}",${r.capacity},"${r.facilities.join(', ')}",${r.offeringCount}`,
  );
  const csv = [header, ...rows].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rooms.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ── Component ── */

export function RoomManagementPage() {
  const addToast = useToastStore((s) => s.addToast);
  const userRole = useAuthStore((s) => s.user?.role);
  const isAdmin = userRole === 'ADMIN';

  const [rooms, setRooms] = useState<RoomEnriched[]>([]);
  const [allFacilities, setAllFacilities] = useState<Facility[]>([]);
  const [activeSemesterId, setActiveSemesterId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Search & filters
  const [search, setSearch] = useState('');
  const [filterFacilities, setFilterFacilities] = useState<string[]>([]);
  const [capacityMin, setCapacityMin] = useState('');
  const [capacityMax, setCapacityMax] = useState('');

  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<RoomEnriched | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [deleteTarget, setDeleteTarget] = useState<RoomEnriched | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Bulk selection
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);

  /* ── Fetch ── */

  const fetchData = useCallback(
    async (p: number, ps: number) => {
      setLoading(true);
      try {
        const [roomRes, facRes, offeringRes, semRes] = await Promise.all([
          get<ListResponse<Room>>('/rooms', {
            page: p,
            pageSize: ps,
            sort: 'name',
          }),
          get<ListResponse<Facility>>('/facilities', { page: 1, pageSize: 500 }),
          get<ListResponse<OfferingWire>>('/course-offerings', { page: 1, pageSize: 5000 }),
          get<ListResponse<Semester>>('/semesters', { isActive: true, page: 1, pageSize: 1 }),
        ]);

        setAllFacilities(facRes.data);
        setActiveSemesterId(semRes.data[0]?.id ?? null);

        const enriched: RoomEnriched[] = roomRes.data.map((room) => ({
          ...room,
          offeringCount: offeringRes.data.filter((o) => o.roomId === room.id).length,
        }));

        setRooms(enriched);
        setTotal(roomRes.meta.total);
      } catch {
        addToast({ type: 'error', title: 'Failed to load rooms' });
      } finally {
        setLoading(false);
      }
    },
    [addToast],
  );

  useEffect(() => {
    fetchData(page, pageSize);
  }, [page, pageSize, fetchData]);

  /* ── Client-side filtering ── */

  const filteredRooms = useMemo(() => {
    let result = rooms;

    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter((r) => r.name.toLowerCase().includes(q));
    }

    if (filterFacilities.length > 0) {
      result = result.filter((r) =>
        filterFacilities.every((f) => r.facilities.includes(f)),
      );
    }

    const min = capacityMin ? Number(capacityMin) : null;
    const max = capacityMax ? Number(capacityMax) : null;
    if (min !== null && !isNaN(min)) {
      result = result.filter((r) => r.capacity >= min);
    }
    if (max !== null && !isNaN(max)) {
      result = result.filter((r) => r.capacity <= max);
    }

    return result;
  }, [rooms, search, filterFacilities, capacityMin, capacityMax]);

  /* ── Create / Edit ── */

  function openCreate() {
    setEditTarget(null);
    setForm(EMPTY_FORM);
    setFormErrors({});
    setModalOpen(true);
  }

  function openEdit(room: RoomEnriched) {
    setEditTarget(room);
    setForm({
      name: room.name,
      capacity: room.capacity,
      facilities: [...room.facilities],
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
      addToast({ type: 'error', title: 'No active semester', message: 'Activate a semester before creating rooms.' });
      return;
    }

    setSaving(true);
    try {
      if (editTarget) {
        await patch(`/rooms/${editTarget.id}`, {
          name: form.name,
          capacity: form.capacity,
          facilities: form.facilities,
        });
        addToast({ type: 'success', title: 'Room updated' });
      } else {
        await post('/rooms', {
          semesterId: activeSemesterId,
          name: form.name,
          capacity: form.capacity,
          facilities: form.facilities,
        });
        addToast({ type: 'success', title: 'Room created' });
      }
      setModalOpen(false);
      fetchData(page, pageSize);
    } catch (err) {
      const e = err as ApiRequestError;
      if (e.code === 'ROOM_NAME_TAKEN') {
        setFormErrors((prev) => ({ ...prev, name: 'A room with this name already exists' }));
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

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await del(`/rooms/${deleteTarget.id}`);
      addToast({ type: 'success', title: 'Room deleted' });
      setDeleteTarget(null);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(deleteTarget.id);
        return next;
      });
      fetchData(page, pageSize);
    } catch (err) {
      const e = err as ApiRequestError;
      if (e.code === 'ROOM_REFERENCED') {
        addToast({
          type: 'error',
          title: 'Cannot delete',
          message: 'This room is referenced by course offerings or locked rooms. Remove all references first.',
        });
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
        await del(`/rooms/${id}`);
        successCount++;
      } catch {
        failCount++;
      }
    }

    if (successCount > 0) {
      addToast({ type: 'success', title: `${successCount} room${successCount > 1 ? 's' : ''} deleted` });
    }
    if (failCount > 0) {
      addToast({
        type: 'error',
        title: `${failCount} room${failCount > 1 ? 's' : ''} could not be deleted`,
        message: 'Some rooms may be referenced by offerings or locked rooms.',
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
    setSelected(new Set(filteredRooms.map((r) => r.id)));
  }

  function clearSelection() {
    setSelected(new Set());
  }

  /* ── Filter count ── */

  const activeFilterCount =
    (filterFacilities.length > 0 ? 1 : 0) +
    (capacityMin || capacityMax ? 1 : 0);

  function clearFilters() {
    setFilterFacilities([]);
    setCapacityMin('');
    setCapacityMax('');
  }

  /* ── Facility options for multi-select ── */

  const facilityOptions = allFacilities.map((f) => ({
    value: f.code,
    label: `${f.code} — ${f.label}`,
  }));

  /* ── Columns ── */

  const columns: Column<RoomEnriched>[] = [
    ...(isAdmin
      ? [
          {
            key: '__select',
            header: '',
            width: '44px',
            render: (row: RoomEnriched) => (
              <input
                type="checkbox"
                checked={selected.has(row.id)}
                onChange={() => toggleSelect(row.id)}
                onClick={(e) => e.stopPropagation()}
                aria-label={`Select ${row.name}`}
                style={{ accentColor: 'var(--color-primary-500)' }}
              />
            ),
          } satisfies Column<RoomEnriched>,
        ]
      : []),
    {
      key: 'name',
      header: 'Name',
      width: '200px',
      render: (row) => <span>{row.name}</span>,
    },
    {
      key: 'capacity',
      header: 'Capacity',
      width: '100px',
      render: (row) => <span className={styles.capacityCell}>{row.capacity}</span>,
    },
    {
      key: 'facilities',
      header: 'Facilities',
      render: (row) =>
        row.facilities.length > 0 ? (
          <div className={styles.tagList}>
            {row.facilities.map((f) => (
              <span key={f} className={styles.tag}>
                {f}
              </span>
            ))}
          </div>
        ) : (
          <span className={styles.tagEmpty}>None</span>
        ),
    },
    {
      key: 'offeringCount',
      header: 'Offerings',
      width: '100px',
      render: (row) => <span className={styles.offeringCount}>{row.offeringCount}</span>,
    },
  ];

  /* ── Filter content for toolbar ── */

  const filterContent = (
    <div className={styles.filterPanel}>
      <div>
        <p className={styles.filterLabel}>Facility</p>
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

      <div className={styles.filterDivider} />

      <div>
        <p className={styles.filterLabel}>Capacity Range</p>
        <div className={styles.capacityRange}>
          <input
            type="number"
            className={styles.capacityRangeInput}
            placeholder="Min"
            value={capacityMin}
            onChange={(e) => setCapacityMin(e.target.value)}
            min={0}
          />
          <span className={styles.capacityRangeSep}>–</span>
          <input
            type="number"
            className={styles.capacityRangeInput}
            placeholder="Max"
            value={capacityMax}
            onChange={(e) => setCapacityMax(e.target.value)}
            min={0}
          />
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
        title="Rooms"
        description="Manage rooms for the active semester."
        actions={
          isAdmin ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              + Add Room
            </Button>
          ) : undefined
        }
      />

      <TableToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name…"
        activeFilterCount={activeFilterCount}
        filterContent={filterContent}
        selectedCount={isAdmin ? selected.size : undefined}
        totalSelectableCount={isAdmin ? filteredRooms.length : undefined}
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
                onClick={() => exportCsv(filteredRooms.filter((r) => selected.has(r.id)))}
              >
                Export CSV
              </Button>
            </>
          ) : undefined
        }
        actions={
          !selected.size && isAdmin ? (
            <Button
              variant="ghost"
              size="sm"
              icon={<Download size={14} />}
              onClick={() => exportCsv(filteredRooms)}
            >
              Export CSV
            </Button>
          ) : undefined
        }
      />

      <DataTable
        columns={columns}
        data={filteredRooms}
        keyExtractor={(row) => row.id}
        page={page}
        pageSize={pageSize}
        total={filteredRooms.length}
        onPageChange={setPage}
        onPageSizeChange={(s) => {
          setPageSize(s);
          setPage(1);
        }}
        loading={loading}
        emptyIcon={<DoorOpen size={48} />}
        emptyTitle="No rooms found"
        emptyDescription={
          search || activeFilterCount > 0
            ? 'Try adjusting your search or filters.'
            : 'Create your first room to begin scheduling.'
        }
        emptyAction={
          isAdmin && !search && activeFilterCount === 0 ? (
            <Button icon={<Plus size={16} />} onClick={openCreate}>
              + Add Room
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
                    aria-label="Edit room"
                  />
                  <Button
                    variant="icon"
                    size="sm"
                    icon={<Trash2 size={16} />}
                    onClick={() => setDeleteTarget(row)}
                    aria-label="Delete room"
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
        title={editTarget ? 'Edit Room' : 'New Room'}
        size="md"
        footer={
          <FormActions>
            <Button variant="secondary" onClick={() => setModalOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving…' : editTarget ? 'Save Changes' : 'Create Room'}
            </Button>
          </FormActions>
        }
      >
        <FormSection>
          <TextInput
            label="Name"
            placeholder="Lab 301"
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            error={formErrors.name}
            required
          />
          <NumberInput
            label="Capacity"
            value={form.capacity}
            onChange={(v) => updateField('capacity', v)}
            error={formErrors.capacity}
            min={1}
            required
          />
          <MultiSelect
            label="Facilities"
            placeholder="Select facilities…"
            options={facilityOptions}
            value={form.facilities}
            onChange={(v) => updateField('facilities', v)}
            helperText="Select the facilities available in this room."
          />
        </FormSection>
      </Modal>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        variant="danger"
        title="Delete Room?"
        description={
          deleteTarget
            ? deleteTarget.offeringCount > 0
              ? `"${deleteTarget.name}" is assigned to ${deleteTarget.offeringCount} offering${deleteTarget.offeringCount > 1 ? 's' : ''}. Deletion will fail if references still exist.`
              : `Are you sure you want to delete "${deleteTarget.name}"? This action cannot be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        loading={deleting}
      />

      {/* Bulk Delete Confirmation */}
      <ConfirmDialog
        open={bulkDeleteOpen}
        onClose={() => setBulkDeleteOpen(false)}
        onConfirm={handleBulkDelete}
        variant="danger"
        title="Delete Selected Rooms?"
        description={`Are you sure you want to delete ${selected.size} room${selected.size > 1 ? 's' : ''}? Rooms referenced by offerings or locked rooms cannot be deleted.`}
        confirmLabel={`Delete ${selected.size}`}
        cancelLabel="Cancel"
        loading={bulkDeleting}
      />
    </>
  );
}
