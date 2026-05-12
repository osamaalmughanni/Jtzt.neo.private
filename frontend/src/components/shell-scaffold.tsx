import { useLayoutEffect, type ReactNode } from "react";
import { AppContentLane } from "@/components/app-content-lane";
import { AppFooter } from "@/components/app-footer";
import { RouteReveal } from "@/components/route-reveal";

export const SHELL_FRAME_CLASSNAME = "flex min-h-dvh flex-col bg-background text-foreground";
export const SHELL_HEADER_WRAPPER_CLASSNAME = "relative z-20";
export const SHELL_MAIN_CONTENT_CLASSNAME = "flex flex-1 min-w-0 flex-col";
export const SHELL_FOOTER_WRAPPER_CLASSNAME = "relative z-20 mt-auto flex flex-col gap-2";

export function ShellScaffold({
  routeKey,
  header,
  footerActions,
  children,
  bottomSlot,
  fullBleedContent = false,
}: {
  routeKey: string;
  header: ReactNode;
  footerActions: Array<{
    key: string;
    label: string;
    icon: any;
    onClick: () => void;
  }>;
  children: ReactNode;
  bottomSlot?: ReactNode;
  fullBleedContent?: boolean;
}) {
  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [routeKey]);

  return (
    <div className={`${SHELL_FRAME_CLASSNAME} gap-4 p-4 sm:gap-6 sm:p-6 lg:gap-8 lg:p-8`}>
      <div className={SHELL_HEADER_WRAPPER_CLASSNAME}>
        <AppContentLane>{header}</AppContentLane>
      </div>
      <main className="flex flex-1 min-w-0 flex-col">
        <RouteReveal routeKey={routeKey} className="flex flex-1 flex-col">
          {fullBleedContent ? (
            <div className={SHELL_MAIN_CONTENT_CLASSNAME}>{children}</div>
          ) : (
            <AppContentLane className={SHELL_MAIN_CONTENT_CLASSNAME}>{children}</AppContentLane>
          )}
        </RouteReveal>
      </main>
      <div className={SHELL_FOOTER_WRAPPER_CLASSNAME}>
        {bottomSlot}
        <AppContentLane>
          <AppFooter context="app" actions={footerActions} />
        </AppContentLane>
      </div>
    </div>
  );
}
