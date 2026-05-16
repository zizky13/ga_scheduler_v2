import { useState, useEffect, useCallback } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useTheme } from './lib/useTheme';
import { useAuthStore } from './store/authStore';
import { useSemesterStore } from './store/semesterStore';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ContentArea } from './components/ContentArea';
import { ProtectedRoute, RoleGuard } from './components/ProtectedRoute';
import { ToastContainer } from './components/Toast';
import { SessionExpiredModal } from './components/SessionExpiredModal';
import { AccountDisabledModal } from './components/AccountDisabledModal';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { RunHistoryPage } from './pages/RunHistoryPage';
import { RunCreationPage } from './pages/RunCreationPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { ScheduleViewerPage } from './pages/ScheduleViewerPage';
import { SemesterManagementPage } from './pages/SemesterManagementPage';
import { FacilityManagementPage } from './pages/FacilityManagementPage';
import { RoomManagementPage } from './pages/RoomManagementPage';
import { TimeslotManagementPage } from './pages/TimeslotManagementPage';
import { LecturerManagementPage } from './pages/LecturerManagementPage';
import { CourseManagementPage } from './pages/CourseManagementPage';
import { CourseOfferingManagementPage } from './pages/CourseOfferingManagementPage';
import { UserManagementPage } from './pages/UserManagementPage';
import { AuditLogPage } from './pages/AuditLogPage';

type Breakpoint = 'mobile' | 'tablet' | 'desktop';

function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>(() => {
    if (typeof window === 'undefined') return 'desktop';
    if (window.innerWidth < 640) return 'mobile';
    if (window.innerWidth <= 1024) return 'tablet';
    return 'desktop';
  });

  useEffect(() => {
    const mobile = window.matchMedia('(max-width: 639px)');
    const tablet = window.matchMedia('(min-width: 640px) and (max-width: 1024px)');

    function update() {
      if (mobile.matches) setBp('mobile');
      else if (tablet.matches) setBp('tablet');
      else setBp('desktop');
    }

    mobile.addEventListener('change', update);
    tablet.addEventListener('change', update);
    return () => {
      mobile.removeEventListener('change', update);
      tablet.removeEventListener('change', update);
    };
  }, []);

  return bp;
}

function AppShell() {
  const { theme, toggleTheme } = useTheme();
  const breakpoint = useBreakpoint();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const fetchSemesters = useSemesterStore((s) => s.fetchSemesters);

  useEffect(() => {
    fetchSemesters();
  }, [fetchSemesters]);

  const effectiveCollapsed = breakpoint === 'tablet' ? true : sidebarCollapsed;

  const handleToggleSidebar = useCallback(() => {
    if (breakpoint === 'mobile') {
      setMobileDrawerOpen((prev) => !prev);
    } else {
      setSidebarCollapsed((prev) => !prev);
    }
  }, [breakpoint]);

  const handleMobileClose = useCallback(() => {
    setMobileDrawerOpen(false);
  }, []);

  return (
    <>
      <Sidebar
        collapsed={effectiveCollapsed}
        onToggleCollapse={setSidebarCollapsed}
        userRole={user?.role}
        userName={user?.name}
        onLogout={logout}
        mobileOpen={mobileDrawerOpen}
        onMobileClose={handleMobileClose}
      />
      <TopBar
        sidebarCollapsed={effectiveCollapsed}
        theme={theme}
        onToggleTheme={toggleTheme}
        onToggleSidebar={handleToggleSidebar}
        userName={user?.name}
        userEmail={user?.email}
        userRole={user?.role}
        onLogout={logout}
      />
      <ContentArea sidebarCollapsed={effectiveCollapsed}>
        <Outlet />
      </ContentArea>
    </>
  );
}

function App() {
  return (
    <>
    <ToastContainer />
    <SessionExpiredModal />
    <AccountDisabledModal />
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          {/* Default redirect */}
          <Route index element={<Navigate to="/dashboard" replace />} />

          {/* Data Management */}
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="rooms" element={<RoomManagementPage />} />
          <Route path="timeslots" element={<TimeslotManagementPage />} />
          <Route path="lecturers" element={<LecturerManagementPage />} />
          <Route path="courses" element={<CourseManagementPage />} />
          <Route path="offerings" element={<CourseOfferingManagementPage />} />

          {/* Scheduling */}
          <Route path="runs" element={<RunHistoryPage />} />
          <Route path="runs/new" element={<RunCreationPage />} />
          <Route path="runs/:id" element={<RunDetailPage />} />
          <Route path="schedule" element={<ScheduleViewerPage />} />

          {/* ADMIN-only routes */}
          <Route element={<RoleGuard allowedRoles={['ADMIN']} />}>
            <Route path="semesters" element={<SemesterManagementPage />} />
            <Route path="facilities" element={<FacilityManagementPage />} />
            <Route path="users" element={<UserManagementPage />} />
            <Route path="audit-log" element={<AuditLogPage />} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Route>
    </Routes>
    </>
  );
}

export default App;
