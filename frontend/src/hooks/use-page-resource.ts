import type { Dispatch, SetStateAction } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type PageResourceStatus = "idle" | "loading" | "refreshing" | "ready" | "error";

interface UsePageResourceOptions<T> {
  load: () => Promise<T>;
  deps: readonly unknown[];
  enabled?: boolean;
  initialData?: T | null;
  minPendingMs?: number;
}

export interface PageResource<T> {
  data: T | null;
  error: unknown;
  status: PageResourceStatus;
  hasData: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  setData: Dispatch<SetStateAction<T | null>>;
  reload: () => Promise<T | null>;
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function usePageResource<T>({
  load,
  deps,
  enabled = true,
  initialData = null,
  minPendingMs = 180,
}: UsePageResourceOptions<T>): PageResource<T> {
  const [data, setData] = useState<T | null>(initialData);
  const [error, setError] = useState<unknown>(null);
  const [status, setStatus] = useState<PageResourceStatus>(enabled ? (initialData === null ? "loading" : "ready") : "idle");
  const requestIdRef = useRef(0);
  const dataRef = useRef<T | null>(initialData);
  const loadRef = useRef(load);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  const reload = useCallback(async () => {
    if (!enabled) {
      setStatus("idle");
      return dataRef.current;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const hadData = dataRef.current !== null;
    setStatus(hadData ? "refreshing" : "loading");

    const startedAt = Date.now();

    try {
      const nextData = await loadRef.current();
      const elapsed = Date.now() - startedAt;
      if (elapsed < minPendingMs) {
        await wait(minPendingMs - elapsed);
      }

      if (requestIdRef.current !== requestId) {
        return dataRef.current;
      }

      setData(nextData);
      setError(null);
      setStatus("ready");
      return nextData;
    } catch (nextError) {
      if (requestIdRef.current !== requestId) {
        return dataRef.current;
      }

      setError(nextError);
      setStatus(hadData ? "ready" : "error");
      return dataRef.current;
    }
  }, [enabled, minPendingMs]);

  useEffect(() => {
    void reload();
  }, [enabled, reload, ...deps]);

  return {
    data,
    error,
    status,
    hasData: data !== null,
    isLoading: status === "loading",
    isRefreshing: status === "refreshing",
    setData,
    reload,
  };
}
