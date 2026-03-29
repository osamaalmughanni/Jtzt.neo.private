import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Backspace, X } from "phosphor-react";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Captcha } from "@/components/ui/captcha";
import { TabletPinKey } from "@/components/ui/tablet-pin-key";
import { AppRouteLoadingState } from "@/components/page-load-state";
import { ApiRequestError, api, describeApiErrorSummary } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cn } from "@/lib/utils";

const keypadRows = [
  ["1", "2", "3"],
  ["4", "5", "6"],
  ["7", "8", "9"],
  ["clear", "0", "back"]
] as const;
const CAPTCHA_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function createCaptchaChallenge(length = 6) {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);

  let challenge = "";
  for (let index = 0; index < length; index += 1) {
    challenge += CAPTCHA_CHARSET[bytes[index] % CAPTCHA_CHARSET.length];
  }

  return challenge;
}

function getErrorMessage(error: unknown, t: (key: string) => string) {
  if (error instanceof ApiRequestError) {
    const serverMessage = describeApiErrorSummary(error, "");

    if (error.status === 401) {
      if (serverMessage === "Invalid PIN code" || error.responseText.includes("Invalid PIN code")) {
        return t("tabletPin.invalidPin");
      }
      if (serverMessage === "User is inactive" || error.responseText.includes("User is inactive")) {
        return t("tabletPin.inactivePin");
      }
      return t("tabletPin.accessFailed");
    }

    return t("tabletPin.accessFailed");
  }

  if (!(error instanceof Error)) return t("tabletPin.accessFailed");
  if (error.message === "Invalid PIN code") return t("tabletPin.invalidPin");
  if (error.message === "User is inactive") return t("tabletPin.inactivePin");
  return t("tabletPin.accessFailed");
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
  const [signOutCaptcha, setSignOutCaptcha] = useState("");
  const [signOutCaptchaValue, setSignOutCaptchaValue] = useState("");
  const [signOutCaptchaError, setSignOutCaptchaError] = useState("");
  const [accessReady, setAccessReady] = useState(false);

  useEffect(() => {
    if (companySession?.accessMode === "tablet") {
      lockTablet();
    }
    // only on first open
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    setAccessReady(false);

    const verifyTabletAccess = async () => {
      const code = tabletAccess?.code;
      if (!code) {
        return;
      }

      try {
        await api.tabletAccess({ code });
        if (!cancelled) {
          setAccessReady(true);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof ApiRequestError && error.status === 401) {
          clearTabletAccess();
          navigate("/?mode=tablet", { replace: true });
          return;
        }

        setAccessReady(true);
      }
    };

    void verifyTabletAccess();

    const interval = window.setInterval(() => {
      void verifyTabletAccess();
    }, 10000);

    const onFocus = () => {
      void verifyTabletAccess();
    };

    window.addEventListener("focus", onFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [clearTabletAccess, navigate, tabletAccess?.code]);

  useEffect(() => {
    if (!errorState) return;
    const timer = window.setTimeout(() => {
      setErrorState(false);
      setErrorMessage("");
    }, 1400);
    return () => window.clearTimeout(timer);
  }, [errorState]);

  if (!tabletAccess) {
    return <Navigate to="/?mode=tablet" replace />;
  }

  if (!accessReady) {
    return <AppRouteLoadingState />;
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
      await loginCompany(response.session, { persist: false });
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

    if (errorState) {
      setErrorState(false);
      setErrorMessage("");
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
    const normalizedValue = signOutCaptchaValue.trim().toUpperCase();
    if (normalizedValue !== signOutCaptcha) {
      setSignOutCaptchaError(t("tabletPin.captchaMismatch"));
      return;
    }

    clearTabletAccess();
    setSignOutCaptchaValue("");
    setSignOutCaptchaError("");
    setSignOutOpen(false);
    navigate("/?mode=tablet", { replace: true });
  }

  function openSignOutDialog() {
    setSignOutCaptcha(createCaptchaChallenge());
    setSignOutCaptchaValue("");
    setSignOutCaptchaError("");
    setSignOutOpen(true);
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
          <Logo size={104} />
        </div>

        <div className="grid min-h-0 w-full place-items-center py-4 sm:py-4">
          <div className="grid h-full w-full min-h-0 max-w-[24rem] grid-rows-[auto_auto_minmax(0,1fr)] justify-items-center gap-5 sm:gap-5">
            <div className="flex flex-col items-center gap-2 text-center">
              <p className="text-base text-muted-foreground sm:text-lg">{activeTabletAccess.companyName}</p>
              <p className="text-lg font-medium text-foreground sm:text-xl">{t("tabletPin.enterPin")}</p>
            </div>

            <div className="flex flex-col items-center gap-3">
              <div className={cn("mx-auto flex items-center justify-center gap-3", errorState && "animate-[shake_0.28s_ease-in-out_1]")}>
                {Array.from({ length: 4 }).map((_, index) => {
                  const filled = index < pinCode.length;
                  const boxClassName = cn(
                    "relative grid h-11 w-11 place-items-center overflow-hidden rounded-xl border border-border bg-transparent transition-[background-color,border-color,color,opacity,transform] duration-200 ease-out sm:h-12 sm:w-12",
                    errorState
                      ? "border-destructive/70 text-destructive"
                      : filled
                        ? "text-foreground"
                        : "text-muted-foreground",
                  );

                  return (
                    <span key={index} className={boxClassName}>
                      <motion.span
                        aria-hidden="true"
                        className="h-6 w-6 rounded-full sm:h-7 sm:w-7"
                        style={{
                          backgroundColor: errorState ? "hsl(var(--destructive))" : "hsl(var(--foreground))",
                        }}
                        initial={false}
                        animate={{
                          scale: filled || errorState ? 1 : 0,
                          opacity: filled || errorState ? 1 : 0,
                        }}
                        transition={{
                          type: "spring",
                          stiffness: 520,
                          damping: 36,
                          mass: 0.35,
                        }}
                      />
                    </span>
                  );
                })}
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
            onClick={openSignOutDialog}
          >
            {t("tabletPin.signOut")}
          </Button>
        </div>
        </div>
      </div>

      <Dialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("tabletPin.captchaTitle")}</DialogTitle>
            <DialogDescription>{t("tabletPin.captchaDescription")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Captcha
              challenge={signOutCaptcha}
              value={signOutCaptchaValue}
              onChange={setSignOutCaptchaValue}
              onRefresh={() => {
                setSignOutCaptcha(createCaptchaChallenge());
                setSignOutCaptchaValue("");
                setSignOutCaptchaError("");
              }}
              label={t("tabletPin.captchaLabel")}
              description={t("tabletPin.captchaHint")}
              placeholder={t("tabletPin.captchaPlaceholder")}
              refreshLabel={t("tabletPin.captchaRefresh")}
              error={signOutCaptchaError}
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setSignOutOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" onClick={handleSignOutConfirm}>
                {t("tabletPin.signOut")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
