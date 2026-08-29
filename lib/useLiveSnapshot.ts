"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { BotEvent, DashboardSnapshot, EquityPoint } from "./types";
import { wsUrlFrom, type Session } from "./session";
import { fetchSnapshot } from "./api";

export type ConnState = "connecting" | "live" | "reconnecting" | "offline";

const MAX_EQUITY_POINTS = 200;

export function useLiveSnapshot(session: Session | null) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [connState, setConnState] = useState<ConnState>("connecting");
  const [equityCurve, setEquityCurve] = useState<EquityPoint[]>([]);
  const [lastError, setLastError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryDelay = useRef(1500);
  const mounted = useRef(true);

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
      const snap = await fetchSnapshot(session);
      if (mounted.current) applySnapshot(snap);
    } catch (err: any) {
      if (mounted.current) setLastError(err.message ?? "Failed to refresh snapshot");
    }
  }, [session, applySnapshot]);

  useEffect(() => {
    mounted.current = true;
    if (!session) return;

    let cancelledInitial = false;

    // Initial REST fetch so the UI isn't empty while the socket connects.
    fetchSnapshot(session)
      .then((snap) => {
        if (!cancelledInitial && mounted.current) applySnapshot(snap);
      })
      .catch((err) => {
        if (mounted.current) setLastError(err.message ?? "Failed to load snapshot");
      });

    function connect() {
      if (!mounted.current) return;
      setConnState((s) => (s === "live" ? s : "connecting"));

      let ws: WebSocket;
      try {
        const url = wsUrlFrom(session!.baseUrl);
        // Send the API key via the Sec-WebSocket-Protocol handshake
        // instead of a query string, so it doesn't end up in server
        // access logs, proxy logs, or browser history. The bot's
        // server.ts expects a subprotocol of the form
        // "dashboard-key.<API_KEY>" and echoes it back to complete
        // the handshake.
        const protocols = session!.apiKey
          ? [`dashboard-key.${session!.apiKey}`]
          : undefined;
        ws = protocols ? new WebSocket(url, protocols) : new WebSocket(url);
      } catch {
        setConnState("offline");
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (!mounted.current) return;
        setConnState("live");
        retryDelay.current = 1500;
      };

      ws.onmessage = (event) => {
        if (!mounted.current) return;
        try {
          const parsed = JSON.parse(event.data);
          if (parsed?.type === "snapshot.updated" && parsed.payload) {
            applySnapshot(parsed.payload as DashboardSnapshot);
          } else if (parsed?.type) {
            // Other event types (position.opened, system.halted, etc.) —
            // consumers can listen via onBotEvent if needed later.
          }
        } catch {
          // ignore malformed frame
        }
      };

      ws.onclose = () => {
        if (!mounted.current) return;
        setConnState("reconnecting");
        retryTimer.current = setTimeout(() => {
          retryDelay.current = Math.min(retryDelay.current * 1.6, 15000);
          connect();
        }, retryDelay.current);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelledInitial = true;
      mounted.current = false;
      if (retryTimer.current) clearTimeout(retryTimer.current);
      wsRef.current?.close();
    };
  }, [session, applySnapshot]);

  // NEW: Exported refreshSnapshot alongside the other variables
  return { snapshot, connState, equityCurve, lastError, refreshSnapshot };
}

export function isCriticalEvent(evt: BotEvent): boolean {
  return evt.type === "system.halted" || evt.type === "margin.warning";
}