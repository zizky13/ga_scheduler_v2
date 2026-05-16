import { useState, useRef, useEffect, useCallback } from 'react';
import { useLocation, Link } from 'react-router-dom';
import {
  Menu,
  ChevronRight,
  ChevronDown,
  Check,
  Sun,
  Moon,
  KeyRound,
  LogOut,
} from 'lucide-react';
import { useSemesterStore } from '../store/semesterStore';
import type { SemesterItem } from '../store/semesterStore';
import { useToastStore } from '../store/toastStore';
import { ConfirmDialog } from './Modal';
import styles from './TopBar.module.css';

const ROUTE_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  semesters: 'Semesters',
  facilities: 'Facilities',
  rooms: 'Rooms',
  timeslots: 'Timeslots',
  lecturers: 'Lecturers',
  courses: 'Courses',
  offerings: 'Offerings',
  runs: 'Run Schedule',
  schedule: 'View Schedule',
  users: 'Users',
  'audit-log': 'Audit Log',
};

interface TopBarProps {
  sidebarCollapsed: boolean;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  onToggleSidebar?: () => void;
  disabled?: boolean;
  userName?: string;
  userEmail?: string;
  userRole?: 'ADMIN' | 'USER';
  onLogout?: () => void;
}

function useBreadcrumbs() {
  const location = useLocation();
  const segments = location.pathname.split('/').filter(Boolean);

  return segments.map((segment, index) => {
    const path = '/' + segments.slice(0, index + 1).join('/');
    const label = ROUTE_LABELS[segment] || segment;
    const isLast = index === segments.length - 1;
    return { path, label, isLast };
  });
}

function useClickOutside(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        handler();
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [ref, handler]);
}

export function TopBar({
  sidebarCollapsed,
  theme,
  onToggleTheme,
  onToggleSidebar,
  disabled = false,
  userName = 'Admin User',
  userEmail = 'admin@upj.ac.id',
  userRole = 'ADMIN',
  onLogout,
}: TopBarProps) {
  const breadcrumbs = useBreadcrumbs();
  const semesters = useSemesterStore((s) => s.semesters);
  const activeSemester = useSemesterStore((s) => s.activeSemester);
  const activateSemester = useSemesterStore((s) => s.activateSemester);
  const addToast = useToastStore((s) => s.addToast);

  const [semesterOpen, setSemesterOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [confirmTarget, setConfirmTarget] = useState<SemesterItem | null>(null);
  const [switching, setSwitching] = useState(false);

  const semesterRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const closeSemester = useCallback(() => setSemesterOpen(false), []);
  const closeUserMenu = useCallback(() => setUserMenuOpen(false), []);

  useClickOutside(semesterRef, closeSemester);
  useClickOutside(userMenuRef, closeUserMenu);

  const initials = userName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const leftOffset = sidebarCollapsed
    ? 'var(--sidebar-width-collapsed)'
    : 'var(--sidebar-width)';

  return (
    <header
      className={styles.topBar}
      style={{ left: leftOffset }}
    >
      <div className={styles.leftSection}>
        <button
          className={styles.hamburger}
          onClick={onToggleSidebar}
          aria-label="Toggle navigation menu"
          type="button"
        >
          <Menu size={20} />
        </button>

        <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
          {breadcrumbs.length === 0 && (
            <span className={styles.breadcrumbCurrent}>Dashboard</span>
          )}
          {breadcrumbs.map((crumb, i) => (
            <span key={crumb.path} style={{ display: 'contents' }}>
              {i > 0 && (
                <ChevronRight
                  size={12}
                  className={styles.breadcrumbSeparator}
                  aria-hidden
                />
              )}
              {crumb.isLast ? (
                <span className={styles.breadcrumbCurrent} aria-current="page">
                  {crumb.label}
                </span>
              ) : (
                <Link className={styles.breadcrumbLink} to={crumb.path}>
                  {crumb.label}
                </Link>
              )}
            </span>
          ))}
        </nav>
      </div>

      <div className={styles.rightSection}>
        {/* Semester Selector */}
        <div ref={semesterRef} style={{ position: 'relative' }}>
          <button
            className={`${styles.semesterSelector} ${semesterOpen ? styles.semesterSelectorOpen : ''} ${disabled ? styles.semesterSelectorDisabled : ''}`}
            onClick={() => setSemesterOpen((prev) => !prev)}
            aria-haspopup="listbox"
            aria-expanded={semesterOpen}
            disabled={disabled}
            title={disabled ? 'Close the current form before switching semesters' : undefined}
            type="button"
          >
            <span>{activeSemester?.code ?? '—'}</span>
            <ChevronDown size={14} className={styles.semesterSelectorIcon} />
          </button>

          {semesterOpen && (
            <div className={styles.semesterDropdown} role="listbox" aria-label="Select semester">
              {semesters.map((sem) => {
                const isActive = sem.id === activeSemester?.id;
                return (
                  <button
                    key={sem.id}
                    className={`${styles.semesterOption} ${isActive ? styles.semesterOptionActive : ''}`}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => {
                      setSemesterOpen(false);
                      if (!isActive) setConfirmTarget(sem);
                    }}
                    type="button"
                  >
                    {sem.code}
                    {isActive && <Check size={14} className={styles.checkIcon} />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Dark Mode Toggle */}
        <button
          className={styles.themeToggle}
          onClick={onToggleTheme}
          aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
          type="button"
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>

        {/* User Menu */}
        <div ref={userMenuRef} className={styles.userMenuWrapper}>
          <button
            className={styles.userAvatar}
            onClick={() => setUserMenuOpen((prev) => !prev)}
            aria-haspopup="menu"
            aria-expanded={userMenuOpen}
            aria-label="User menu"
            type="button"
          >
            {initials}
          </button>

          {userMenuOpen && (
            <div className={styles.userDropdown} role="menu">
              <div className={styles.userInfo}>
                <div className={styles.userName}>{userName}</div>
                <div className={styles.userEmail}>{userEmail}</div>
                <span
                  className={`${styles.userRole} ${
                    userRole === 'ADMIN' ? styles.roleAdmin : styles.roleUser
                  }`}
                >
                  {userRole}
                </span>
              </div>
              <div className={styles.dropdownDivider} />
              <button
                className={styles.dropdownItem}
                role="menuitem"
                onClick={() => setUserMenuOpen(false)}
                type="button"
              >
                <KeyRound size={16} />
                Change Password
              </button>
              <div className={styles.dropdownDivider} />
              <button
                className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                role="menuitem"
                onClick={() => {
                  setUserMenuOpen(false);
                  onLogout?.();
                }}
                type="button"
              >
                <LogOut size={16} />
                Log out
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmTarget}
        onClose={() => setConfirmTarget(null)}
        onConfirm={async () => {
          if (!confirmTarget) return;
          setSwitching(true);
          try {
            await activateSemester(confirmTarget.id);
            addToast({ type: 'success', title: `Switched to ${confirmTarget.code}.` });
          } catch {
            addToast({ type: 'error', title: 'Failed to switch semester.' });
          } finally {
            setSwitching(false);
            setConfirmTarget(null);
          }
        }}
        variant="warning"
        title="Switch Semester?"
        description={`You are about to switch from ${activeSemester?.code ?? '—'} to ${confirmTarget?.code ?? '—'}. Any unsaved changes on this page will be lost. All data views will reload for the selected semester.`}
        confirmLabel="Switch"
        cancelLabel="Cancel"
        loading={switching}
      />
    </header>
  );
}
