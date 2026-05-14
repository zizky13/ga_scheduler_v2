import type { ReactNode } from 'react';
import styles from './ContentArea.module.css';

interface ContentAreaProps {
  sidebarCollapsed: boolean;
  children: ReactNode;
}

export function ContentArea({ sidebarCollapsed, children }: ContentAreaProps) {
  const marginLeft = sidebarCollapsed
    ? 'var(--sidebar-width-collapsed)'
    : 'var(--sidebar-width)';

  return (
    <main
      className={styles.contentArea}
      style={{ marginLeft }}
    >
      <div className={styles.inner}>
        {children}
      </div>
    </main>
  );
}

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  divider?: boolean;
}

export function PageHeader({ title, description, actions, divider }: PageHeaderProps) {
  return (
    <div className={styles.pageHeader}>
      <div className={styles.pageHeaderRow}>
        <div className={styles.pageHeaderText}>
          <h1 className={styles.pageTitle}>{title}</h1>
          {description && (
            <p className={styles.pageDescription}>{description}</p>
          )}
        </div>
        {actions && (
          <div className={styles.pageActions}>{actions}</div>
        )}
      </div>
      {divider && <div className={styles.pageDivider} />}
    </div>
  );
}
