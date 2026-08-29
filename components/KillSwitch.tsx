"use client";

import { useRef, useState, useCallback } from "react";
import { AlertTriangle, Pause, Play } from "lucide-react";
import type { Session } from "@/lib/session";
import { triggerKillSwitch, pauseTrading, resumeTrading } from "@/lib/api";
import type { DashboardSnapshot } from "@/lib/types";
import { getErrorMessage } from "@/lib/errorMessage";

const HOLD_MS = 1400;

interface KillSwitchResponse {
  positionsClosed?: number;
}

export function KillSwitch({
  session,
  snapshot,
  onAfterAction,
}: {
  session: Session;
  snapshot: DashboardSnapshot | null;
  onAfterAction: () => void;
}) {
  const [arming, setArming] = useState(false);
  const [progress, setProgress] = useState(0);
  const [firing, setFiring] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);
  const rafRef = useRef<number | null>(null);
  const startRef = useRef<number>(0);

  const cancelHold = useCallback(() => {
    setArming(false);
    setProgress(0);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const fire = useCallback(async () => {
    setFiring(true);
    setResult(null);
    try {
      const res = await triggerKillSwitch(session) as KillSwitchResponse;
      setResult(
        `Halted. ${res?.positionsClosed ?? 0} position(s) targeted for closure.`
      );
    } catch (err: unknown) {
      setResult(getErrorMessage(err, "Kill switch request failed."));
    } finally {
      setFiring(false);
      cancelHold();
      onAfterAction();
    }
  }, [session, cancelHold, onAfterAction]);

  const startHold = useCallback(() => {
    if (firing) return;
    setArming(true);
    startRef.current = performance.now();

    const tick = (now: number) => {
      const elapsed = now - startRef.current;
      const pct = Math.min(1, elapsed / HOLD_MS);
      setProgress(pct);
      if (pct >= 1) {
        void fire();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [firing, fire]);

  const halted = snapshot?.systemStatus === "HALTED";
  const paused = snapshot?.systemStatus === "PAUSED";

async function handleToggleStatus() {
    setPauseBusy(true);
    setResult(null);
    try {
      if (paused || halted) {
        await resumeTrading(session);
        setResult("Trading resumed.");
      } else {
        if(paused ) {
        await pauseTrading(session);
        setResult("Trading paused.");
      }else{
        await pauseTrading(session);
        setResult("Trading halted.");
      }

      }
    } catch (err: unknown) {
      setResult(getErrorMessage(err, "Request failed."));
    } finally {
      setPauseBusy(false);
      onAfterAction();
    }
  }

  return (
    <div className="panel p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Emergency Control</span>
        {!firing && halted && (
          <span className="font-mono text-[10px] text-[var(--kill-bright)] font-semibold">
            SYSTEM HALTED
          </span>
        )}
      </div>

      {/* Kill switch — physical, recessed, hold-to-arm */}
      <button
        type="button"
        onPointerDown={startHold}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        disabled={firing || halted}
        className="relative w-full aspect-[3/1.2] select-none overflow-hidden
                   border-2 transition-colors duration-150 disabled:cursor-not-allowed"
        style={{
          borderColor: arming ? "var(--kill-bright)" : "var(--short-dim)",
          background: "linear-gradient(180deg, #1a0d10 0%, #12080a 100%)",
        }}
      >
        {/* fill progress */}
        <div
          className="absolute inset-y-0 left-0"
          style={{
            width: `${progress * 100}%`,
            background:
              "linear-gradient(90deg, var(--kill) 0%, var(--kill-bright) 100%)",
            transition: arming ? "none" : "width 150ms ease-out",
          }}
        />
        <div className="relative z-10 h-full flex flex-col items-center justify-center gap-1">
          <AlertTriangle
            size={20}
            strokeWidth={2.2}
            // Dim the icon to a muted color when idle, bright red when halted, white when arming
            color={arming ? "#fff" : halted ? "var(--kill-bright)" : "var(--muted)"}
          />
          <span
            className="font-display font-bold text-sm tracking-wide"
            // Dim the text slightly when idle so it doesn't look like an active alert
            style={{ color: arming ? "#fff" : halted ? "var(--kill-bright)" : "var(--muted)" }}
          >
            {firing
              ? "TRIGGERING…"
              : halted
                ? "TRADING HALTED"
                : arming
                  ? "HOLD TO CONFIRM"
                  : "HOLD FOR KILL SWITCH"}
          </span>
          <span className="font-mono text-[10px] text-[var(--muted)]">
            {halted
              ? "resume from pause controls below"
              : "flattens all positions · cancels all orders"}
          </span>
        </div>
      </button>

      {/* Pause / resume — softer, secondary control */}
      {!firing &&
      <button
        type="button"
        onClick={handleToggleStatus}
        disabled={pauseBusy}
        className="flex items-center justify-center gap-2 border border-[var(--hairline-bright)]
                   py-2.5 text-sm font-medium hover:border-[var(--warn)] hover:text-[var(--warn)]
                   transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
      >
        {paused || halted ? <Play size={15} /> : <Pause size={15} />}
        {pauseBusy ? "Working…" : firing ? "Working...": (paused || halted ) ? "Resume trading" : "Pause trading"}
      </button>
      }

      {result && (
        <p className="font-mono text-xs text-[var(--muted)] leading-relaxed border-t border-[var(--hairline)] pt-3">
          {result}
        </p>
      )}
    </div>
  );
}
