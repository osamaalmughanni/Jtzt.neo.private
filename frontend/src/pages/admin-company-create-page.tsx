import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FilePicker } from "@/components/ui/file-picker";
import { Input } from "@/components/ui/input";

const schema = z.object({
  name: z.string().min(2, "Company name is required"),
  adminFullName: z.string().default(""),
  adminUsername: z.string().default(""),
  adminPassword: z.string().default("")
});

type FormValues = z.infer<typeof schema>;

export function AdminCompanyCreatePage() {
  const { t } = useTranslation();
  const { adminSession } = useAuth();
  const navigate = useNavigate();
  const [databaseFiles, setDatabaseFiles] = useState<File[]>([]);
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      adminFullName: "",
      adminUsername: "",
      adminPassword: ""
    }
  });

  async function onSubmit(values: FormValues) {
    if (!adminSession) return;
    try {
      if (databaseFiles.length > 0) {
        await api.createCompanyFromMigrationFile(adminSession.token, {
          name: values.name,
          file: databaseFiles[0]
        });
      } else {
        if (values.adminFullName.trim().length < 2) throw new Error(t("adminCompanies.adminFullNameRequired"));
        if (values.adminUsername.trim().length < 2) throw new Error(t("adminCompanies.adminUsernameRequired"));
        if (values.adminPassword.trim().length < 6) throw new Error(t("adminCompanies.adminPasswordRequired"));
        await api.createCompany(adminSession.token, {
          name: values.name,
          adminFullName: values.adminFullName,
          adminUsername: values.adminUsername,
          adminPassword: values.adminPassword
        });
      }
      form.reset();
      setDatabaseFiles([]);
      toast({ title: t("adminCompanies.companyCreated") });
      navigate("/admin/companies");
    } catch (error) {
      toast({
        title: t("adminCompanies.companyCreateFailed"),
        description: error instanceof Error ? error.message : t("common.requestFailed")
      });
    }
  }

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>{t("adminCompanies.createCompanySheetTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="flex flex-col gap-4" onSubmit={form.handleSubmit(onSubmit)}>
              <div>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.company")}</FormLabel>
                      <FormControl>
                        <Input placeholder={t("adminCompanies.companyNamePlaceholder")} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex flex-col gap-2">
                <FilePicker
                  label={t("adminCompanies.optionalSqliteImport")}
                  noSelectionLabel={t("adminCompanies.noFileSelected")}
                  multipleSelectionLabel={t("adminCompanies.filesSelected")}
                  buttonLabel={t("adminCompanies.attachFile")}
                  accept=".sqlite"
                  files={databaseFiles}
                  onFilesChange={setDatabaseFiles}
                />
              </div>
              <FormField
                control={form.control}
                name="adminFullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.fullName")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("adminCompanies.adminFullNamePlaceholder")} {...field} disabled={databaseFiles.length > 0} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="adminUsername"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("common.username")}</FormLabel>
                    <FormControl>
                      <Input placeholder={t("adminCompanies.adminUsernamePlaceholder")} {...field} disabled={databaseFiles.length > 0} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div>
                <FormField
                  control={form.control}
                  name="adminPassword"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("common.password")}</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder={t("adminCompanies.adminPasswordPlaceholder")} {...field} disabled={databaseFiles.length > 0} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {databaseFiles.length > 0 ? t("adminCompanies.companyDatabaseSeeded") : t("adminCompanies.companyDatabaseIsolated")}
                </p>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  {t("adminCompanies.createCompany")}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
