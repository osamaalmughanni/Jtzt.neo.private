import { useEffect, useRef } from "react";
import { api, getApiUrl } from "@/lib/api";

const VERSION_POLL_INTERVAL_MS = 60000;

type VersionPayload = {
  version?: string;
};

export function AppVersionSync() {
  const currentVersionRef = useRef<string | null>(null);
  const reloadRequestedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    let pollTimer: number | null = null;
    let eventSource: EventSource | null = null;

    const requestReload = () => {
      if (reloadRequestedRef.current) {
        return;
      }

      reloadRequestedRef.current = true;
      window.location.reload();
    };

    const applyVersion = (version: string | null) => {
      if (!version) {
        return;
      }

      const trimmedVersion = version.trim();
      if (!trimmedVersion) {
        return;
      }

      const currentVersion = currentVersionRef.current;
      if (!currentVersion) {
        currentVersionRef.current = trimmedVersion;
        return;
      }

      if (currentVersion !== trimmedVersion) {
        requestReload();
      }
    };

    const checkVersion = async () => {
      try {
        const response = await api.getHealth();
        if (!cancelled) {
          applyVersion(response.version);
        }
      } catch {
        // Ignore transient failures. The polling loop and visibility checks retry.
      }
    };

    const schedulePoll = () => {
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }

      pollTimer = window.setTimeout(() => {
        void checkVersion().finally(() => {
          if (!cancelled) {
            schedulePoll();
          }
        });
      }, VERSION_POLL_INTERVAL_MS);
    };

    const handleVersionEvent = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as VersionPayload;
        applyVersion(payload.version ?? null);
      } catch {
        // Ignore malformed events and rely on the poll fallback.
      }
    };

    if (typeof EventSource !== "undefined") {
      eventSource = new EventSource(getApiUrl("/api/app/version/stream"));
      eventSource.addEventListener("version", handleVersionEvent as EventListener);
      eventSource.onmessage = handleVersionEvent;
      eventSource.onerror = () => {
        // The browser will retry automatically. Polling stays as the fallback.
      };
    }

    void checkVersion();
    schedulePoll();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkVersion();
      }
    };

    const handleFocus = () => {
      void checkVersion();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
      }
      eventSource?.close();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  return null;
}
