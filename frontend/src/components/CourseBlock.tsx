import { Lock, Pencil, AlertTriangle } from 'lucide-react';
import type { GridDensity } from './TimetableGrid';
import styles from './CourseBlock.module.css';

/* ── Category color helpers ── */

const CATEGORY_LETTERS = ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const;
type CategoryLetter = (typeof CATEGORY_LETTERS)[number] | 'fixed';

const COMPETENCY_CATEGORY: Record<string, CategoryLetter> = {
  algorithms: 'a',
  databases: 'b',
  networks: 'c',
  'software-engineering': 'd',
  'ai-ml': 'e',
  'visual-design': 'f',
  os: 'g',
  security: 'a',
  cloud: 'b',
  math: 'c',
};

export function getCategoryForCompetencies(competencies: string[]): CategoryLetter {
  if (competencies.length === 0) return 'a';
  return (
    COMPETENCY_CATEGORY[competencies[0]] ??
    CATEGORY_LETTERS[competencies[0].length % CATEGORY_LETTERS.length]
  );
}

/* ── CourseBlock component (§13.5) ── */

export interface CourseBlockProps {
  courseCode: string;
  courseName: string;
  lecturers: string;
  lecturerPillLabel?: string;
  lecturerPillTitle?: string;
  legacyLecturers?: boolean;
  roomName: string;
  roomCapacity?: number;
  sessionLabel?: string;
  timeRange: string;
  category: string;
  slotCount: number;
  gridColumn: number;
  gridRowStart: number;
  fixed?: boolean;
  override?: boolean;
  conflict?: boolean;
  selected?: boolean;
  filteredOut?: boolean;
  density?: GridDensity;
  onClick?: () => void;
}

export function CourseBlock({
  courseCode,
  courseName,
  lecturers,
  lecturerPillLabel,
  lecturerPillTitle,
  legacyLecturers,
  roomName,
  roomCapacity,
  sessionLabel,
  timeRange,
  category,
  slotCount,
  gridColumn,
  gridRowStart,
  fixed,
  override,
  conflict,
  selected,
  filteredOut,
  density = 'comfortable',
  onClick,
}: CourseBlockProps) {
  const isSingleSlot = slotCount === 1;
  const isClickable = !!onClick;
  const lecturerPillText = lecturerPillLabel ?? lecturers;
  const lecturerPillTooltip = lecturerPillTitle ?? lecturers;

  const className = [
    styles.block,
    isSingleSlot && styles.singleSlot,
    density === 'compact' && styles.densityCompact,
    fixed && styles.fixed,
    override && styles.override,
    conflict && styles.conflict,
    selected && styles.selected,
    filteredOut && styles.filteredOut,
    isClickable && styles.clickable,
  ]
    .filter(Boolean)
    .join(' ');

  const colorVars = {
    '--block-bg': `var(--block-${category}-bg)`,
    '--block-text': `var(--block-${category}-text)`,
    '--block-border': `var(--block-${category}-border)`,
  } as React.CSSProperties;

  return (
    <div
      className={className}
      style={{
        gridColumn,
        gridRow: `${gridRowStart} / span ${slotCount}`,
        ...colorVars,
      }}
      onClick={onClick}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.();
              }
            }
          : undefined
      }
    >
      {conflict && (
        <AlertTriangle size={10} className={`${styles.stateIcon} ${styles.stateIconConflict}`} aria-label="Conflict" />
      )}
      {fixed && !conflict && (
        <Lock size={10} className={styles.stateIcon} aria-hidden="true" />
      )}
      {override && !conflict && !fixed && (
        <Pencil size={10} className={styles.stateIcon} aria-hidden="true" />
      )}

      {isSingleSlot ? (
        <>
          <span className={styles.codeInline}>
            {courseCode}
            <span className={styles.roomInline}>{roomName}</span>
          </span>
          <span className={styles.lecturerPillRow} aria-label={`Lecturer: ${lecturerPillTooltip}`}>
            <span
              className={`${styles.lecturerPill} ${legacyLecturers ? styles.lecturerPillLegacy : ''}`}
              title={lecturerPillTooltip}
            >
              {lecturerPillText}
            </span>
          </span>
        </>
      ) : (
        <>
          <span className={styles.code}>{courseCode}</span>
          <span className={styles.name}>{courseName}</span>
          <span className={styles.meta}>{roomName}</span>
          <span className={styles.lecturerPillRow} aria-label={`Lecturer: ${lecturerPillTooltip}`}>
            <span
              className={`${styles.lecturerPill} ${legacyLecturers ? styles.lecturerPillLegacy : ''}`}
              title={lecturerPillTooltip}
            >
              {lecturerPillText}
            </span>
          </span>
          {sessionLabel && <span className={styles.session}>{sessionLabel}</span>}
        </>
      )}

      <div className={styles.tooltip} role="tooltip">
        <p className={styles.tooltipCode}>{courseCode}</p>
        <p className={styles.tooltipName}>{courseName}</p>
        <p className={styles.tooltipRow}>
          <span className={styles.tooltipLabel}>Lecturer: </span>
          {lecturers}
        </p>
        <p className={styles.tooltipRow}>
          <span className={styles.tooltipLabel}>Room: </span>
          {roomName}
          {roomCapacity != null ? ` (cap. ${roomCapacity})` : ''}
        </p>
        <p className={styles.tooltipRow}>
          <span className={styles.tooltipLabel}>Time: </span>
          {timeRange}
        </p>
        {sessionLabel && (
          <p className={styles.tooltipRow}>
            <span className={styles.tooltipLabel}>Session: </span>
            {sessionLabel}
          </p>
        )}
        {fixed && <span className={styles.tooltipTag}>Fixed</span>}
        {override && <span className={`${styles.tooltipTag} ${styles.tooltipTagOverride}`}>Overridden</span>}
      </div>
    </div>
  );
}
