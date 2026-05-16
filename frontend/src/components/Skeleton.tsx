import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

interface SkeletonBaseProps {
  className?: string;
  style?: CSSProperties;
}

export function SkeletonText({
  height = 14,
  width,
  className,
  style,
}: SkeletonBaseProps & { height?: 12 | 14 | 16; width?: string }) {
  return (
    <div
      className={`${styles.skeleton} ${styles.text} ${className ?? ''}`}
      style={{ height, width: width ?? `${60 + Math.random() * 30}%`, ...style }}
    />
  );
}

export function SkeletonStatValue({ className, style }: SkeletonBaseProps) {
  return (
    <div
      className={`${styles.skeleton} ${styles.statValue} ${className ?? ''}`}
      style={style}
    />
  );
}

export function SkeletonTableCell({
  width,
  className,
  style,
}: SkeletonBaseProps & { width?: string }) {
  return (
    <div
      className={`${styles.skeleton} ${styles.tableCell} ${className ?? ''}`}
      style={{ width: width ?? `${60 + Math.random() * 20}%`, ...style }}
    />
  );
}

export function SkeletonAvatar({
  size = 32,
  className,
  style,
}: SkeletonBaseProps & { size?: 32 | 40 }) {
  return (
    <div
      className={`${styles.skeleton} ${styles.avatar} ${className ?? ''}`}
      style={{ width: size, height: size, ...style }}
    />
  );
}

export function SkeletonBadge({ className, style }: SkeletonBaseProps) {
  return (
    <div
      className={`${styles.skeleton} ${styles.badge} ${className ?? ''}`}
      style={style}
    />
  );
}

export function SkeletonBlock({
  width,
  height,
  borderRadius,
  className,
  style,
}: SkeletonBaseProps & { width?: string | number; height?: string | number; borderRadius?: string }) {
  return (
    <div
      className={`${styles.skeleton} ${className ?? ''}`}
      style={{ width, height, borderRadius: borderRadius ?? 'var(--radius-sm)', ...style }}
    />
  );
}

export function SkeletonTableRows({
  rows = 5,
  columns = 4,
}: {
  rows?: number;
  columns?: number;
}) {
  return (
    <div className={styles.tableRows}>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className={styles.tableRow}>
          {Array.from({ length: columns }).map((_, c) => (
            <SkeletonTableCell key={c} />
          ))}
        </div>
      ))}
    </div>
  );
}
