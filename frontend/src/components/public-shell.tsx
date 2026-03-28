import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";
import type { HeaderAction } from "@/components/app-header";
import { AppHeader } from "@/components/app-header";
import { AppHeaderLoadingBar } from "@/components/app-header-loading-bar";
import { AppHeaderStateProvider } from "@/components/app-header-state";
import { AppContentLane } from "@/components/app-content-lane";
import { AppFooter } from "@/components/app-footer";
import { AppFrame } from "@/components/app-frame";
import { RouteReveal } from "@/components/route-reveal";
import { useFullscreenFooterActions } from "@/hooks/use-fullscreen-footer-actions";

export function PublicShell({
  actions,
  children,
}: {
  actions?: HeaderAction[];
  children: ReactNode;
}) {
  const location = useLocation();

  return (
    <AppFrame appShell>
      <AppHeaderStateProvider>
        <PublicShellContent
          key={location.pathname}
          actions={actions}
        >
          {children}
        </PublicShellContent>
      </AppHeaderStateProvider>
    </AppFrame>
  );
}

function PublicShellContent({
  actions,
  children,
}: {
  actions?: HeaderAction[];
  children: ReactNode;
}) {
  const location = useLocation();
  const footerActions = useFullscreenFooterActions();
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
  }, [location.pathname]);

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
    <div className="flex min-h-0 flex-1 flex-col overflow-x-visible overflow-y-hidden">
      <AppHeaderLoadingBar />
      <AppContentLane>
        <AppHeader scope="public" actions={actions} />
      </AppContentLane>
      <main className="relative flex min-h-0 flex-1 flex-col overflow-x-visible overflow-y-hidden">
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 top-0 z-10 h-28 bg-gradient-to-b from-background via-background/90 via-20% to-transparent transition-opacity duration-300 ease-out ${showTopFade ? "opacity-100" : "opacity-0"}`}
        />
        <div
          ref={scrollAreaRef}
          className="app-scroll-area flex min-h-0 flex-1 flex-col overflow-x-visible overflow-y-auto overscroll-contain"
        >
          <RouteReveal routeKey={location.pathname} className="flex flex-col">
            <AppContentLane ref={scrollContentRef} className="flex flex-col pt-4 pb-4">
              {children}
            </AppContentLane>
          </RouteReveal>
        </div>
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-x-0 bottom-0 z-10 h-28 bg-gradient-to-t from-background via-background/95 via-20% to-transparent transition-opacity duration-300 ease-out ${showBottomFade ? "opacity-100" : "opacity-0"}`}
        />
      </main>
      <AppContentLane>
        <AppFooter context="app" actions={footerActions} />
      </AppContentLane>
    </div>
  );
}
