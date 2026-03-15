import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { AdminGuard, CompanyAdminGuard, CompanyGuard } from "@/components/route-guards";
import { AdminCompaniesPage } from "@/pages/admin-companies-page";
import { AdminCompanyCreatePage } from "@/pages/admin-company-create-page";
import { AdminLoginPage } from "@/pages/admin-login-page";
import { AdminMenuPage } from "@/pages/admin-menu-page";
import { DashboardDayPickerPage } from "@/pages/dashboard-day-picker-page";
import { DashboardRecordEditorPage } from "@/pages/dashboard-record-editor-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { LearnPage } from "@/pages/learn-page";
import { LoginPage } from "@/pages/login-page";
import { MenuPage } from "@/pages/menu-page";
import { RegisterCompanyPage } from "@/pages/register-company-page";
import { SettingsMenuPage } from "@/pages/settings-menu-page";
import { UsersPage } from "@/pages/users-page";
import { UserEditorPage } from "@/pages/user-editor-page";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/learn" element={<LearnPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterCompanyPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route element={<CompanyGuard />}>
        <Route element={<AppShell mode="company" />}>
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/dashboard/day" element={<DashboardDayPickerPage />} />
          <Route path="/dashboard/records/create" element={<DashboardRecordEditorPage mode="create" />} />
          <Route path="/dashboard/records/:entryId/edit" element={<DashboardRecordEditorPage mode="edit" />} />
          <Route element={<CompanyAdminGuard />}>
            <Route path="/users" element={<UsersPage />} />
            <Route path="/users/create" element={<UserEditorPage mode="create" />} />
            <Route path="/users/:userId/edit" element={<UserEditorPage mode="edit" />} />
            <Route path="/settings" element={<SettingsMenuPage />} />
          </Route>
        </Route>
      </Route>
      <Route element={<AdminGuard />}>
        <Route element={<AppShell mode="admin" />}>
          <Route path="/admin/menu" element={<AdminMenuPage />} />
          <Route path="/admin/companies" element={<AdminCompaniesPage />} />
          <Route path="/admin/company/create" element={<AdminCompanyCreatePage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
