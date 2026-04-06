import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { AppContentLane } from "@/components/app-content-lane";
import { AppFooter } from "@/components/app-footer";
import { RouteReveal } from "@/components/route-reveal";

export const SHELL_FRAME_CLASSNAME = "flex h-full min-h-0 flex-col overflow-x-visible overflow-y-hidden py-5 sm:py-6 lg:py-8";
export const SHELL_HEADER_WRAPPER_CLASSNAME = "relative z-20";
export const SHELL_MAIN_CONTENT_CLASSNAME = "flex flex-col pt-4 pb-4";
export const SHELL_FOOTER_WRAPPER_CLASSNAME = "relative z-20 min-h-14 pt-2 pb-4";

export function ShellScaffold({
  routeKey,
  header,
  footerActions,
  children,
  bottomSlot,
  forceBottomFade = false,
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
  forceBottomFade?: boolean;
}) {
  const scrollAreaRef = useRef<HTMLDivElement | null>(null);
  const scrollContentRef = useRef<HTMLDivElement | null>(null);
  const [showTopFade, setShowTopFade] = useState(false);
  const [showBottomFade, setShowBottomFade] = useState(true);

  const syncScrollChrome = useCallback(() => {
    const viewport = scrollAreaRef.current;
    const content = scrollContentRef.current;

    if (!viewport || !content) {
      setShowTopFade(false);
      setShowBottomFade(true);
      return;
    }

    const viewportHeight = viewport.clientHeight;
    const contentHeight = Math.max(content.scrollHeight, content.offsetHeight);
    const maxScrollTop = Math.max(0, contentHeight - viewportHeight);
    const scrollTop = Math.max(0, Math.min(viewport.scrollTop, maxScrollTop));
    const hasOverflow = maxScrollTop > 1;

    setShowTopFade(hasOverflow && scrollTop > 2);
    setShowBottomFade(hasOverflow && scrollTop < maxScrollTop - 2);
    viewport.dataset.scrollable = hasOverflow ? "true" : "false";
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    const body = document.body;

    root.dataset.appShell = "true";
    body.dataset.appShell = "true";

    return () => {
      delete root.dataset.appShell;
      delete body.dataset.appShell;
    };
  }, []);

  useLayoutEffect(() => {
    scrollAreaRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
    setShowTopFade(false);
    setShowBottomFade(true);
  }, [routeKey]);

  useLayoutEffect(() => {
    const viewport = scrollAreaRef.current;
    const content = scrollContentRef.current;

    if (!viewport || !content) {
      return;
    }

    syncScrollChrome();

    const resizeObserver = new ResizeObserver(() => {
      syncScrollChrome();
    });
    resizeObserver.observe(viewport);
    resizeObserver.observe(content);

    const mutationObserver = new MutationObserver(() => {
      syncScrollChrome();
    });
    mutationObserver.observe(content, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });

    const handleScroll = () => {
      syncScrollChrome();
    };
    viewport.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", syncScrollChrome);

    let frame = 0;
    let rafId = 0;
    const bootstrapFrames = () => {
      syncScrollChrome();
      frame += 1;
      if (frame < 10) {
        rafId = window.requestAnimationFrame(bootstrapFrames);
      }
    };
    rafId = window.requestAnimationFrame(bootstrapFrames);

    return () => {
      window.cancelAnimationFrame(rafId);
      viewport.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", syncScrollChrome);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, [children, syncScrollChrome]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-x-visible overflow-y-hidden">
      <div className={SHELL_HEADER_WRAPPER_CLASSNAME}>
        <AppContentLane>
          {header}
        </AppContentLane>
      </div>
      <main className="relative flex min-h-0 flex-1 flex-col overflow-x-visible overflow-y-hidden">
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-36 bg-gradient-to-b from-background via-background/98 via-22% to-transparent transition-[opacity] duration-500 ease-&lsqb;cubic-bezier(0.22,1,0.36,1)&rsqb; ${showTopFade ? "opacity-100" : "opacity-0"}`}
        />
        <div
          ref={scrollAreaRef}
          className="app-scroll-area flex min-h-0 flex-1 flex-col overflow-x-visible overflow-y-auto overscroll-contain"
        >
          <RouteReveal routeKey={routeKey} className="flex flex-col">
            <AppContentLane ref={scrollContentRef} className={SHELL_MAIN_CONTENT_CLASSNAME}>
              {children}
            </AppContentLane>
          </RouteReveal>
        </div>
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-36 bg-gradient-to-t from-background via-background/98 via-22% to-transparent transition-[opacity] duration-500 ease-&lsqb;cubic-bezier(0.22,1,0.36,1)&rsqb; ${forceBottomFade || showBottomFade ? "opacity-100" : "opacity-0"}`}
        />
      </main>
      {bottomSlot ? <div className="relative z-20 pt-2">{bottomSlot}</div> : null}
      <div className={SHELL_FOOTER_WRAPPER_CLASSNAME}>
        <div className="absolute inset-x-0 bottom-0">
          <AppContentLane>
            <AppFooter context="app" actions={footerActions} />
          </AppContentLane>
        </div>
      </div>
    </div>
  );
}
