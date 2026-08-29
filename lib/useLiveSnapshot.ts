"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { BotEvent, DashboardSnapshot, EquityPoint } from "./types";
import type { Session } from "./session";
import { fetchSnapshot } from "./api";
import { getErrorMessage } from "./errorMessage";

export type ConnState = "connecting" | "live" | "reconnecting" | "offline";

const MAX_EQUITY_POINTS = 200;
const LIVE_POLL_INTERVAL_MS = 15_000;
const MAX_RETRY_INTERVAL_MS = 60_000;

export function useLiveSnapshot(session: Session | null, onBotEvent?: (event: BotEvent) => void) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1500);
  const mounted = useRef(true);
  const onBotEventRef = useRef(onBotEvent);
  const previousOpenSymbolsRef = useRef<Set<string> | null>(null);
  const snapshotRequestRef = useRef<Promise<DashboardSnapshot> | null>(null);

  useEffect(() => {
    onBotEventRef.current = onBotEvent;
  }, [onBotEvent]);

  const pushEquityPoint = useCallback((balance: number) => {
    setEquityCurve((prev) => {
      const next = [...prev, { t: Date.now(), balance }];
      return next.length > MAX_EQUITY_POINTS
        ? next.slice(next.length - MAX_EQUITY_POINTS)
        : next;
    });
  }, []);

  const applySnapshot = useCallback(
    (snap: DashboardSnapshot) => {
      const currentOpenSymbols = new Set(snap.positions.map((position) => position.fullSymbol || position.symbol));
      const previousOpenSymbols = previousOpenSymbolsRef.current;
      if (previousOpenSymbols) {
        for (const symbol of previousOpenSymbols) {
          if (!currentOpenSymbols.has(symbol)) {
            onBotEventRef.current?.({
              type: "position.closed",
              timestamp: Date.now(),
              payload: { symbol },
            });
          }
        }
      }
      previousOpenSymbolsRef.current = currentOpenSymbols;
      setSnapshot(snap);
      pushEquityPoint(snap.account.totalBalance);
      setLastError(null);
    },
    [pushEquityPoint]
  );

  // NEW: Manual refresh function to force a state update
  const refreshSnapshot = useCallback(async () => {
    if (!session) return;
    try {
      snapshotRequestRef.current ??= fetchSnapshot(session).finally(() => {
        snapshotRequestRef.current = null;
      });
      const snap = await snapshotRequestRef.current;
      if (mounted.current) applySnapshot(snap);
    } catch (err: unknown) {
      if (mounted.current) setLastError(getErrorMessage(err, "Failed to refresh snapshot"));
    }
  }, [session, applySnapshot]);

  useEffect(() => {
    if (!session) return;

    const source = new EventSource("/api/operator/bot-events");
    source.onmessage = (message) => {
      try {
        const event = JSON.parse(message.data) as BotEvent;
        onBotEventRef.current?.(event);
      } catch {
        // Ignore malformed live messages; snapshot polling remains authoritative.
      }
    };

    return () => source.close();
  }, [session]);

  useEffect(() => {
    mounted.current = true;
    if (!session) return;

    const poll = async () => {
      if (!mounted.current) return;
      try {
        snapshotRequestRef.current ??= fetchSnapshot(session).finally(() => {
          snapshotRequestRef.current = null;
        });
        const snap = await snapshotRequestRef.current;
        if (!mounted.current) return;
        applySnapshot(snap);
        setConnState("live");
        retryDelay.current = LIVE_POLL_INTERVAL_MS;
      } catch (err: unknown) {
        if (!mounted.current) return;
        setLastError(getErrorMessage(err, "Failed to load snapshot"));
        setConnState((state) => (state === "connecting" ? "offline" : "reconnecting"));
        retryDelay.current = Math.min(
          Math.max(retryDelay.current, LIVE_POLL_INTERVAL_MS) * 1.6,
          MAX_RETRY_INTERVAL_MS
        );
      } finally {
        if (!mounted.current) return;
        if (retryTimer.current) clearTimeout(retryTimer.current);
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          void poll();
        }, retryDelay.current);
      }
    };

    retryDelay.current = LIVE_POLL_INTERVAL_MS;
    void poll();

    return () => {
      mounted.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, [session, applySnapshot]);

  // NEW: Exported refreshSnapshot alongside the other variables
  return { snapshot, connState, equityCurve, lastError, refreshSnapshot };
}

export function isCriticalEvent(evt: BotEvent): boolean {
  return evt.type === "system.halted" || evt.type === "margin.warning";
}
