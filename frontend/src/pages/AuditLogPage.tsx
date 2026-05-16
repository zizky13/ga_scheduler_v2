import { useState, useEffect, useCallback, useMemo } from 'react';
import { ScrollText, ChevronDown, ChevronRight } from 'lucide-react';
import { PageHeader } from '../components/ContentArea';
import { DataTable, type Column } from '../components/DataTable';
import { TableToolbar } from '../components/TableToolbar';
import { useToastStore } from '../store/toastStore';
import { get } from '../lib/api';
import styles from './AuditLogPage.module.css';

/* ── Types ── */

interface AuditLogWire {
  id: number;
  actorId: number | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

interface UserWire {
  id: number;
  fullName: string;
}

interface ListResponse<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number };
}

/* ── Helpers ── */

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function humanizeAction(action: string): string {
  return action
    .replace(/[._]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

type ActionCategory = 'create' | 'update' | 'delete' | 'login' | 'default';

function categorizeAction(action: string): ActionCategory {
  const lower = action.toLowerCase();
  if (lower.includes('create') || lower.includes('register')) return 'create';
  if (lower.includes('update') || lower.includes('patch') || lower.includes('edit')) return 'update';
  if (lower.includes('delete') || lower.includes('remove') || lower.includes('deactivate')) return 'delete';
  if (lower.includes('login') || lower.includes('auth') || lower.includes('logout')) return 'login';
  return 'default';
}

const ACTION_STYLE: Record<ActionCategory, string> = {
  create: styles.actionCreate,
  update: styles.actionUpdate,
  delete: styles.actionDelete,
  login: styles.actionLogin,
  default: styles.actionDefault,
};

function truncateId(id: string, max = 12): string {
  return id.length > max ? id.slice(0, max) + '…' : id;
}

function prettyJson(value: unknown): string {
  if (value === null || value === undefined) return '—';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const ENTITY_TYPE_OPTIONS = [
  'User', 'Room', 'Semester', 'Course', 'CourseOffering',
  'Lecturer', 'Facility', 'Timeslot', 'LockedRoom', 'ScheduleRun',
];

const ACTION_TYPE_OPTIONS = [
  'create', 'update', 'delete', 'login', 'logout', 'register',
];

/* ══════════════════════════════════════════
   Main Component
   ══════════════════════════════════════════ */

export function AuditLogPage() {
  const addToast = useToastStore((s) => s.addToast);

  const [logs, setLogs] = useState<AuditLogWire[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  const [userMap, setUserMap] = useState<Map<number, string>>(new Map());

  // Search & filters
  const [search, setSearch] = useState('');
  const [filterEntityType, setFilterEntityType] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useState<string | null>(null);

  // Expanded rows
  const [expandedKeys, setExpandedKeys] = useState<Set<number>>(new Set());

  /* ── Fetch users for actor name lookup ── */

  useEffect(() => {
    (async () => {
      try {
        const res = await get<ListResponse<UserWire>>('/users', { page: 1, pageSize: 5000 });
        const map = new Map<number, string>();
        for (const u of res.data) map.set(u.id, u.fullName);
        setUserMap(map);
      } catch {
        // Non-critical — we'll show "User #N" as fallback
      }
    })();
  }, []);

  /* ── Fetch logs ── */

  const fetchData = useCallback(
    async (p: number, ps: number) => {
      setLoading(true);
      try {
        const params: Record<string, unknown> = {
          page: p,
          pageSize: ps,
          sort: '-createdAt',
        };
        if (filterEntityType) params.entityType = filterEntityType;
        if (filterAction) params.action = filterAction;
        const res = await get<ListResponse<AuditLogWire>>('/audit-logs', params);
        setLogs(res.data);
        setTotal(res.meta.total);
      } catch {
        addToast({ type: 'error', title: 'Failed to load audit logs' });
      } finally {
        setLoading(false);
      }
    },
    [addToast, filterEntityType, filterAction],
  );

  useEffect(() => {
    fetchData(page, pageSize);
  }, [page, pageSize, fetchData]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setPage(1);
  }, [filterEntityType, filterAction]);

  /* ── Client-side search ── */

  const filteredLogs = useMemo(() => {
    if (!search.trim()) return logs;
    const q = search.toLowerCase();
    return logs.filter(
      (l) =>
        l.action.toLowerCase().includes(q) ||
        l.entityType.toLowerCase().includes(q) ||
        l.entityId.toLowerCase().includes(q),
    );
  }, [logs, search]);

  /* ── Expand/collapse ── */

  function toggleExpand(row: AuditLogWire) {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }

  /* ── Filter count ── */

  const activeFilterCount =
    (filterEntityType !== null ? 1 : 0) +
    (filterAction !== null ? 1 : 0);

  function clearFilters() {
    setFilterEntityType(null);
    setFilterAction(null);
  }

  /* ── Columns ── */

  const columns: Column<AuditLogWire>[] = [
    {
      key: 'expand',
      header: '',
      width: '40px',
      render: (row) => (
        expandedKeys.has(row.id)
          ? <ChevronDown size={16} style={{ color: 'var(--color-secondary-400)' }} />
          : <ChevronRight size={16} style={{ color: 'var(--color-secondary-400)' }} />
      ),
    },
    {
      key: 'createdAt',
      header: 'Timestamp',
      width: '180px',
      render: (row) => (
        <span className={styles.timestampCell}>{formatTimestamp(row.createdAt)}</span>
      ),
    },
    {
      key: 'actor',
      header: 'Actor',
      width: '160px',
      render: (row) => {
        if (row.actorId === null) {
          return <span className={styles.actorSystem}>System</span>;
        }
        const name = userMap.get(row.actorId);
        return <span>{name ?? `User #${row.actorId}`}</span>;
      },
    },
    {
      key: 'action',
      header: 'Action',
      width: '200px',
      render: (row) => {
        const cat = categorizeAction(row.action);
        return (
          <span className={`${styles.actionBadge} ${ACTION_STYLE[cat]}`}>
            {humanizeAction(row.action)}
          </span>
        );
      },
    },
    {
      key: 'entity',
      header: 'Entity',
      width: '180px',
      render: (row) => (
        <span className={styles.entityCell}>
          <span className={styles.entityType}>{row.entityType}</span>
          <span className={styles.entityId}>#{truncateId(row.entityId)}</span>
        </span>
      ),
    },
    {
      key: 'details',
      header: 'Details',
      render: (row) => {
        if (!row.metadata) return <span className={styles.detailsHint}>—</span>;
        return (
          <span className={styles.detailsHint}>
            {expandedKeys.has(row.id) ? 'Hide details' : 'View details'}
          </span>
        );
      },
    },
    {
      key: 'ipAddress',
      header: 'IP Address',
      width: '140px',
      render: (row) => (
        <span className={styles.ipCell}>{row.ipAddress ?? '—'}</span>
      ),
    },
  ];

  /* ── Filter content ── */

  const filterContent = (
    <div className={styles.filterPanel}>
      <div>
        <p className={styles.filterLabel}>Entity Type</p>
        <div className={styles.filterCheckboxGroup}>
          <label className={styles.filterCheckbox}>
            <input
              type="radio"
              name="filterEntity"
              checked={filterEntityType === null}
              onChange={() => setFilterEntityType(null)}
            />
            All
          </label>
          {ENTITY_TYPE_OPTIONS.map((t) => (
            <label key={t} className={styles.filterCheckbox}>
              <input
                type="radio"
                name="filterEntity"
                checked={filterEntityType === t}
                onChange={() => setFilterEntityType(t)}
              />
              {t}
            </label>
          ))}
        </div>
      </div>

      <div className={styles.filterDivider} />

      <div>
        <p className={styles.filterLabel}>Action Type</p>
        <div className={styles.filterCheckboxGroup}>
          <label className={styles.filterCheckbox}>
            <input
              type="radio"
              name="filterAction"
              checked={filterAction === null}
              onChange={() => setFilterAction(null)}
            />
            All
          </label>
          {ACTION_TYPE_OPTIONS.map((a) => (
            <label key={a} className={styles.filterCheckbox}>
              <input
                type="radio"
                name="filterAction"
                checked={filterAction === a}
                onChange={() => setFilterAction(a)}
              />
              {a.charAt(0).toUpperCase() + a.slice(1)}
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
  );

  /* ── Expanded row renderer ── */

  function renderExpandedRow(row: AuditLogWire) {
    return (
      <div className={styles.expandedDetail}>
        <div className={styles.expandedSection}>
          <span className={styles.expandedLabel}>Metadata</span>
          {row.metadata ? (
            <pre className={styles.expandedJson}>{prettyJson(row.metadata)}</pre>
          ) : (
            <span className={styles.expandedEmpty}>No metadata recorded.</span>
          )}
        </div>
        {row.userAgent && (
          <div className={styles.expandedSection}>
            <span className={styles.expandedLabel}>User Agent</span>
            <span className={styles.expandedUserAgent}>{row.userAgent}</span>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Audit Log"
        description="View all system activity and user actions."
      />

      <TableToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by action or entity…"
        activeFilterCount={activeFilterCount}
        filterContent={filterContent}
      />

      <DataTable
        columns={columns}
        data={filteredLogs}
        keyExtractor={(row) => row.id}
        page={page}
        pageSize={pageSize}
        total={total}
        onPageChange={setPage}
        onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
        pageSizeOptions={[25, 50, 100]}
        loading={loading}
        emptyIcon={<ScrollText size={48} />}
        emptyTitle="No audit log entries"
        emptyDescription={
          search || activeFilterCount > 0
            ? 'Try adjusting your search or filters.'
            : 'Activity will appear here as users interact with the system.'
        }
        onRowClick={toggleExpand}
        expandedKeys={expandedKeys as Set<string | number>}
        renderExpandedRow={renderExpandedRow}
        minWidth="1060px"
      />
    </>
  );
}
