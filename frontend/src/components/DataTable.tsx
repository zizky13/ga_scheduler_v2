import { type ReactNode } from 'react';
import { ArrowUpDown, ArrowUp, ArrowDown, ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './DataTable.module.css';

/* ── Types ── */

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  sortable?: boolean;
  render: (row: T, index: number) => ReactNode;
}

export type SortDirection = 'asc' | 'desc';

export interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (row: T) => string | number;

  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
  pageSizeOptions?: number[];

  sortKey?: string;
  sortDirection?: SortDirection;
  onSort?: (key: string) => void;

  loading?: boolean;
  emptyIcon?: ReactNode;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: ReactNode;

  onRowClick?: (row: T) => void;
  rowActions?: (row: T) => ReactNode;
  minWidth?: string;
}

const DEFAULT_PAGE_SIZES = [10, 25, 50];

/* ── DataTable ── */

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  sortKey,
  sortDirection,
  onSort,
  loading,
  emptyIcon,
  emptyTitle = 'No data found',
  emptyDescription,
  emptyAction,
  onRowClick,
  rowActions,
  minWidth,
}: DataTableProps<T>) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  const allColumns = rowActions
    ? [...columns, { key: '__actions', header: '', width: '80px', sortable: false, render: (_row: T) => null as ReactNode }]
    : columns;

  return (
    <div className={styles.container}>
      {loading ? (
        <LoadingSkeleton columns={allColumns.length} />
      ) : data.length === 0 ? (
        <div className={styles.emptyState}>
          {emptyIcon && <div className={styles.emptyIcon}>{emptyIcon}</div>}
          <h2 className={styles.emptyTitle}>{emptyTitle}</h2>
          {emptyDescription && <p className={styles.emptyDescription}>{emptyDescription}</p>}
          {emptyAction}
        </div>
      ) : (
        <div className={styles.scrollWrapper}>
          <table className={styles.table} style={minWidth ? { minWidth } : undefined} role="table">
            <thead className={styles.thead}>
              <tr className={styles.theadRow}>
                {columns.map((col) => (
                  <th
                    key={col.key}
                    className={`${styles.th} ${col.sortable && onSort ? styles.thSortable : ''}`}
                    style={col.width ? { width: col.width } : undefined}
                    onClick={col.sortable && onSort ? () => onSort(col.key) : undefined}
                    aria-sort={
                      sortKey === col.key
                        ? sortDirection === 'asc' ? 'ascending' : 'descending'
                        : undefined
                    }
                  >
                    <span className={styles.thContent}>
                      {col.header}
                      {col.sortable && onSort && (
                        <SortIndicator
                          active={sortKey === col.key}
                          direction={sortKey === col.key ? sortDirection : undefined}
                        />
                      )}
                    </span>
                  </th>
                ))}
                {rowActions && (
                  <th className={styles.th} style={{ width: '80px' }} />
                )}
              </tr>
            </thead>
            <tbody>
              {data.map((row, idx) => (
                <tr
                  key={keyExtractor(row)}
                  className={`${styles.tr} ${onRowClick ? styles.trClickable : ''}`}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={styles.td}>
                      {col.render(row, idx)}
                    </td>
                  ))}
                  {rowActions && (
                    <td className={styles.td}>
                      <div className={styles.actionsCell}>
                        {rowActions(row)}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && data.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          totalPages={totalPages}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          pageSizeOptions={pageSizeOptions}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
        />
      )}
    </div>
  );
}

/* ── Sort indicator ── */

function SortIndicator({ active, direction }: { active: boolean; direction?: SortDirection }) {
  if (!active) {
    return <ArrowUpDown className={styles.sortIcon} />;
  }
  const Icon = direction === 'asc' ? ArrowUp : ArrowDown;
  return <Icon className={`${styles.sortIcon} ${styles.sortIconActive}`} />;
}

/* ── Pagination ── */

function buildPageNumbers(current: number, total: number): (number | 'ellipsis')[] {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages: (number | 'ellipsis')[] = [1];

  if (current > 3) pages.push('ellipsis');

  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  for (let i = start; i <= end; i++) pages.push(i);

  if (current < total - 2) pages.push('ellipsis');

  pages.push(total);
  return pages;
}

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: number) => void;
}

function Pagination({
  page,
  pageSize,
  total,
  totalPages,
  rangeStart,
  rangeEnd,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: PaginationProps) {
  return (
    <div className={styles.pagination}>
      <div className={styles.paginationLeft}>
        <span className={styles.paginationLabel}>Rows per page</span>
        <select
          className={styles.pageSizeSelect}
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          aria-label="Rows per page"
        >
          {pageSizeOptions.map((size) => (
            <option key={size} value={size}>{size}</option>
          ))}
        </select>
      </div>

      <div className={styles.paginationCenter}>
        <button
          type="button"
          className={styles.pageNavButton}
          disabled={page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className={styles.pageNavIcon} />
        </button>

        {buildPageNumbers(page, totalPages).map((p, i) =>
          p === 'ellipsis' ? (
            <span key={`e-${i}`} className={styles.pageEllipsis}>...</span>
          ) : (
            <button
              key={p}
              type="button"
              className={`${styles.pageButton} ${p === page ? styles.pageButtonActive : ''}`}
              onClick={() => onPageChange(p)}
              aria-current={p === page ? 'page' : undefined}
              aria-label={`Page ${p}`}
            >
              {p}
            </button>
          ),
        )}

        <button
          type="button"
          className={styles.pageNavButton}
          disabled={page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className={styles.pageNavIcon} />
        </button>
      </div>

      <span className={styles.paginationRight}>
        Showing {rangeStart}–{rangeEnd} of {total}
      </span>
    </div>
  );
}

/* ── Loading skeleton ── */

const SKELETON_WIDTHS = [
  [0.7, 0.8, 0.6, 0.65, 0.5],
  [0.6, 0.7, 0.75, 0.6, 0.65],
  [0.75, 0.65, 0.7, 0.8, 0.6],
  [0.65, 0.75, 0.6, 0.7, 0.75],
  [0.7, 0.6, 0.8, 0.65, 0.7],
];

function LoadingSkeleton({ columns }: { columns: number }) {
  return (
    <>
      {SKELETON_WIDTHS.map((row, i) => (
        <div key={i} className={styles.skeletonRow}>
          {Array.from({ length: columns }, (_, j) => (
            <div
              key={j}
              className={styles.skeletonCell}
              style={{
                width: `${(row[j % row.length]) * 100}%`,
                flex: 1,
                animationDelay: `${i * 100}ms`,
              }}
            />
          ))}
        </div>
      ))}
    </>
  );
}
