import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Backspace, X } from "phosphor-react";
import { useTranslation } from "react-i18next";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { TabletPinKey } from "@/components/ui/tablet-pin-key";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const keypadRows = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["clear", "0", "back"]
] as const;

function getErrorMessage(error: unknown, t: (key: string) => string) {
  if (!(error instanceof Error)) return t("tabletPin.accessFailed");
  if (error.message === "Invalid PIN code") return t("tabletPin.invalidPin");
  if (error.message === "User is inactive") return t("tabletPin.inactivePin");
  return error.message;
}

export function TabletPinPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { clearTabletAccess, companySession, loginCompany, lockTablet, tabletAccess } = useAuth();
  const [pinCode, setPinCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [errorState, setErrorState] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signOutCode, setSignOutCode] = useState("");
  const [signOutError, setSignOutError] = useState("");

  useEffect(() => {
    if (companySession?.accessMode === "tablet") {
      lockTablet();
    }
    // only on first open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!errorState) return;
    const timer = window.setTimeout(() => {
      setErrorState(false);
      setErrorMessage("");
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [errorState]);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;
    const hadDarkClass = root.classList.contains("dark");
    const rootStyle = root.style.backgroundColor;
    const bodyStyle = body.style.backgroundColor;
    const bodyColor = body.style.color;
    const colorScheme = root.style.colorScheme;

    root.classList.add("dark");
    root.style.backgroundColor = "hsl(var(--background))";
    root.style.colorScheme = "dark";
    body.style.backgroundColor = "hsl(var(--background))";
    body.style.color = "hsl(var(--foreground))";

    return () => {
      if (!hadDarkClass) {
        root.classList.remove("dark");
      }
      root.style.backgroundColor = rootStyle;
      root.style.colorScheme = colorScheme;
      body.style.backgroundColor = bodyStyle;
      body.style.color = bodyColor;
    };
  }, []);

  if (!tabletAccess) {
    return <Navigate to="/?mode=tablet" replace />;
  }

  const activeTabletAccess = tabletAccess;
  const keypadWidth = "min(78vw, calc((100svh - 26rem) * 0.75), 24rem)";

  async function unlock(nextPinCode: string) {
    try {
      setSubmitting(true);
      setErrorState(false);
      setErrorMessage("");
      const response = await api.tabletLogin({
        code: activeTabletAccess.code,
        pinCode: nextPinCode,
      });
      await loginCompany(response.session);
      navigate("/dashboard", { replace: true });
    } catch (error) {
      setPinCode("");
      setErrorMessage(getErrorMessage(error, t));
      setErrorState(true);
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyPress(value: string) {
    if (submitting) return;

    if (value === "back") {
      setPinCode((current) => current.slice(0, -1));
      setErrorState(false);
      setErrorMessage("");
      return;
    }

    if (value === "clear") {
      setPinCode("");
      setErrorState(false);
      setErrorMessage("");
      return;
    }

    setPinCode((current) => {
      const nextValue = `${current}${value}`.slice(0, 8);
      if (nextValue.length === 4) {
        void unlock(nextValue);
      }
      return nextValue;
    });
  }

  function handleSignOutConfirm() {
    const normalizedValue = signOutCode.trim();
    if (normalizedValue !== activeTabletAccess.code.trim()) {
      setSignOutError("Tablet code does not match");
      return;
    }

    clearTabletAccess();
    setSignOutCode("");
    setSignOutError("");
    setSignOutOpen(false);
    navigate("/?mode=tablet", { replace: true });
  }

  return (
    <div className="fixed inset-0 overflow-hidden bg-background text-foreground">
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6">
        <div
          className="grid h-full w-full max-w-xl grid-rows-[auto_minmax(0,1fr)_auto] justify-items-center overflow-hidden"
          style={{
            height: "min(100svh, 100dvh)",
            maxHeight: "100%",
            paddingTop: "max(1rem, env(safe-area-inset-top))",
            paddingBottom: "max(1.25rem, calc(env(safe-area-inset-bottom) + 0.75rem))",
            paddingLeft: "max(1rem, env(safe-area-inset-left))",
            paddingRight: "max(1rem, env(safe-area-inset-right))"
          }}
        >
        <div className="flex w-full justify-center pt-1">
          <Logo size={104} tone="dark" />
        </div>

        <div className="grid min-h-0 w-full place-items-center py-4 sm:py-4">
          <div className="grid h-full w-full min-h-0 max-w-[24rem] grid-rows-[auto_auto_minmax(0,1fr)] justify-items-center gap-5 sm:gap-5">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-base text-muted-foreground sm:text-lg">{activeTabletAccess.companyName}</p>
              <p className="text-lg font-medium text-foreground sm:text-xl">{t("tabletPin.enterPin")}</p>
            </div>

            <div className="flex flex-col items-center gap-3">
              <div className={cn("mx-auto flex items-center justify-center gap-3", errorState && "animate-[shake_0.28s_ease-in-out_1]")}>
                {Array.from({ length: 4 }).map((_, index) => (
                  <span
                    key={index}
                    className="flex h-11 w-10 items-center justify-center rounded-lg border text-base font-semibold transition-[border-color,background-color,color,transform] duration-150 sm:h-12 sm:w-11"
                    style={{
                      borderColor: errorState
                        ? "hsl(var(--destructive))"
                        : index < pinCode.length
                          ? "hsl(var(--foreground) / 0.22)"
                          : "hsl(var(--border))",
                      backgroundColor: errorState
                        ? "hsl(var(--destructive) / 0.18)"
                        : index < pinCode.length
                          ? "hsl(var(--foreground))"
                          : "hsl(var(--muted) / 0.28)",
                      color: errorState
                        ? "hsl(var(--destructive))"
                        : index < pinCode.length
                          ? "hsl(var(--background))"
                          : "hsl(var(--muted-foreground))"
                    }}
                  >
                    <span className={cn("leading-none", index < pinCode.length ? "opacity-100" : "opacity-0")}>
                      •
                    </span>
                  </span>
                ))}
              </div>
              <p className={cn("min-h-[1.25rem] text-sm", errorState ? "text-destructive" : "text-muted-foreground")}>
                {errorState ? errorMessage : submitting ? t("tabletPin.unlocking") : t("tabletPin.digitsHint")}
              </p>
            </div>

            <div className="grid min-h-0 w-full place-items-center self-stretch overflow-hidden py-4 sm:py-4">
              <div
                className="mx-auto grid w-full grid-cols-3 gap-3 p-3 sm:gap-4 sm:p-4"
                style={{
                  width: keypadWidth,
                }}
              >
                {keypadRows.flat().map((key) => {
                  if (key === "back") {
                    return (
                      <TabletPinKey key={key} onClick={() => handleKeyPress("back")}>
                        <Backspace size={30} weight="bold" />
                      </TabletPinKey>
                    );
                  }

                  if (key === "clear") {
                    return (
                      <TabletPinKey key={key} muted onClick={() => handleKeyPress("clear")}>
                        <X size={28} weight="bold" />
                      </TabletPinKey>
                    );
                  }

                  return (
                    <TabletPinKey key={key} onClick={() => handleKeyPress(key)}>
                      {key}
                    </TabletPinKey>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex w-full items-center justify-center gap-3 px-1 pt-3 pb-1 text-xs text-muted-foreground">
          <p className="whitespace-nowrap">jtzt.com</p>
          <span className="h-1 w-1 rounded-full bg-muted-foreground/40" />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 rounded-full px-2.5 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => {
              setSignOutCode("");
              setSignOutError("");
              setSignOutOpen(true);
            }}
          >
            Sign out
          </Button>
        </div>
        </div>
      </div>

      <Dialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sign out of tablet mode</DialogTitle>
            <DialogDescription>
              Enter the tablet code to confirm sign out.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Input
              autoFocus
              value={signOutCode}
              onChange={(event) => {
                setSignOutCode(event.target.value);
                if (signOutError) {
                  setSignOutError("");
                }
              }}
              placeholder="Tablet code"
            />
            {signOutError ? <p className="text-sm text-destructive">{signOutError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSignOutOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleSignOutConfirm}>
                Sign out
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
