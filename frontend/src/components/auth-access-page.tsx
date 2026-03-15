import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { CompanySecurityResponse } from "@shared/types/api";
import { AppFooter } from "@/components/app-footer";
import { AuthMark } from "@/components/auth-mark";
import { AppFrame } from "@/components/app-frame";
import { deriveEncryptionProof, generateKdfSalt } from "@/lib/crypto";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { downloadSecureRecoveryKit } from "@/lib/recovery-kit";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SECURE_MODE_ITERATIONS = 210000;

const companyLoginSchema = z.object({
  companyName: z.string().min(1, "Company is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  encryptionKey: z.string().optional()
});

const registerSchema = z
  .object({
    name: z.string().min(2, "Company name is required"),
    adminUsername: z.string().min(2, "Admin username is required"),
    adminPassword: z.string().min(6, "Admin password must be at least 6 characters"),
    encryptionEnabled: z.boolean(),
    encryptionKey: z.string().optional(),
    confirmEncryptionKey: z.string().optional()
  })
  .superRefine((value, context) => {
    if (!value.encryptionEnabled) {
      return;
    }

    if (!value.encryptionKey || value.encryptionKey.length < 10) {
      context.addIssue({ code: "custom", path: ["encryptionKey"], message: "Encryption key must be at least 10 characters" });
    }

    if (value.encryptionKey !== value.confirmEncryptionKey) {
      context.addIssue({ code: "custom", path: ["confirmEncryptionKey"], message: "Encryption keys must match" });
    }
  });

const adminLoginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required")
});

type AuthMode = "sign-in" | "register" | "admin";
type CompanyLoginValues = z.infer<typeof companyLoginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;
type AdminLoginValues = z.infer<typeof adminLoginSchema>;

async function buildRecoverySnapshot(token: string) {
  const [meResult, dashboardResult, projectsResult, usersResult] = await Promise.allSettled([
    api.getCompanyMe(token),
    api.getDashboard(token),
    api.listProjects(token),
    api.listUsers(token)
  ]);

  const me = meResult.status === "fulfilled" ? meResult.value : null;
  const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
  const projects = projectsResult.status === "fulfilled" ? projectsResult.value : null;
  const users = usersResult.status === "fulfilled" ? usersResult.value : null;

  return {
    company: me?.company ?? null,
    currentUser: me?.user ?? null,
    dashboard: dashboard?.summary ?? null,
    projects: projects?.projects ?? [],
    tasks: projects?.tasks ?? [],
    users: users?.users ?? []
  };
}

