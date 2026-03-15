import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/app-shell";
import { AdminGuard, CompanyAdminGuard, CompanyGuard } from "@/components/route-guards";
import { AdminCompaniesPage } from "@/pages/admin-companies-page";
import { AdminCompanyCreatePage } from "@/pages/admin-company-create-page";
import { AdminLoginPage } from "@/pages/admin-login-page";
import { AdminMenuPage } from "@/pages/admin-menu-page";
import { CalendarPage } from "@/pages/calendar-page";
import { CompanyPage } from "@/pages/company-page";
import { DashboardPage } from "@/pages/dashboard-page";
import { LearnPage } from "@/pages/learn-page";
import { LoginPage } from "@/pages/login-page";
import { MenuPage } from "@/pages/menu-page";
import { ProjectsPage } from "@/pages/projects-page";
import { RegisterCompanyPage } from "@/pages/register-company-page";
import { SettingsMenuPage } from "@/pages/settings-menu-page";
import { TimePage } from "@/pages/time-page";
import { UsersPage } from "@/pages/users-page";
import { CreateUserPage } from "@/pages/create-user-page";

export function App() {
  return (
    <Routes>
      <Route path="/" element={<LoginPage />} />
      <Route path="/company" element={<CompanyPage />} />
      <Route path="/learn" element={<LearnPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterCompanyPage />} />
      <Route path="/admin/login" element={<AdminLoginPage />} />
      <Route element={<CompanyGuard />}>
        <Route element={<AppShell mode="company" />}>
          <Route path="/menu" element={<MenuPage />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/time" element={<TimePage />} />
          <Route path="/calendar" element={<CalendarPage />} />
          <Route path="/projects" element={<ProjectsPage />} />
          <Route element={<CompanyAdminGuard />}>
            <Route path="/settings" element={<SettingsMenuPage />} />
            <Route path="/settings/users" element={<UsersPage />} />
            <Route path="/settings/users/create" element={<CreateUserPage />} />
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
