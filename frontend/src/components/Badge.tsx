import { X, Check } from 'lucide-react';
import styles from './Badge.module.css';

/* ══════════════════════════════════════════
   StatusBadge — schedule run status
   ══════════════════════════════════════════ */

type RunStatus =
  | 'QUEUED'
  | 'RUNNING'
  | 'COMPLETED'
  | 'STAGNATED'
  | 'SSA_INFEASIBLE'
  | 'PRE_GA_EMPTY'
  | 'CANCELLED'
  | 'FAILED';

const STATUS_CLASS: Record<RunStatus, string> = {
  QUEUED: styles.queued,
  RUNNING: styles.running,
  COMPLETED: styles.completed,
  STAGNATED: styles.stagnated,
  SSA_INFEASIBLE: styles.ssaInfeasible,
  PRE_GA_EMPTY: styles.preGaEmpty,
  CANCELLED: styles.cancelled,
  FAILED: styles.failed,
};

const STATUS_LABEL: Record<RunStatus, string> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
  STAGNATED: 'Stagnated',
  SSA_INFEASIBLE: 'SSA Infeasible',
  PRE_GA_EMPTY: 'Pre-GA Empty',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

interface StatusBadgeProps {
  status: RunStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`${styles.badge} ${STATUS_CLASS[status]}`}>
      {status === 'RUNNING' && (
        <span className={`${styles.dot} ${styles.dotPulse}`} />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}

/* ══════════════════════════════════════════
   RoleBadge — user role
   ══════════════════════════════════════════ */

type UserRole = 'ADMIN' | 'USER';

const ROLE_CLASS: Record<UserRole, string> = {
  ADMIN: styles.admin,
  USER: styles.user,
};

const ROLE_LABEL: Record<UserRole, string> = {
  ADMIN: 'admin',
  USER: 'user',
};

interface RoleBadgeProps {
  role: UserRole;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  return (
    <span className={`${styles.badge} ${ROLE_CLASS[role]}`}>
      {ROLE_LABEL[role] ?? role.toLowerCase()}
    </span>
  );
}

/* ══════════════════════════════════════════
   Tag — competency / facility
   ══════════════════════════════════════════ */

interface TagProps {
  children: string;
  onRemove?: () => void;
}

export function Tag({ children, onRemove }: TagProps) {
  return (
    <span className={styles.tag}>
      {children}
      {onRemove && (
        <button
          type="button"
          className={styles.tagRemoveButton}
          onClick={onRemove}
          aria-label={`Remove ${children}`}
        >
          <X size={10} />
        </button>
      )}
    </span>
  );
}

/* ══════════════════════════════════════════
   TagList — wrapper with 4px gap
   ══════════════════════════════════════════ */

interface TagListProps {
  children: React.ReactNode;
}

export function TagList({ children }: TagListProps) {
  return <div className={styles.tagList}>{children}</div>;
}

/* ══════════════════════════════════════════
   BooleanTag — active/inactive state
   ══════════════════════════════════════════ */

interface BooleanTagProps {
  value: boolean;
  trueLabel?: string;
  falseLabel?: string;
}

export function BooleanTag({
  value,
  trueLabel = 'Active',
  falseLabel = 'Inactive',
}: BooleanTagProps) {
  return (
    <span className={`${styles.booleanTag} ${value ? styles.active : styles.inactive}`}>
      {value ? <Check size={12} /> : <X size={12} />}
      {value ? trueLabel : falseLabel}
    </span>
  );
}
