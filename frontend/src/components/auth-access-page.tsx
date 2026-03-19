import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useTranslation } from "react-i18next";
import { useNavigate, useSearchParams } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AnimatePresence, motion } from "framer-motion";
import type { CompanySecurityResponse, TabletAccessResponse } from "@shared/types/api";
import { AuthMark } from "@/components/auth-mark";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { deriveEncryptionProof, generateKdfSalt } from "@/lib/crypto";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { downloadSecureRecoveryKit } from "@/lib/recovery-kit";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const SECURE_MODE_ITERATIONS = 210000;
const AUTH_MODES = ["sign-in", "register", "tablet", "admin"] as const;

const companyLoginSchema = z.object({
  companyName: z.string().min(1, "Company is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
  encryptionKey: z.string().optional(),
});

const registerSchema = z
  .object({
    name: z.string().min(2, "Company name is required"),
    adminUsername: z.string().min(2, "Admin username is required"),
    adminPassword: z.string().min(6, "Admin password must be at least 6 characters"),
    encryptionEnabled: z.boolean(),
    encryptionKey: z.string().optional(),
    confirmEncryptionKey: z.string().optional(),
  })
  .superRefine((value, context) => {
    if (!value.encryptionEnabled) return;

    if (!value.encryptionKey || value.encryptionKey.length < 10) {
      context.addIssue({ code: "custom", path: ["encryptionKey"], message: "Encryption key must be at least 10 characters" });
    }

    if (value.encryptionKey !== value.confirmEncryptionKey) {
      context.addIssue({ code: "custom", path: ["confirmEncryptionKey"], message: "Encryption keys must match" });
    }
  });

const tabletAccessSchema = z.object({
  code: z.string().min(1, "Tablet code is required"),
  encryptionKey: z.string().optional(),
});

const adminLoginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

type AuthMode = (typeof AUTH_MODES)[number];
type CompanyLoginValues = z.infer<typeof companyLoginSchema>;
type RegisterValues = z.infer<typeof registerSchema>;
type TabletAccessValues = z.infer<typeof tabletAccessSchema>;
type AdminLoginValues = z.infer<typeof adminLoginSchema>;

function resolveAuthMode(value: string | null): AuthMode {
  return AUTH_MODES.includes(value as AuthMode) ? (value as AuthMode) : "sign-in";
}

async function buildRecoverySnapshot(token: string) {
  const [meResult, dashboardResult, usersResult] = await Promise.allSettled([
    api.getCompanyMe(token),
    api.getDashboard(token),
    api.listUsers(token),
  ]);

  const me = meResult.status === "fulfilled" ? meResult.value : null;
  const dashboard = dashboardResult.status === "fulfilled" ? dashboardResult.value : null;
  const users = usersResult.status === "fulfilled" ? usersResult.value : null;

  return {
    company: me?.company ?? null,
    currentUser: me?.user ?? null,
    dashboard: dashboard?.summary ?? null,
    projects: [],
    tasks: [],
    users: users?.users ?? [],
  };
}

export function AuthAccessPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const { loginCompany, loginAdmin, setTabletAccess } = useAuth();
  const [companySecurity, setCompanySecurity] = useState<CompanySecurityResponse | null>(null);
  const [tabletAccessPreview, setTabletAccessPreview] = useState<TabletAccessResponse | null>(null);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);
  const [quoteIndex, setQuoteIndex] = useState(0);
  const mode = resolveAuthMode(searchParams.get("mode"));

  const copy = useMemo(
    () => ({
      landingTitle: t("auth.landingTitle", { defaultValue: "Track time without the noise." }),
      markTitle: t("auth.markTitle", { defaultValue: "Run the day clearly." }),
      landingDescription: t("auth.landingDescription", {
        defaultValue: "One clean entry point for company sign in, workspace creation, tablet access, and platform administration.",
      }),
      companyTitle: t("auth.companySignInTitle"),
      companyDescription: t("auth.companySignInDescription"),
      registerTitle: t("auth.registerTitle"),
      registerDescription: t("auth.registerDescription"),
      tabletTitle: t("auth.tabletTitle", { defaultValue: "Tablet access" }),
      tabletDescription: t("auth.tabletDescription", { defaultValue: "Open the shared tablet PIN screen for a company workspace." }),
      adminTitle: t("auth.adminTitle"),
      adminDescription: t("auth.adminDescription"),
      tabletTab: t("auth.tabletTab", { defaultValue: "Tablet" }),
      tabletCodeLabel: t("auth.tabletCodeLabel", { defaultValue: "Tablet code" }),
      tabletCodePlaceholder: t("auth.tabletCodePlaceholder", { defaultValue: "Enter tablet code" }),
      continueToTablet: t("auth.continueToTablet", { defaultValue: "Continue to tablet PIN" }),
      tabletChecking: t("auth.tabletChecking", { defaultValue: "Checking access..." }),
      tabletAccessFailed: t("auth.tabletAccessFailed", { defaultValue: "Tablet access failed" }),
      tabletEncryptionRequiredDescription: t("auth.tabletEncryptionRequiredDescription", {
        defaultValue: "This company uses Secure Mode. Enter the encryption key before opening tablet access.",
      }),
      tabletSecureCompanyDescription: t("auth.tabletSecureCompanyDescription", {
        defaultValue: "This company uses Secure Mode. Enter the encryption key before moving to the shared PIN screen.",
      }),
      tabletStandardCompanyDescription: t("auth.tabletStandardCompanyDescription", {
        defaultValue: "This company uses standard mode. Continue to the shared PIN screen.",
      }),
    }),
    [t],
  );

  const modeConfig: Record<AuthMode, { title: string; description: string }> = {
    "sign-in": { title: copy.companyTitle, description: copy.companyDescription },
    register: { title: copy.registerTitle, description: copy.registerDescription },
    tablet: { title: copy.tabletTitle, description: copy.tabletDescription },
    admin: { title: copy.adminTitle, description: copy.adminDescription },
  };

  const companyForm = useForm<CompanyLoginValues>({
    resolver: zodResolver(companyLoginSchema),
    defaultValues: { companyName: "", username: "", password: "", encryptionKey: "" },
  });
  const registerForm = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      name: "",
      adminUsername: "",
      adminPassword: "",
      encryptionEnabled: false,
      encryptionKey: "",
      confirmEncryptionKey: "",
    },
  });
  const tabletForm = useForm<TabletAccessValues>({
    resolver: zodResolver(tabletAccessSchema),
    defaultValues: { code: "", encryptionKey: "" },
  });
  const adminForm = useForm<AdminLoginValues>({
    resolver: zodResolver(adminLoginSchema),
    defaultValues: { username: "", password: "" },
  });

  const companyName = companyForm.watch("companyName");
  const encryptionEnabled = registerForm.watch("encryptionEnabled");
  const tabletCode = tabletForm.watch("code");
  const quotes = useMemo(
    () => [
      {
        body: "The team opens it, tracks the day, and moves on. Nothing gets in the way.",
        author: "Nina, operations lead",
      },
      {
        body: "Tablet mode is simple enough for shift handover and fast enough for real floor use.",
        author: "Yousef, site manager",
      },
      {
        body: "Reports and people management stay in one place, without turning into admin clutter.",
        author: "Marta, company admin",
      },
    ],
    [],
  );

  useEffect(() => {
    const normalizedCompany = companyName.trim();
    if (normalizedCompany.length < 2) {
      setCompanySecurity(null);
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        setCompanySecurity(await api.getCompanySecurity(normalizedCompany));
      } catch {
        setCompanySecurity(null);
      }
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [companyName]);

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

  useEffect(() => {
    const timer = window.setInterval(() => {
      setQuoteIndex((current) => (current + 1) % quotes.length);
    }, 3800);

    return () => window.clearInterval(timer);
  }, [quotes.length]);

  function navigateToMode(nextMode: AuthMode) {
    navigate(nextMode === "sign-in" ? "/" : `/?mode=${nextMode}`);
  }

  async function onCompanySubmit(values: CompanyLoginValues) {
    try {
      let encryptionKeyProof: string | undefined;

      if (companySecurity?.encryptionEnabled) {
        if (!values.encryptionKey || !companySecurity.kdfSalt || !companySecurity.kdfIterations) {
          toast({
            title: t("auth.encryptionRequiredTitle"),
            description: t("auth.encryptionRequiredDescription"),
          });
          return;
        }

        encryptionKeyProof = await deriveEncryptionProof(values.encryptionKey, companySecurity.kdfSalt, companySecurity.kdfIterations);
      }

      const response = await api.companyLogin({
        companyName: values.companyName,
        username: values.username,
        password: values.password,
        encryptionKeyProof,
      });
      await loginCompany(response.session);
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: t("auth.signInFailed"),
        description: error instanceof Error ? error.message : "Login failed",
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
        encryptionKeyVerifier,
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
            snapshot,
          });
        } catch {
          toast({
            title: "Recovery package skipped",
            description: "The company was created, but this browser could not generate the local recovery files.",
          });
        }
      }

      await loginCompany(response.session);
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: t("auth.companyRegistrationFailed"),
        description: error instanceof Error ? error.message : "Request failed",
      });
    } finally {
      setRegisterSubmitting(false);
    }
  }

  async function onTabletSubmit(values: TabletAccessValues) {
    try {
      const response = await api.tabletAccess({ code: values.code });

      if (response.encryptionEnabled && !values.encryptionKey) {
        toast({
          title: t("auth.encryptionRequiredTitle"),
          description: copy.tabletEncryptionRequiredDescription,
        });
        return;
      }

      setTabletAccess({
        companyName: response.companyName,
        code: values.code,
      });
      navigate("/tablet/pin");
    } catch (error) {
      toast({
        title: copy.tabletAccessFailed,
        description: error instanceof Error ? error.message : "Request failed",
      });
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
        description: error instanceof Error ? error.message : "Login failed",
      });
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="md:hidden">
        <div className="flex min-h-dvh flex-col p-6">
          <div className="pb-8">
            <AuthMark label={copy.markTitle} />
          </div>
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-sm">{renderAuthPanel()}</div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-6">
            <LanguageSwitcher compact />
            <ThemeToggle compact />
            <Button type="button" variant={mode === "tablet" ? "secondary" : "ghost"} size="sm" className="h-8 rounded-full px-3 text-xs" onClick={() => navigateToMode("tablet")}>
              {copy.tabletTab}
            </Button>
            <Button type="button" variant={mode === "admin" ? "secondary" : "ghost"} size="sm" className="h-8 rounded-full px-3 text-xs" onClick={() => navigateToMode("admin")}>
              {t("common.admin")}
            </Button>
          </div>
        </div>
      </div>

      <div className="relative hidden min-h-dvh flex-1 md:grid md:grid-cols-2">
        <section className="relative hidden h-full flex-col overflow-hidden border-r border-border/60 bg-muted/30 p-10 text-primary md:flex">
          <div className="absolute inset-0 bg-primary/5" />
          <div className="relative z-20">
            <AuthMark label={copy.markTitle} />
          </div>
          <div className="relative z-20 mt-12 max-w-md">
            <h1 className="text-5xl font-semibold leading-[0.95] tracking-[-0.05em] text-foreground text-balance">
              Time tracking for calm, direct company workflows.
            </h1>
            <p className="mt-5 text-sm leading-7 text-muted-foreground">
              Track time, manage people, and open tablet access from one focused workspace.
            </p>
          </div>
          <div className="relative z-20 mt-auto max-w-md">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={quoteIndex}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                className="flex flex-col gap-3"
              >
                <p className="text-sm leading-7 text-foreground/90">{quotes[quoteIndex].body}</p>
                <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
                  {quotes[quoteIndex].author}
                </p>
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        <section className="relative flex items-center justify-center px-8 py-10 lg:px-12">
          <div className="absolute top-8 right-8">
            <Tabs value={mode} onValueChange={(value) => navigateToMode(resolveAuthMode(value))}>
              <TabsList className="grid h-auto grid-cols-2 rounded-xl bg-muted/60 p-1">
                <TabsTrigger value="sign-in" className="rounded-lg px-3 py-2">{t("common.signIn")}</TabsTrigger>
                <TabsTrigger value="register" className="rounded-lg px-3 py-2">{t("common.register")}</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          <div className="mx-auto flex w-full max-w-sm flex-col justify-center gap-6">
            {renderAuthPanel()}
          </div>

          <div className="absolute right-8 bottom-8 flex items-center gap-2">
            <LanguageSwitcher compact />
            <ThemeToggle compact />
            <Button
              type="button"
              variant={mode === "tablet" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => navigateToMode("tablet")}
            >
              {copy.tabletTab}
            </Button>
            <Button
              type="button"
              variant={mode === "admin" ? "secondary" : "ghost"}
              size="sm"
              className="h-8 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => navigateToMode("admin")}
            >
              {t("common.admin")}
            </Button>
          </div>
        </section>
      </div>
    </div>
  );

  function renderAuthPanel() {
    return (
      <Tabs value={mode} className="w-full" onValueChange={(value) => navigateToMode(resolveAuthMode(value))}>
        <div className="pb-6 md:hidden">
          <TabsList className="grid h-auto w-full grid-cols-2 rounded-xl bg-muted/60 p-1">
            <TabsTrigger value="sign-in" className="rounded-lg px-3 py-2">{t("common.signIn")}</TabsTrigger>
            <TabsTrigger value="register" className="rounded-lg px-3 py-2">{t("common.register")}</TabsTrigger>
          </TabsList>
        </div>

        <div className="flex flex-col gap-2 text-center md:text-left">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">{modeConfig[mode].title}</h2>
          <p className="text-sm text-muted-foreground">{modeConfig[mode].description}</p>
        </div>

        <TabsContent value="sign-in" className="mt-6">
          <Form {...companyForm}>
            <form className="space-y-4" onSubmit={companyForm.handleSubmit(onCompanySubmit)}>
              <AuthField control={companyForm.control} name="companyName" label={t("auth.companyLabel")} placeholder="Acme" />
              <AuthField control={companyForm.control} name="username" label={t("common.username")} placeholder="jane" />
              <AuthField control={companyForm.control} name="password" label={t("common.password")} placeholder="********" type="password" />
              {companySecurity?.encryptionEnabled ? (
                <AuthField
                  control={companyForm.control}
                  name="encryptionKey"
                  label={t("auth.encryptionKeyLabel")}
                  placeholder={t("auth.secureModeLoginPlaceholder")}
                  type="password"
                />
              ) : null}
              <Button className="w-full" type="submit" disabled={companyForm.formState.isSubmitting}>
                {t("common.signIn")}
              </Button>
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="register" className="mt-6">
          <Form {...registerForm}>
            <form className="space-y-4" onSubmit={registerForm.handleSubmit(onRegisterSubmit)}>
              <AuthField control={registerForm.control} name="name" label={t("auth.companyNameLabel")} placeholder="Acme" />
              <AuthField control={registerForm.control} name="adminUsername" label={t("auth.adminUsernameLabel")} placeholder="jane" />
              <AuthField control={registerForm.control} name="adminPassword" label={t("auth.adminPasswordLabel")} placeholder="********" type="password" />
              <FormField
                control={registerForm.control}
                name="encryptionEnabled"
                render={({ field }) => (
                  <FormItem className="rounded-xl border border-border/70 bg-muted/20 p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <p className="text-sm font-semibold text-foreground">
                          {field.value ? t("auth.secureModeOn") : t("auth.secureModeOff")}
                        </p>
                        <p className="text-xs leading-5 text-muted-foreground">
                          {field.value ? t("auth.secureModeOnDescription") : t("auth.secureModeOffDescription")}
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
                  <AuthField
                    control={registerForm.control}
                    name="encryptionKey"
                    label={t("auth.encryptionKeyLabel")}
                    placeholder={t("auth.secureModePlaceholder")}
                    type="password"
                  />
                  <AuthField
                    control={registerForm.control}
                    name="confirmEncryptionKey"
                    label={t("auth.confirmEncryptionKeyLabel")}
                    placeholder={t("auth.secureModeConfirmPlaceholder")}
                    type="password"
                  />
                </>
              ) : null}
              <Button className="w-full" type="submit" disabled={registerSubmitting}>
                {registerSubmitting ? t("auth.creatingCompany") : t("auth.createCompany")}
              </Button>
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="tablet" className="mt-6">
          <Form {...tabletForm}>
            <form className="space-y-4" onSubmit={tabletForm.handleSubmit(onTabletSubmit)}>
              <AuthField control={tabletForm.control} name="code" label={copy.tabletCodeLabel} placeholder={copy.tabletCodePlaceholder} />
              {tabletAccessPreview ? (
                <div className="rounded-xl border border-border/70 bg-muted/20 p-4">
                  <p className="text-sm font-semibold text-foreground">{tabletAccessPreview.companyName}</p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {tabletAccessPreview.encryptionEnabled ? copy.tabletSecureCompanyDescription : copy.tabletStandardCompanyDescription}
                  </p>
                </div>
              ) : null}
              {tabletAccessPreview?.encryptionEnabled ? (
                <AuthField
                  control={tabletForm.control}
                  name="encryptionKey"
                  label={t("auth.encryptionKeyLabel")}
                  placeholder={t("auth.secureModeLoginPlaceholder")}
                  type="password"
                />
              ) : null}
              <Button className="w-full" type="submit" disabled={tabletForm.formState.isSubmitting}>
                {tabletForm.formState.isSubmitting ? copy.tabletChecking : copy.continueToTablet}
              </Button>
            </form>
          </Form>
        </TabsContent>

        <TabsContent value="admin" className="mt-6">
          <Form {...adminForm}>
            <form className="space-y-4" onSubmit={adminForm.handleSubmit(onAdminSubmit)}>
              <AuthField control={adminForm.control} name="username" label={t("common.username")} placeholder="admin" />
              <AuthField control={adminForm.control} name="password" label={t("common.password")} type="password" placeholder="********" />
              <Button className="w-full" type="submit" disabled={adminForm.formState.isSubmitting}>
                {t("auth.signInAsAdmin")}
              </Button>
            </form>
          </Form>
        </TabsContent>
      </Tabs>
    );
  }
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
            <Input
              {...field}
              type={type}
              placeholder={placeholder}
              className={cn("h-11 rounded-lg border-border/70 bg-background shadow-none")}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}
