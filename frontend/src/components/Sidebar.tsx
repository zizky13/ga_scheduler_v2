import { useState, useCallback } from 'react';
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
} from 'lucide-react';
import styles from './Sidebar.module.css';

interface NavItem {
  icon: React.ElementType;
  label: string;
  route: string;
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
      { icon: GraduationCap, label: 'Semesters', route: '/semesters' },
      { icon: Wrench, label: 'Facilities', route: '/facilities' },
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
  collapsed?: boolean;
  onToggleCollapse?: (collapsed: boolean) => void;
}

export function Sidebar({
  userRole = 'ADMIN',
  collapsed: controlledCollapsed,
  onToggleCollapse,
}: SidebarProps) {
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = controlledCollapsed ?? internalCollapsed;

  const handleToggle = useCallback(() => {
    const next = !collapsed;
    setInternalCollapsed(next);
    onToggleCollapse?.(next);
  }, [collapsed, onToggleCollapse]);

  const visibleGroups = NAV_GROUPS.filter(
    (group) => !group.adminOnly || userRole === 'ADMIN'
  );

  return (
    <aside
      className={styles.sidebar}
      data-collapsed={collapsed}
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
    </aside>
  );
}
