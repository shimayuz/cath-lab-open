import { useCallback, useEffect, useRef, useState } from "react";
import { JevAssist } from "./jev-assist";
import type { JevStatus } from "./jev-assist";
export function useJevAssist() {
  const [status, setStatus] = useState<JevStatus>({
    state: "off",
    latencyMs: null,
    result: null,
  });
  const [assist] = useState(() => new JevAssist(setStatus));
  const [enabled, setEnabledState] = useState(false);
  const [connection, setConnection] = useState<
    "checking" | "ready" | "missing" | "unavailable"
  >("checking");
  const statusRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(async (parentSignal?: AbortSignal) => {
    statusRequest.current?.abort();
    const controller = new AbortController();
    statusRequest.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(3000),
      ...(parentSignal ? [parentSignal] : []),
    ]);
    setConnection("checking");
    try {
      const response = await fetch(
        new URL(`${import.meta.env.BASE_URL}api/jev/status`, document.baseURI),
        { signal },
      );
      if (!response.ok) throw new Error("status-unavailable");
      const result = await response.json();
      if (typeof result.configured !== "boolean")
        throw new Error("invalid-status");
      if (!signal?.aborted)
        setConnection(result.configured ? "ready" : "missing");
    } catch {
      if (!controller.signal.aborted && !parentSignal?.aborted)
        setConnection("unavailable");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => {
      controller.abort();
      statusRequest.current?.abort();
      assist.setEnabled(false);
    };
  }, [assist, refresh]);
  useEffect(() => {
    if (connection === "missing" || connection === "unavailable") {
      assist.setEnabled(false);
      setEnabledState(false);
    }
  }, [assist, connection]);
  const setEnabled = (value: boolean) => {
    const next = value && connection === "ready";
    assist.setEnabled(next);
    setEnabledState(next);
  };
  return { assist, status, enabled, setEnabled, connection, refresh };
}
