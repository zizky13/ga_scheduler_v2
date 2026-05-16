import { type ReactNode, useState, useRef, useEffect, useCallback } from 'react';
import { Search, Filter, List, Rows3, X } from 'lucide-react';
import { Button } from './Button';
import styles from './TableToolbar.module.css';

/* ── Types ── */

export interface FilterPill {
  key: string;
  label: string;
  onRemove: () => void;
}

export interface TableToolbarProps {
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;

  activeFilterCount?: number;
  filterContent?: ReactNode;
  onApplyFilters?: () => void;
  onResetFilters?: () => void;
  filterPills?: FilterPill[];

  rangeStart?: number;
  rangeEnd?: number;
  total?: number;

  viewMode?: 'list' | 'compact';
  onViewModeChange?: (mode: 'list' | 'compact') => void;

  actions?: ReactNode;

  selectedCount?: number;
  totalSelectableCount?: number;
  onSelectAll?: () => void;
  onClearSelection?: () => void;
  selectionActions?: ReactNode;
}

/* ── Component ── */

export function TableToolbar({
  searchValue,
  onSearchChange,
  searchPlaceholder = 'Search...',
  activeFilterCount = 0,
  filterContent,
  onApplyFilters,
  onResetFilters,
  filterPills,
  rangeStart,
  rangeEnd,
  total,
  viewMode,
  onViewModeChange,
  actions,
  selectedCount,
  totalSelectableCount,
  onSelectAll,
  onClearSelection,
  selectionActions,
}: TableToolbarProps) {
  const hasSelection = selectedCount != null && selectedCount > 0;

  if (hasSelection) {
    return (
      <div className={styles.toolbar}>
        <div className={styles.selectionBar}>
          <div className={styles.selectionLeft}>
            <span className={styles.selectionCount}>
              {selectedCount} selected
            </span>
            {totalSelectableCount != null && selectedCount! < totalSelectableCount && onSelectAll && (
              <button
                type="button"
                className={styles.selectAllLink}
                onClick={onSelectAll}
              >
                Select all {totalSelectableCount}
              </button>
            )}
            {onClearSelection && (
              <button
                type="button"
                className={styles.selectAllLink}
                onClick={onClearSelection}
              >
                Clear
              </button>
            )}
          </div>
          {selectionActions && (
            <div className={styles.selectionRight}>
              {selectionActions}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.toolbar}>
      <div className={styles.left}>
        {onSearchChange != null && (
          <div className={styles.searchBox}>
            <Search className={styles.searchIcon} size={16} aria-hidden="true" />
            <input
              type="text"
              className={styles.searchInput}
              value={searchValue ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
            />
            {searchValue && (
              <button
                type="button"
                className={styles.searchClear}
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
              >
                <X size={14} />
              </button>
            )}
          </div>
        )}

        {filterContent != null && (
          <FilterDropdown
            activeCount={activeFilterCount}
            content={filterContent}
            onApply={onApplyFilters}
            onReset={onResetFilters}
          />
        )}

        {actions}
      </div>

      <div className={styles.right}>
        {total != null && rangeStart != null && rangeEnd != null && (
          <span className={styles.paginationInfo}>
            Showing {rangeStart}–{rangeEnd} of {total}
          </span>
        )}

        {onViewModeChange && (
          <div className={styles.viewToggle}>
            <button
              type="button"
              className={`${styles.viewButton} ${viewMode === 'list' ? styles.viewButtonActive : ''}`}
              onClick={() => onViewModeChange('list')}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
            >
              <List size={16} />
            </button>
            <button
              type="button"
              className={`${styles.viewButton} ${viewMode === 'compact' ? styles.viewButtonActive : ''}`}
              onClick={() => onViewModeChange('compact')}
              aria-label="Compact view"
              aria-pressed={viewMode === 'compact'}
            >
              <Rows3 size={16} />
            </button>
          </div>
        )}
      </div>

      {filterPills && filterPills.length > 0 && (
        <div className={styles.pillsRow}>
          {filterPills.map((pill) => (
            <span key={pill.key} className={styles.pill}>
              <span className={styles.pillLabel}>{pill.label}</span>
              <button
                type="button"
                className={styles.pillRemove}
                onClick={pill.onRemove}
                aria-label={`Remove filter: ${pill.label}`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Filter Dropdown ── */

function FilterDropdown({
  activeCount,
  content,
  onApply,
  onReset,
}: {
  activeCount: number;
  content: ReactNode;
  onApply?: () => void;
  onReset?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        close();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open, close]);

  return (
    <div className={styles.filterWrapper} ref={ref}>
      <button
        type="button"
        className={styles.filterButton}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Filter options"
      >
        <Filter size={16} />
        <span>Filter</span>
        {activeCount > 0 && (
          <span className={styles.filterBadge}>{activeCount}</span>
        )}
      </button>

      {open && (
        <div className={styles.filterDropdown}>
          {content}
          {(onApply || onReset) && (
            <div className={styles.filterFooter}>
              {onReset && (
                <Button variant="ghost" size="sm" onClick={() => { onReset(); }}>
                  Reset
                </Button>
              )}
              {onApply && (
                <Button size="sm" onClick={() => { onApply(); close(); }}>
                  Apply
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
