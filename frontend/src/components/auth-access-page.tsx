import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { TabletAccessResponse } from "@shared/types/api";
import { Info } from "phosphor-react";
import { PublicShell } from "@/components/public-shell";
import { Stack } from "@/components/stack";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast, toastError } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Shield, TabletSmartphone } from "lucide-react";

const AUTH_MODES = ["sign-in", "register", "workspace", "tablet", "admin"] as const;

const companyLoginSchema = z.object({
  companyName: z.string().min(1, "Company is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z
  .object({
    name: z.string().min(2, "Company name is required"),
    adminUsername: z.string().min(2, "Admin username is required"),
    adminPassword: z.string().min(6, "Admin password must be at least 6 characters"),
    invitationCode: z.string().min(4, "Invitation code is required"),
  });

const tabletAccessSchema = z.object({
  code: z.string().min(1, "Tablet code is required"),
});

const adminLoginSchema = z.object({
  token: z.string().min(1, "Access token is required"),
});

const workspaceLoginSchema = z.object({
  token: z.string().min(1, "Workspace key is required"),
});

type AuthMode = (typeof AUTH_MODES)[number];
type CompanyLoginValues = z.infer<typeof companyLoginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;
type TabletAccessValues = z.infer<typeof tabletAccessSchema>;
type AdminLoginValues = z.infer<typeof adminLoginSchema>;
type WorkspaceLoginValues = z.infer<typeof workspaceLoginSchema>;

function resolveAuthMode(value: string | null): AuthMode {
  return AUTH_MODES.includes(value as AuthMode) ? (value as AuthMode) : "sign-in";
}

export function AuthAccessPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { loginCompany, loginAdmin, setTabletAccess } = useAuth();
  const [tabletAccessPreview, setTabletAccessPreview] = useState<TabletAccessResponse | null>(null);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const mode = resolveAuthMode(searchParams.get("mode"));

  const copy = useMemo(
    () => ({
      workspaceSubmitButton: t("auth.workspaceSubmitButton"),
      workspaceTokenLabel: t("auth.workspaceTokenLabel"),
      workspaceTokenPlaceholder: t("auth.workspaceTokenPlaceholder"),
      tabletTab: t("auth.tabletTab"),
      tabletCodeLabel: t("auth.tabletCodeLabel"),
      tabletCodePlaceholder: t("auth.tabletCodePlaceholder"),
      continueToTablet: t("auth.continueToTablet"),
      tabletChecking: t("auth.tabletChecking"),
      tabletAccessFailed: t("auth.tabletAccessFailed"),
      tabletStandardCompanyDescription: t("auth.tabletStandardCompanyDescription"),
      companyNamePlaceholder: t("auth.companyNamePlaceholder"),
      usernamePlaceholder: t("auth.usernamePlaceholder"),
      adminUsernamePlaceholder: t("auth.adminUsernamePlaceholder"),
      adminAccessTokenLabel: t("auth.adminAccessTokenLabel"),
      adminAccessTokenPlaceholder: t("auth.adminAccessTokenPlaceholder"),
      quickAccessLabel: t("auth.quickAccessLabel"),
    }),
    [t],
  );

  const companyForm = useForm<CompanyLoginValues>({
    resolver: zodResolver(companyLoginSchema),
    defaultValues: { companyName: "", username: "", password: "" },
  });
  const workspaceForm = useForm<WorkspaceLoginValues>({
    resolver: zodResolver(workspaceLoginSchema),
    defaultValues: { token: "" },
  });
  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      adminUsername: "",
      adminPassword: "",
      invitationCode: "",
    },
  });
  const tabletForm = useForm<TabletAccessValues>({
    resolver: zodResolver(tabletAccessSchema),
    defaultValues: { code: "" },
  });
  const adminForm = useForm<AdminLoginValues>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { token: "" },
  });

  const tabletCode = tabletForm.watch("code");

  useEffect(() => {
    const normalizedCode = tabletCode.trim();
    if (normalizedCode.length < 2) {
      setTabletAccessPreview(null);
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        setTabletAccessPreview(await api.tabletAccess({ code: normalizedCode }));
      } catch {
        setTabletAccessPreview(null);
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [tabletCode]);

  function navigateToMode(nextMode: AuthMode) {
    navigate(nextMode === "sign-in" ? "/" : `/?mode=${nextMode}`);
  }

  async function onCompanySubmit(values: CompanyLoginValues) {
    try {
      const response = await api.companyLogin({
        companyName: values.companyName,
        username: values.username,
        password: values.password,
      });
      await loginCompany(response.session);
      navigate("/dashboard");
    } catch (error) {
      toastError({
        title: t("auth.signInFailed"),
        error,
        fallback: "Login failed",
      });
    }
  }

  async function onWorkspaceSubmit(values: WorkspaceLoginValues) {
    try {
      const response = await api.workspaceLogin(values);
      await loginCompany(response.session);
      navigate("/dashboard");
    } catch (error) {
      toastError({
        title: t("auth.signInFailed"),
        error,
        fallback: "Login failed",
      });
    }
  }

  async function onRegisterSubmit(values: RegisterValues) {
    try {
      setRegisterSubmitting(true);

      const response = await api.registerCompany({
        name: values.name,
        adminUsername: values.adminUsername,
        adminPassword: values.adminPassword,
        invitationCode: values.invitationCode,
      });

      await loginCompany(response.session);
      navigate("/dashboard");
    } catch (error) {
      toastError({
        title: t("auth.companyRegistrationFailed"),
        error,
        fallback: "Request failed",
      });
    } finally {
      setRegisterSubmitting(false);
    }
  }

  async function onTabletSubmit(values: TabletAccessValues) {
    try {
      const response = await api.tabletAccess({ code: values.code });

      setTabletAccess({
        companyName: response.companyName,
        code: values.code,
      });
      navigate("/tablet/pin");
    } catch (error) {
      toastError({
        title: copy.tabletAccessFailed,
        error,
        fallback: "Request failed",
      });
    }
  }

  async function onAdminSubmit(values: AdminLoginValues) {
    try {
      const response = await api.adminLogin(values);
      await loginAdmin(response.session);
      navigate("/admin");
    } catch (error) {
      toastError({
        title: t("auth.signInFailed"),
        error,
        fallback: "Login failed",
      });
    }
  }

  return (
    <PublicShell
      actions={[{ to: "/learn", label: "Learn more", icon: Info }]}
    >
      <Stack gap="lg">
        <Card className="border bg-card shadow-sm">
          <CardContent className="p-5 sm:p-6">
            <div className="flex flex-col gap-4">
              <div className="overflow-x-auto">
                <Tabs value={mode} onValueChange={(value) => navigateToMode(resolveAuthMode(value))}>
                  <TabsList className="inline-flex h-auto min-w-full flex-nowrap bg-muted/60 p-1">
                    <TabsTrigger value="sign-in" className="flex-1 whitespace-nowrap px-3 py-2 text-xs sm:text-sm">{t("common.signIn")}</TabsTrigger>
                    <TabsTrigger value="register" className="flex-1 whitespace-nowrap px-3 py-2 text-xs sm:text-sm">{t("common.register")}</TabsTrigger>
                  </TabsList>
                </Tabs>
              </div>

              <Tabs value={mode} className="w-full" onValueChange={(value) => navigateToMode(resolveAuthMode(value))}>
              <TabsContent value="workspace" className="mt-0">
                <Form {...workspaceForm}>
                  <form className="space-y-4" onSubmit={workspaceForm.handleSubmit(onWorkspaceSubmit)}>
                  <AuthField control={workspaceForm.control} name="token" label={copy.workspaceTokenLabel} placeholder={copy.workspaceTokenPlaceholder} type="password" />
                    <Button className="w-full" type="submit" disabled={workspaceForm.formState.isSubmitting}>
                      {workspaceForm.formState.isSubmitting ? "Wird geladen..." : copy.workspaceSubmitButton}
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="sign-in" className="mt-0">
                <Form {...companyForm}>
                  <form className="space-y-4" onSubmit={companyForm.handleSubmit(onCompanySubmit)}>
                    <AuthField control={companyForm.control} name="companyName" label={t("auth.companyLabel")} placeholder={copy.companyNamePlaceholder} />
                    <AuthField control={companyForm.control} name="username" label={t("common.username")} placeholder={copy.usernamePlaceholder} />
                    <AuthField control={companyForm.control} name="password" label={t("common.password")} placeholder="********" type="password" />
                    <Button className="w-full" type="submit" disabled={companyForm.formState.isSubmitting}>
                      {t("common.signIn")}
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="register" className="mt-0">
                <Form {...registerForm}>
                  <form className="space-y-4" onSubmit={registerForm.handleSubmit(onRegisterSubmit)}>
                    <AuthField control={registerForm.control} name="name" label={t("auth.companyNameLabel")} placeholder={copy.companyNamePlaceholder} />
                    <AuthField control={registerForm.control} name="adminUsername" label={t("auth.adminUsernameLabel")} placeholder={copy.adminUsernamePlaceholder} />
                    <AuthField control={registerForm.control} name="adminPassword" label={t("auth.adminPasswordLabel")} placeholder="********" type="password" />
                    <AuthField control={registerForm.control} name="invitationCode" label="Einladungscode" placeholder="ABCD-EFGH-IJKL" />
                    <Button className="w-full" type="submit" disabled={registerSubmitting}>
                      {registerSubmitting ? t("auth.creatingCompany") : t("auth.createCompany")}
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="tablet" className="mt-0">
                <Form {...tabletForm}>
                  <form className="space-y-4" onSubmit={tabletForm.handleSubmit(onTabletSubmit)}>
                    <AuthField control={tabletForm.control} name="code" label={copy.tabletCodeLabel} placeholder={copy.tabletCodePlaceholder} />
                    {tabletAccessPreview ? (
                      <div className="border border-border bg-muted/20 p-4">
                        <p className="text-sm font-semibold text-foreground">{tabletAccessPreview.companyName}</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">{copy.tabletStandardCompanyDescription}</p>
                      </div>
                    ) : null}
                    <Button className="w-full" type="submit" disabled={tabletForm.formState.isSubmitting}>
                      {tabletForm.formState.isSubmitting ? copy.tabletChecking : copy.continueToTablet}
                    </Button>
                  </form>
                </Form>
              </TabsContent>

              <TabsContent value="admin" className="mt-0">
                <Form {...adminForm}>
                  <form className="space-y-4" onSubmit={adminForm.handleSubmit(onAdminSubmit)}>
                    <AuthField control={adminForm.control} name="token" label={copy.adminAccessTokenLabel} type="password" placeholder={copy.adminAccessTokenPlaceholder} />
                    <Button className="w-full" type="submit" disabled={adminForm.formState.isSubmitting}>
                      {t("auth.signInAsAdmin")}
                    </Button>
                  </form>
                </Form>
              </TabsContent>
              </Tabs>
            </div>
          </CardContent>
        </Card>

        <Card className="border bg-card shadow-sm">
          <CardContent className="p-4 sm:p-5">
              <div className="mb-3 flex items-center gap-2">
                <Badge variant="secondary" className="px-2 py-0.5 text-[10px] uppercase tracking-[0.18em]">
                  {copy.quickAccessLabel}
                </Badge>
              </div>
            <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "workspace" ? "default" : "outline"}
                  className="h-8 gap-1.5 px-2.5 text-xs"
                  onClick={() => navigateToMode("workspace")}
                >
                  <Shield className="h-3.5 w-3.5" />
                  {t("auth.workspaceKeyButton")}
                </Button>
              <Button
                type="button"
                size="sm"
                variant={mode === "tablet" ? "default" : "outline"}
                className="h-8 gap-1.5 px-2.5 text-xs"
                onClick={() => navigateToMode("tablet")}
              >
                <TabletSmartphone className="h-3.5 w-3.5" />
                {copy.tabletTab}
              </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={mode === "admin" ? "default" : "outline"}
                  className="h-8 gap-1.5 px-2.5 text-xs"
                  onClick={() => navigateToMode("admin")}
                >
                  <Shield className="h-3.5 w-3.5" />
                  {t("common.admin")}
                </Button>
            </div>
          </CardContent>
        </Card>
      </Stack>
    </PublicShell>
  );
}

function AuthField({
  control,
  name,
  label,
  placeholder,
  type = "text",
}: {
  control: any;
  name: string;
  label: string;
  placeholder?: string;
  type?: "text" | "password";
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem className="space-y-2">
          <FormLabel className="text-sm font-medium text-foreground">{label}</FormLabel>
          <FormControl>
            <Input {...field} type={type} placeholder={placeholder} className={cn("h-11 border-border/70 bg-background shadow-none")} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
