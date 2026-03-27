import { Navigate, Route, Routes } from "react-router-dom";
import { AuthAccessPage } from "@/components/auth-access-page";
import { AppShell } from "@/components/app-shell";
import { AppRouteLoadingState } from "@/components/page-load-state";
import { AdminGuard, CompanyAdminGuard, CompanyFullAccessGuard, CompanyGuard } from "@/components/route-guards";
import { useAuth } from "@/lib/auth";
import { AdminCompaniesPage } from "@/pages/admin-companies-page";
import { AdminLoginPage } from "@/pages/admin-login-page";
import { DashboardDayPickerPage } from "@/pages/dashboard-day-picker-page";
import { DashboardRecordEditorPage } from "@/pages/dashboard-record-editor-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { LearnPage } from "@/pages/learn-page";
import { LoginPage } from "@/pages/login-page";
import { MenuPage } from "@/pages/menu-page";
import { RegisterCompanyPage } from "@/pages/register-company-page";
import { ReportsPage } from "@/pages/reports-page";
import { ReportsPreviewPage } from "@/pages/reports-preview-page";
import { ApiAccessPage } from "@/pages/api-access-page";
import { SettingsMenuPage } from "@/pages/settings-menu-page";
import { OvertimeSettingsPage } from "@/pages/overtime-settings-page";
import { TabletCodePage } from "@/pages/tablet-code-page";
import { TabletPinPage } from "@/pages/tablet-pin-page";
import { FieldsPage } from "@/pages/fields-page";
import { ProjectEditorPage } from "@/pages/project-editor-page";
import { ProjectsPage } from "@/pages/projects-page";
import { TaskEditorPage } from "@/pages/task-editor-page";
import { TasksPage } from "@/pages/tasks-page";
import { UsersPage } from "@/pages/users-page";
import { UserEditorPage } from "@/pages/user-editor-page";

function PublicEntryRoute() {
  const { loading, adminSession, companySession } = useAuth();
  if (loading) return <AppRouteLoadingState />;
  if (adminSession) return <Navigate to="/admin" replace />;
  if (companySession) {
    return <Navigate to={companySession.accessMode === "tablet" ? "/dashboard" : "/menu"} replace />;
  }
  return <AuthAccessPage />;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<PublicEntryRoute />} />
      <Route path="/learn" element={<LearnPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route path="/tablet" element={<TabletCodePage />} />
      <Route path="/tablet/pin" element={<TabletPinPage />} />
      <Route path="/register" element={<RegisterCompanyPage />} />
      <Route element={<CompanyGuard />}>
        <Route element={<AppShell mode="company" />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/day" element={<DashboardDayPickerPage />} />
          <Route path="/dashboard/records/create" element={<DashboardRecordEditorPage mode="create" />} />
          <Route path="/dashboard/records/:entryId/edit" element={<DashboardRecordEditorPage mode="edit" />} />
          <Route element={<CompanyFullAccessGuard />}>
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/preview" element={<ReportsPreviewPage />} />
            <Route element={<CompanyAdminGuard />}>
              <Route path="/users" element={<UsersPage />} />
              <Route path="/users/create" element={<UserEditorPage mode="create" />} />
              <Route path="/users/:userId/edit" element={<UserEditorPage mode="edit" />} />
              <Route path="/fields" element={<FieldsPage />} />
              <Route path="/projects" element={<ProjectsPage />} />
              <Route path="/projects/create" element={<ProjectEditorPage mode="create" />} />
              <Route path="/projects/:projectId/edit" element={<ProjectEditorPage mode="edit" />} />
              <Route path="/tasks" element={<TasksPage />} />
              <Route path="/tasks/create" element={<TaskEditorPage mode="create" />} />
              <Route path="/tasks/:taskId/edit" element={<TaskEditorPage mode="edit" />} />
              <Route path="/settings" element={<SettingsMenuPage />} />
              <Route path="/settings/overtime" element={<OvertimeSettingsPage />} />
              <Route path="/api-access" element={<ApiAccessPage />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route element={<AdminGuard />}>
        <Route element={<AppShell mode="admin" />}>
          <Route path="/admin" element={<AdminCompaniesPage />} />
          <Route path="/admin/companies" element={<AdminCompaniesPage />} />
        </Route>
      </Route>
      <Route path="*" element={<PublicEntryRoute />} />
    </Routes>
  );
}
