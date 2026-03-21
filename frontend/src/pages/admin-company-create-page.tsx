import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useState } from "react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { FileInput } from "@/components/ui/file-input";
import { Input } from "@/components/ui/input";

const schema = z.object({
  name: z.string().min(2, "Company name is required"),
  adminFullName: z.string().default(""),
  adminUsername: z.string().default(""),
  adminPassword: z.string().default("")
});

type FormValues = z.infer<typeof schema>;

export function AdminCompanyCreatePage() {
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
        await api.createCompanyFromCsvPackage(adminSession.token, {
          name: values.name,
          files: databaseFiles
        });
      } else {
        if (values.adminFullName.trim().length < 2) throw new Error("Full name is required");
        if (values.adminUsername.trim().length < 2) throw new Error("Admin username is required");
        if (values.adminPassword.trim().length < 6) throw new Error("Password must be at least 6 characters");
        await api.createCompany(adminSession.token, {
          name: values.name,
          adminFullName: values.adminFullName,
          adminUsername: values.adminUsername,
          adminPassword: values.adminPassword
        });
      }
      form.reset();
      setDatabaseFiles([]);
      toast({ title: "Company created" });
      navigate("/admin/companies");
    } catch (error) {
      toast({
        title: "Could not create company",
        description: error instanceof Error ? error.message : "Request failed"
      });
    }
  }

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle>Company setup</CardTitle>
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
                      <FormLabel>Company name</FormLabel>
                      <FormControl>
                        <Input placeholder="Ordination Dr. Berger" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex flex-col gap-2">
                <FormLabel>Import CSV migration package</FormLabel>
                <FileInput
                  files={databaseFiles}
                  multiple
                  accept=".zip,.csv"
                  placeholder="Upload one migration zip or company.csv plus all table CSV files"
                  buttonLabel="Select"
                  onFilesChange={setDatabaseFiles}
                />
              </div>
              <FormField
                control={form.control}
                name="adminFullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin full name</FormLabel>
                    <FormControl>
                      <Input placeholder="Anna Berger" {...field} disabled={databaseFiles.length > 0} />
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
                    <FormLabel>Admin username</FormLabel>
                    <FormControl>
                      <Input placeholder="anna.berger" {...field} disabled={databaseFiles.length > 0} />
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
                    <FormLabel>Admin password</FormLabel>
                    <FormControl>
                        <Input type="password" placeholder="Enter a secure password" {...field} disabled={databaseFiles.length > 0} />
                    </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  {databaseFiles.length > 0 ? "The uploaded migration zip or unpacked CSV set will seed this company database." : "The company will get its own isolated company database."}
                </p>
                <Button type="submit" disabled={form.formState.isSubmitting}>
                  Create company
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
