import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import type { CompanySecurityResponse } from "@shared/types/api";
import { AuthMark } from "@/components/auth-mark";
import { AppFrame } from "@/components/app-frame";
import { ThemeToggle } from "@/components/theme-toggle";
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

const modeConfig: Record<AuthMode, { label: string; route: string; title: string; description: string }> = {
  "sign-in": {
    label: "Sign in",
    route: "/login",
    title: "Company sign in",
    description: "Access an existing company workspace."
  },
  register: {
    label: "Register",
    route: "/register",
    title: "Register company",
    description: "Create a new company workspace and initial admin."
  },
  admin: {
    label: "Admin",
    route: "/admin/login",
    title: "Admin sign in",
    description: "System-level access for platform administration."
  }
};

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
  const { loginCompany, loginAdmin } = useAuth();
  const [companySecurity, setCompanySecurity] = useState<CompanySecurityResponse | null>(null);
  const [registerSubmitting, setRegisterSubmitting] = useState(false);

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
            title: "Encryption key required",
            description: "This company uses Secure Mode. Enter the encryption key to continue."
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
        title: "Sign in failed",
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
        title: "Company registration failed",
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
        title: "Admin sign in failed",
        description: error instanceof Error ? error.message : "Login failed"
      });
    }
  }

  return (
    <AppFrame centered className="items-center">
      <Card className="relative w-full border-border/90 shadow-[0_18px_60px_rgba(0,0,0,0.04)]">
        <Tabs
          value={mode}
          className="w-full"
          onValueChange={(value) => navigate(modeConfig[value as AuthMode].route)}
        >
          <CardHeader className="space-y-0">
            <AuthMark label={modeConfig[mode].title} />
            <div className="mt-4 max-w-full overflow-x-auto pb-1">
              <TabsList className="w-max min-w-0">
                <TabsTrigger value="sign-in">
                  Sign in
                </TabsTrigger>
                <TabsTrigger value="register">
                  Register
                </TabsTrigger>
                <TabsTrigger value="admin">
                  Admin
                </TabsTrigger>
              </TabsList>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-6 rounded-2xl border border-border/70 bg-muted/15 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{modeConfig[mode].title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{modeConfig[mode].description}</p>
            </div>

            <TabsContent value="sign-in" className="mt-0">
              <Form {...companyForm}>
                <form className="space-y-4" onSubmit={companyForm.handleSubmit(onCompanySubmit)}>
                  <FormField
                    control={companyForm.control}
                    name="companyName"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company</FormLabel>
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
                        <FormLabel>Username</FormLabel>
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
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" {...field} />
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
                          <FormLabel>Encryption key</FormLabel>
                          <FormControl>
                            <Input type="password" placeholder="Secure mode passphrase" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  ) : null}
                  <Button className="w-full" type="submit" disabled={companyForm.formState.isSubmitting}>
                    Sign in
                  </Button>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="register" className="mt-0">
              <Form {...registerForm}>
                <form className="space-y-4" onSubmit={registerForm.handleSubmit(onRegisterSubmit)}>
                  <FormField
                    control={registerForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Company name</FormLabel>
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
                        <FormLabel>Admin username</FormLabel>
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
                        <FormLabel>Admin password</FormLabel>
                        <FormControl>
                          <Input type="password" placeholder="••••••••" {...field} />
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
                            <p className="text-sm font-semibold text-foreground">Secure mode</p>
                            <p className="text-xs leading-5 text-muted-foreground">
                              Require a client-derived encryption proof at login and prepare this company for stronger data protection workflows.
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
                      <div className="rounded-2xl border border-border/70 bg-background px-4 py-3">
                        <p className="text-sm font-semibold text-foreground">Local recovery package</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          After company creation, this browser downloads a recovery card with the encryption key and a separate encrypted backup of the current workspace state. Nothing extra is stored on the server.
                        </p>
                      </div>
                      <FormField
                        control={registerForm.control}
                        name="encryptionKey"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Encryption key</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="Choose a strong passphrase" {...field} />
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
                            <FormLabel>Confirm encryption key</FormLabel>
                            <FormControl>
                              <Input type="password" placeholder="Repeat the passphrase" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </>
                  ) : null}
                  <Button className="w-full" type="submit" disabled={registerSubmitting}>
                    {registerSubmitting ? "Creating company..." : "Create company"}
                  </Button>
                </form>
              </Form>
            </TabsContent>

            <TabsContent value="admin" className="mt-0">
              <Form {...adminForm}>
                <form className="space-y-4" onSubmit={adminForm.handleSubmit(onAdminSubmit)}>
                  <FormField
                    control={adminForm.control}
                    name="username"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Username</FormLabel>
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
                        <FormLabel>Password</FormLabel>
                        <FormControl>
                          <Input type="password" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button className="w-full" type="submit" disabled={adminForm.formState.isSubmitting}>
                    Sign in as admin
                  </Button>
                </form>
              </Form>
            </TabsContent>

            <div className="mt-10 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-muted-foreground">
              <Link className="transition-opacity hover:opacity-60" to="/learn">
                Learn more
              </Link>
              <span aria-hidden="true">&middot;</span>
              <Link className="transition-opacity hover:opacity-60" to="/company">
                Company
              </Link>
              <div className="ml-auto">
                <ThemeToggle />
              </div>
            </div>
          </CardContent>
        </Tabs>
      </Card>
    </AppFrame>
  );
}
