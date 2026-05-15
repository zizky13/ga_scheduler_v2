import { useState, useCallback, useEffect, useRef } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  GraduationCap,
  Wrench,
  DoorOpen,
  Clock,
  Users,
  BookOpen,
  Layers,
  Play,
  CalendarDays,
  Shield,
  ScrollText,
  PanelLeftClose,
  PanelLeftOpen,
  LogOut,
} from 'lucide-react';
import { RoleBadge } from './Badge';
import styles from './Sidebar.module.css';

interface NavItem {
  icon: React.ElementType;
  label: string;
  route: string;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
  adminOnly?: boolean;
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Data Management',
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', route: '/dashboard' },
      { icon: GraduationCap, label: 'Semesters', route: '/semesters', adminOnly: true },
      { icon: Wrench, label: 'Facilities', route: '/facilities', adminOnly: true },
      { icon: DoorOpen, label: 'Rooms', route: '/rooms' },
      { icon: Clock, label: 'Timeslots', route: '/timeslots' },
      { icon: Users, label: 'Lecturers', route: '/lecturers' },
      { icon: BookOpen, label: 'Courses', route: '/courses' },
      { icon: Layers, label: 'Offerings', route: '/offerings' },
    ],
  },
  {
    label: 'Scheduling',
    items: [
      { icon: Play, label: 'Run Schedule', route: '/runs' },
      { icon: CalendarDays, label: 'View Schedule', route: '/schedule' },
    ],
  },
  {
    label: 'Administration',
    adminOnly: true,
    items: [
      { icon: Shield, label: 'Users', route: '/users' },
      { icon: ScrollText, label: 'Audit Log', route: '/audit-log' },
    ],
  },
];

interface SidebarProps {
  userRole?: 'ADMIN' | 'USER';
  userName?: string;
  collapsed?: boolean;
  onToggleCollapse?: (collapsed: boolean) => void;
  onLogout?: () => void;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
}

export function Sidebar({
  userRole = 'ADMIN',
  userName,
  collapsed: controlledCollapsed,
  onToggleCollapse,
  onLogout,
  mobileOpen = false,
  onMobileClose,
}: SidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? internalCollapsed;

  const handleToggle = useCallback(() => {
    const next = !collapsed;
    setInternalCollapsed(next);
    onToggleCollapse?.(next);
  }, [collapsed, onToggleCollapse]);

  const visibleGroups = NAV_GROUPS
    .filter((group) => !group.adminOnly || userRole === 'ADMIN')
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.adminOnly || userRole === 'ADMIN'),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <>
      <div
        className={styles.backdrop}
        data-visible={mobileOpen}
        onClick={onMobileClose}
        aria-hidden="true"
      />
      <aside
        className={styles.sidebar}
        data-collapsed={collapsed}
        data-mobile-open={mobileOpen}
        aria-label="Main navigation"
      >
        <div className={styles.header}>
          <div className={styles.logo}>
            <span className={styles.logoText}>
              {collapsed ? 'GA' : 'GA Scheduler'}
            </span>
          </div>
          <button
            className={styles.collapseButton}
            onClick={handleToggle}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            type="button"
          >
            {collapsed ? (
              <PanelLeftOpen size={20} />
            ) : (
              <PanelLeftClose size={20} />
            )}
          </button>
        </div>

        <nav className={styles.nav}>
          {visibleGroups.map((group) => (
            <div key={group.label}>
              <div className={styles.groupLabel}>{group.label}</div>
              <div className={styles.groupSeparator} />
              {group.items.map((item) => (
                <NavLink
                  key={item.route}
                  to={item.route}
                  className={({ isActive }) =>
                    `${styles.navItem} ${isActive ? styles.navItemActive : ''}`
                  }
                  onClick={mobileOpen ? onMobileClose : undefined}
                >
                  <item.icon className={styles.navIcon} size={20} />
                  <span className={styles.navLabel}>{item.label}</span>
                  {collapsed && (
                    <span className={styles.tooltip}>{item.label}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        {userName && (
          <SidebarFooter
            userName={userName}
            userRole={userRole}
            collapsed={collapsed}
            onLogout={onLogout}
          />
        )}
      </aside>
    </>
  );
}

/* ── Sidebar Footer ── */

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

interface SidebarFooterProps {
  userName: string;
  userRole: 'ADMIN' | 'USER';
  collapsed: boolean;
  onLogout?: () => void;
}

function SidebarFooter({ userName, userRole, collapsed, onLogout }: SidebarFooterProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!popoverOpen) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [popoverOpen]);

  const initials = getInitials(userName);

  if (collapsed) {
    return (
      <div className={styles.footer} ref={popoverRef}>
        <button
          type="button"
          className={styles.avatarButton}
          onClick={() => setPopoverOpen((o) => !o)}
          aria-label="User menu"
          aria-expanded={popoverOpen}
        >
          <span className={styles.avatar}>{initials}</span>
        </button>

        {popoverOpen && (
          <div className={styles.footerPopover}>
            <p className={styles.popoverName}>{userName}</p>
            <RoleBadge role={userRole} />
            <button
              type="button"
              className={styles.popoverLogout}
              onClick={onLogout}
            >
              <LogOut size={14} />
              Log out
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.footer}>
      <span className={styles.avatar}>{initials}</span>
      <div className={styles.userInfo}>
        <span className={styles.userName}>{userName}</span>
        <RoleBadge role={userRole} />
      </div>
      <button
        type="button"
        className={styles.logoutButton}
        onClick={onLogout}
        aria-label="Log out"
      >
        <LogOut size={16} />
      </button>
    </div>
  );
}
