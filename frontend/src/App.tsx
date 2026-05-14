import { useState } from 'react';
import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { useTheme } from './lib/useTheme';
import { useAuthStore } from './store/authStore';
import { Sidebar } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ContentArea } from './components/ContentArea';
import { ProtectedRoute, RoleGuard } from './components/ProtectedRoute';
import { ToastContainer } from './components/Toast';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { PlaceholderPage } from './pages/PlaceholderPage';

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
          <Route path="runs" element={<PlaceholderPage title="Run Schedule" />} />
          <Route path="schedule" element={<PlaceholderPage title="View Schedule" />} />

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
