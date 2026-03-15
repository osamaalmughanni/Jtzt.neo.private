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
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required")
});

type FormValues = z.infer<typeof schema>;

export function AdminLoginPage() {
  const navigate = useNavigate();
  const { loginAdmin } = useAuth();
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { username: "admin", password: "admin123" }
  });

  async function onSubmit(values: FormValues) {
    try {
      const response = await api.adminLogin(values);
      await loginAdmin(response.session);
      navigate("/admin/companies");
    } catch (submissionError) {
      toast({
        title: "Admin sign in failed",
        description: submissionError instanceof Error ? submissionError.message : "Login failed"
      });
    }
  }

  return (
    <AppFrame centered className="items-center">
      <Card className="w-full">
        <CardHeader>
          <AuthMark label="Admin sign in" />
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form className="space-y-4" onSubmit={form.handleSubmit(onSubmit)}>
              <FormField
                control={form.control}
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
                control={form.control}
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
              <Button className="w-full" type="submit" disabled={form.formState.isSubmitting}>
                Sign in as admin
              </Button>
            </form>
          </Form>
          <div className="mt-10 flex flex-wrap items-center gap-x-2 gap-y-2 text-xs text-muted-foreground">
            <Link className="transition-opacity hover:opacity-60" to="/learn">
              Learn more
            </Link>
            <span aria-hidden="true">•</span>
            <Link className="transition-opacity hover:opacity-60" to="/login">
              Sign in
            </Link>
            <span aria-hidden="true">•</span>
            <Link className="transition-opacity hover:opacity-60" to="/company">
              Company
            </Link>
          </div>
        </CardContent>
      </Card>
    </AppFrame>
  );
}
