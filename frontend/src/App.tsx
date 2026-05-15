import { useState } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useTheme } from './lib/useTheme';
import { useAuthStore } from './store/authStore';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ContentArea } from './components/ContentArea';
import { ProtectedRoute, RoleGuard } from './components/ProtectedRoute';
import { ToastContainer } from './components/Toast';
import { SessionExpiredModal } from './components/SessionExpiredModal';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PlaceholderPage } from './pages/PlaceholderPage';
import { RunHistoryPage } from './pages/RunHistoryPage';
import { RunCreationPage } from './pages/RunCreationPage';
import { RunDetailPage } from './pages/RunDetailPage';
import { ScheduleViewerPage } from './pages/ScheduleViewerPage';

function AppShell() {
  const { theme, toggleTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  return (
    <>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={setSidebarCollapsed}
        userRole={user?.role}
        userName={user?.name}
        onLogout={logout}
      />
      <TopBar
        sidebarCollapsed={sidebarCollapsed}
        theme={theme}
        onToggleTheme={toggleTheme}
        onToggleSidebar={() => setSidebarCollapsed((prev) => !prev)}
        userName={user?.name}
        userEmail={user?.email}
        userRole={user?.role}
        onLogout={logout}
      />
      <ContentArea sidebarCollapsed={sidebarCollapsed}>
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
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<ProtectedRoute />}>
        <Route element={<AppShell />}>
          {/* Default redirect */}
          <Route index element={<Navigate to="/dashboard" replace />} />

          {/* Data Management */}
          <Route path="dashboard" element={<DashboardPage />} />
          <Route path="rooms" element={<PlaceholderPage title="Rooms" />} />
          <Route path="timeslots" element={<PlaceholderPage title="Timeslots" />} />
          <Route path="lecturers" element={<PlaceholderPage title="Lecturers" />} />
          <Route path="courses" element={<PlaceholderPage title="Courses" />} />
          <Route path="offerings" element={<PlaceholderPage title="Offerings" />} />

          {/* Scheduling */}
          <Route path="runs" element={<RunHistoryPage />} />
          <Route path="runs/new" element={<RunCreationPage />} />
          <Route path="runs/:id" element={<RunDetailPage />} />
          <Route path="schedule" element={<ScheduleViewerPage />} />

          {/* ADMIN-only routes */}
          <Route element={<RoleGuard allowedRoles={['ADMIN']} />}>
            <Route path="semesters" element={<PlaceholderPage title="Semesters" />} />
            <Route path="facilities" element={<PlaceholderPage title="Facilities" />} />
            <Route path="users" element={<PlaceholderPage title="Users" />} />
            <Route path="audit-log" element={<PlaceholderPage title="Audit Log" />} />
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