export function AuthAccessPage({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { loginCompany, loginAdmin } = useAuth();
  const [companySecurity, setCompanySecurity] = useState<CompanySecurityResponse | null>(null);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const modeConfig: Record<AuthMode, { route: string; title: string; description: string }> = {
    "sign-in": {
      route: "/login",
      title: t("auth.companySignInTitle"),
      description: t("auth.companySignInDescription")
    },
    register: {
      route: "/register",
      title: t("auth.registerTitle"),
      description: t("auth.registerDescription")
    },
    admin: {
      route: "/admin/login",
      title: t("auth.adminTitle"),
      description: t("auth.adminDescription")
    }
  };

  const companyForm = useForm<CompanyLoginValues>({
    resolver: zodResolver(companyLoginSchema),
    defaultValues: { companyName: "", username: "", password: "", encryptionKey: "" }
  });
  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      adminUsername: "",
      adminPassword: "",
      encryptionEnabled: false,
      encryptionKey: "",
      confirmEncryptionKey: ""
    }
  });
  const adminForm = useForm<AdminLoginValues>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { username: "admin", password: "admin123" }
  });

  const companyName = companyForm.watch("companyName");
  const encryptionEnabled = registerForm.watch("encryptionEnabled");

  useEffect(() => {
    const normalizedCompany = companyName.trim();
    if (normalizedCompany.length < 2) {
      setCompanySecurity(null);
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        const response = await api.getCompanySecurity(normalizedCompany);
        setCompanySecurity(response);
      } catch {
        setCompanySecurity(null);
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [companyName]);

  async function onCompanySubmit(values: CompanyLoginValues) {
    try {
      let encryptionKeyProof: string | undefined;

      if (companySecurity?.encryptionEnabled) {
        if (!values.encryptionKey || !companySecurity.kdfSalt || !companySecurity.kdfIterations) {
          toast({
            title: t("auth.encryptionRequiredTitle"),
            description: t("auth.encryptionRequiredDescription")
          });
          return;
        }

        encryptionKeyProof = await deriveEncryptionProof(values.encryptionKey, companySecurity.kdfSalt, companySecurity.kdfIterations);
      }

      const response = await api.companyLogin({
        companyName: values.companyName,
        username: values.username,
        password: values.password,
        encryptionKeyProof
      });
      await loginCompany(response.session);
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: t("auth.signInFailed"),
        description: error instanceof Error ? error.message : "Login failed"
      });
    }
  }

  async function onRegisterSubmit(values: RegisterValues) {
    try {
      setRegisterSubmitting(true);

      let encryptionKdfAlgorithm: "pbkdf2-sha256" | undefined;
      let encryptionKdfIterations: number | undefined;
      let encryptionKdfSalt: string | undefined;
      let encryptionKeyVerifier: string | undefined;

      if (values.encryptionEnabled && values.encryptionKey) {
        encryptionKdfAlgorithm = "pbkdf2-sha256";
        encryptionKdfIterations = SECURE_MODE_ITERATIONS;
        encryptionKdfSalt = generateKdfSalt();
        encryptionKeyVerifier = await deriveEncryptionProof(values.encryptionKey, encryptionKdfSalt, encryptionKdfIterations);
      }

      const response = await api.registerCompany({
        name: values.name,
        adminUsername: values.adminUsername,
        adminPassword: values.adminPassword,
        encryptionEnabled: values.encryptionEnabled,
        encryptionKdfAlgorithm,
        encryptionKdfIterations,
        encryptionKdfSalt,
        encryptionKeyVerifier
      });

      if (values.encryptionEnabled && values.encryptionKey && encryptionKdfSalt && encryptionKdfIterations) {
        try {
          const snapshot = await buildRecoverySnapshot(response.session.token);
          await downloadSecureRecoveryKit({
            companyName: values.name,
            adminUsername: values.adminUsername,
            adminPassword: values.adminPassword,
            encryptionKey: values.encryptionKey,
            kdfAlgorithm: "pbkdf2-sha256",
            kdfIterations: encryptionKdfIterations,
            companyKdfSalt: encryptionKdfSalt,
            snapshot
          });
          toast({
            title: "Recovery package downloaded",
            description: "This browser saved a recovery card and an encrypted workspace backup locally."
          });
        } catch {
          toast({
            title: "Recovery package skipped",
            description: "The company was created, but this browser could not generate the local recovery files."
          });
        }
      }

      await loginCompany(response.session);
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: t("auth.companyRegistrationFailed"),
        description: error instanceof Error ? error.message : "Request failed"
      });
    } finally {
      setRegisterSubmitting(false);
    }
  }

  async function onAdminSubmit(values: AdminLoginValues) {
    try {
      const response = await api.adminLogin(values);
      await loginAdmin(response.session);
      navigate("/admin/companies");
    } catch (error) {
      toast({
        title: t("auth.signInFailed"),
        description: error instanceof Error ? error.message : "Login failed"
      });
    }
  }

  return (
    <AppFrame centered className="items-center">
      <div className="w-full space-y-3">
        <Card className="relative w-full border-border/90 shadow-[0_18px_60px_rgba(0,0,0,0.04)]">
          <Tabs
            value={mode}
            className="w-full"
            onValueChange={(value) => navigate(modeConfig[value as AuthMode].route)}
          >
            <CardHeader className="flex flex-col gap-3 pb-4">
              <AuthMark label={modeConfig[mode].title} />
              {mode !== "admin" ? (
                <div className="max-w-full overflow-x-auto">
                  <TabsList className="w-max min-w-0">
                    <TabsTrigger value="sign-in">
                      {t("common.signIn")}
                    </TabsTrigger>
                    <TabsTrigger value="register">
                      {t("common.register")}
                    </TabsTrigger>
                  </TabsList>
                </div>
              ) : null}
            </CardHeader>
            <CardContent className="pt-0">
            <div className="mb-4 rounded-2xl border border-border/70 bg-muted/15 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{modeConfig[mode].title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{modeConfig[mode].description}</p>
            </div>

            <TabsContent value="sign-in" className="mt-0">
              <Form {...companyForm}>
                <form className="space-y-3.5" onSubmit={companyForm.handleSubmit(onCompanySubmit)}>
                  <FormField
                    control={companyForm.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("auth.companyLabel")}</FormLabel>
                        <FormControl>
                          <Input placeholder="Acme" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={companyForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("common.username")}</FormLabel>
                        <FormControl>
                          <Input placeholder="jane" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={companyForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("common.password")}</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="********" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {companySecurity?.encryptionEnabled ? (
                    <FormField
                      control={companyForm.control}
                      name="encryptionKey"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t("auth.encryptionKeyLabel")}</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder={t("auth.secureModeLoginPlaceholder")} {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}
                  <Button className="w-full" type="submit" disabled={companyForm.formState.isSubmitting}>
                    {t("common.signIn")}
                  </Button>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="register" className="mt-0">
              <Form {...registerForm}>
                <form className="space-y-3.5" onSubmit={registerForm.handleSubmit(onRegisterSubmit)}>
                  <FormField
                    control={registerForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("auth.companyNameLabel")}</FormLabel>
                        <FormControl>
                          <Input placeholder="Acme" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={registerForm.control}
                    name="adminUsername"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("auth.adminUsernameLabel")}</FormLabel>
                        <FormControl>
                          <Input placeholder="jane" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={registerForm.control}
                    name="adminPassword"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("auth.adminPasswordLabel")}</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="********" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={registerForm.control}
                    name="encryptionEnabled"
                    render={({ field }) => (
                      <FormItem className="rounded-2xl border border-border bg-muted/20 p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-foreground">
                              {field.value ? t("auth.secureModeOn") : t("auth.secureModeOff")}
                            </p>
                            <p className="text-xs leading-5 text-muted-foreground">
                              {field.value
                                ? t("auth.secureModeOnDescription")
                                : t("auth.secureModeOffDescription")}
                            </p>
                          </div>
                          <Switch checked={field.value} onCheckedChange={field.onChange} />
                        </div>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  {encryptionEnabled ? (
                    <>
                      <FormField
                        control={registerForm.control}
                        name="encryptionKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("auth.encryptionKeyLabel")}</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder={t("auth.secureModePlaceholder")} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={registerForm.control}
                        name="confirmEncryptionKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("auth.confirmEncryptionKeyLabel")}</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder={t("auth.secureModeConfirmPlaceholder")} {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  ) : null}
                  <Button className="w-full" type="submit" disabled={registerSubmitting}>
                    {registerSubmitting ? t("auth.creatingCompany") : t("auth.createCompany")}
                  </Button>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="admin" className="mt-0">
              <Form {...adminForm}>
                <form className="space-y-3.5" onSubmit={adminForm.handleSubmit(onAdminSubmit)}>
                  <FormField
                    control={adminForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("common.username")}</FormLabel>
                        <FormControl>
                          <Input {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={adminForm.control}
                    name="password"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("common.password")}</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button className="w-full" type="submit" disabled={adminForm.formState.isSubmitting}>
                    {t("auth.signInAsAdmin")}
                  </Button>
                </form>
              </Form>
            </TabsContent>

            </CardContent>
          </Tabs>
        </Card>
        <AppFooter context="public" publicMode="auth" authMode={mode} />
      </div>
    </AppFrame>
  );
}
