import type { ReactNode } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import styles from './Card.module.css';

/* ══════════════════════════════════════════
   StatCard
   ══════════════════════════════════════════ */

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  trend?: { value: string; direction: 'up' | 'down' };
  onClick?: () => void;
}

export function StatCard({ icon, label, value, trend, onClick }: StatCardProps) {
  const Tag = onClick ? 'button' : 'div';

  return (
    <Tag
      className={`${styles.statCard} ${onClick ? styles.statCardClickable : ''}`}
      onClick={onClick}
      type={onClick ? 'button' : undefined}
    >
      <div className={styles.statIconContainer}>{icon}</div>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue}>{value}</div>
      {trend && (
        <div className={`${styles.statTrend} ${trend.direction === 'up' ? styles.trendUp : styles.trendDown}`}>
          {trend.direction === 'up' ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
          {trend.value}
        </div>
      )}
    </Tag>
  );
}

/* ══════════════════════════════════════════
   InfoCard
   ══════════════════════════════════════════ */

interface InfoCardProps {
  children: ReactNode;
}

export function InfoCard({ children }: InfoCardProps) {
  return <div className={styles.infoCard}>{children}</div>;
}
