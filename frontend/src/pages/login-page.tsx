import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AuthMark } from "@/components/auth-mark";
import { AppFrame } from "@/components/app-frame";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";

const schema = z.object({
  companyName: z.string().min(1, "Company is required"),
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required")
});

type FormValues = z.infer<typeof schema>;

export function LoginPage() {
  const navigate = useNavigate();
  const { loginCompany } = useAuth();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      companyName: "",
      username: "",
      password: ""
    }
  });

  async function onSubmit(values: FormValues) {
    try {
      const response = await api.companyLogin(values);
      await loginCompany(response.session);
      navigate("/dashboard");
    } catch (submissionError) {
      toast({
        title: "Sign in failed",
        description: submissionError instanceof Error ? submissionError.message : "Login failed"
      });
    }
  }

  return (
    <AppFrame centered className="items-center">
      <Card className="relative w-full">
        <CardHeader>
          <AuthMark label="Sign in" />
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
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
                control={form.control}
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
                control={form.control}
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
              <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
                Sign in
              </Button>
            </form>
          </Form>

          <div className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-x-2 gap-y-2">
              <Link className="transition-opacity hover:opacity-60" to="/learn">
                Learn more
              </Link>
              <span aria-hidden="true">•</span>
              <Link className="transition-opacity hover:opacity-60" to="/company">
                Company
              </Link>
            </div>
            <Link className="ml-auto inline-flex items-center gap-1 transition-opacity hover:opacity-60" to="/admin/login">
              <span>Admin</span>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </CardContent>
      </Card>
    </AppFrame>
  );
}
