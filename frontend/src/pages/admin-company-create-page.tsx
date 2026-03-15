import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const schema = z.object({
  name: z.string().min(2, "Company name is required"),
  adminFullName: z.string().min(2, "Full name is required"),
  adminUsername: z.string().min(2, "Admin username is required"),
  adminPassword: z.string().min(6, "Password must be at least 6 characters")
});

type FormValues = z.infer<typeof schema>;

export function AdminCompanyCreatePage() {
  const { adminSession } = useAuth();
  const navigate = useNavigate();
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
      await api.createCompany(adminSession.token, values);
      form.reset();
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
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <div>
                <FormField
                  control={form.control}
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
              </div>
              <FormField
                control={form.control}
                name="adminFullName"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Admin full name</FormLabel>
                    <FormControl>
                      <Input {...field} />
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
                      <Input {...field} />
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
                        <Input type="password" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">The database file is created inside /data.</p>
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
