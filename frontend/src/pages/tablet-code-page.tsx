import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AppFooter } from "@/components/app-footer";
import { AppFrame } from "@/components/app-frame";
import { AuthMark } from "@/components/auth-mark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { toast } from "@/lib/toast";

export function TabletCodePage() {
  const navigate = useNavigate();
  const { setTabletAccess } = useAuth();
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleContinue() {
    try {
      setSubmitting(true);
      const response = await api.tabletAccess({ code });
      setTabletAccess({ companyName: response.companyName, code });
      navigate("/tablet/pin");
    } catch (error) {
      toast({
        title: "Could not open tablet mode",
        description: error instanceof Error ? error.message : "Request failed"
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AppFrame centered className="items-center">
      <div className="flex w-full flex-col gap-3">
        <Card className="border-border/90 shadow-[0_18px_60px_rgba(0,0,0,0.04)]">
          <CardHeader className="flex flex-col gap-3 pb-4">
            <AuthMark label="Tablet mode" />
          </CardHeader>
          <CardContent className="flex flex-col gap-4 pt-0">
            <div className="rounded-2xl border border-border/70 bg-muted/15 px-4 py-3">
              <p className="text-sm font-semibold text-foreground">Enter tablet code</p>
              <p className="text-xs leading-5 text-muted-foreground">Use the company tablet code to unlock the shared tablet PIN screen.</p>
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-foreground" htmlFor="tablet-code">
                Tablet code
              </label>
              <Input
                id="tablet-code"
                placeholder="Enter tablet code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </div>
            <Button disabled={submitting || code.trim().length < 6} onClick={() => void handleContinue()} type="button">
              {submitting ? "Checking..." : "Continue"}
            </Button>
          </CardContent>
        </Card>
        <AppFooter context="public" publicMode="auth" authMode="sign-in" />
      </div>
    </AppFrame>
  );
}
