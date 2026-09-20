import { useCallback, useEffect, useRef, useState } from "react";
import { JevAssist } from "./jev-assist";
import type { JevStatus } from "./jev-assist";
export interface HostedAccess {
  signedIn: boolean;
  subscribed: boolean;
  billingReady: boolean;
  billingUnavailable: boolean;
  recoveryConfirmed: boolean;
  hasCustomer: boolean;
  usage: number;
  limit: number;
}
export function useJevAssist() {
  const [status, setStatus] = useState<JevStatus>({
    state: "off",
    latencyMs: null,
    result: null,
  });
  const [assist] = useState(() => new JevAssist(setStatus));
  const [hosted, setHosted] = useState<HostedAccess | null>(null);
  const [enabled, setEnabledState] = useState(false);
  const [connection, setConnection] = useState<
    "checking" | "ready" | "missing" | "unavailable" | "locked"
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
      if (!signal.aborted) {
        const hostedMode = result.mode === "hosted";
        setHosted(
          hostedMode
            ? {
                signedIn: result.signedIn === true,
                subscribed: result.subscribed === true,
                billingReady: result.billingReady === true,
                billingUnavailable: result.billingUnavailable === true,
                recoveryConfirmed: result.recoveryConfirmed === true,
                hasCustomer: result.hasCustomer === true,
                usage: Number(result.usage) || 0,
                limit: Number(result.limit) || 50000,
              }
            : null,
        );
        setConnection(
          result.configured && (!hostedMode || result.subscribed === true)
            ? "ready"
            : hostedMode
              ? "locked"
              : "missing",
        );
      }
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
    if (
      connection === "missing" ||
      connection === "unavailable" ||
      connection === "locked"
    ) {
      assist.setEnabled(false);
      setEnabledState(false);
    }
  }, [assist, connection]);
  useEffect(() => {
    if (!hosted) return;
    const update = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(update, 30000);
    window.addEventListener("focus", update);
    window.addEventListener("cath-subscription-recheck", update);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", update);
      window.removeEventListener("cath-subscription-recheck", update);
    };
  }, [!!hosted, refresh]);
  const setEnabled = (value: boolean) => {
    const next = value && connection === "ready";
    assist.setEnabled(next);
    setEnabledState(next);
  };
  return { assist, status, enabled, setEnabled, connection, refresh, hosted };
}
