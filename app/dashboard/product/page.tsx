"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { OperatorHeader } from "@/components/OperatorHeader";

type ProductStatus = "READY" | "WATCH" | "BLOCKED";
type ModuleStatus = "HEALTHY" | "WATCH" | "NEEDS_ATTENTION" | "TODO";

type ProductIntelligence = {
  generatedAt: string;
  windowDays: number;
  readiness: ProductStatus;
  goLiveBlockers: string[];
  executionIntegrity: {
    score: number;
    copyEvents: number;
    failedEvents: number;
    skippedEvents: number;
    repairedCloseCandidates: number;
    unresolvedTradeGroups: Array<{
      leaderTradeId: string;
      symbol: string;
      opens: number;
      closes: number;
      failed: number;
      skipped: number;
      lastStatus: string;
      lastDetail: string | null;
    }>;
  };
  followerIntelligence: {
    totalFollowers: number;
    activeFollowers: number;
    anxiousFollowers: number;
    healthBands: {
      healthy: number;
      watching: number;
      anxious: number;
      likelyToChurn: number;
    };
    topRetentionRisks: Array<{
      userId: string;
      displayName: string;
      email: string;
      score: number;
      band: string;
      driver: string;
      recommendedAction: string;
      daysUntilRenewal: number | null;
      netPnl30d: number;
    }>;
  };
  tradingIntelligence: {
    leaderTrades: number;
    leaderWinRate: number;
    leaderPnl: number;
    copiedPnl: number;
    symbolQuality: Array<{
      symbol: string;
      trades: number;
      wins: number;
      losses: number;
      pnl: number;
      winRate: number;
    }>;
    exitLeaks: Array<{
      reason: string;
      trades: number;
      pnl: number;
    }>;
  };
  productModules: Array<{
    key: string;
    title: string;
    status: ModuleStatus;
    nextAction: string;
  }>;
  recentMarketingEvents: Array<{
    id: string;
    type: string;
    title: string;
    metricLabel: string;
    metricValue: string;
    createdAt: string;
  }>;
};

type AuditTimeline = {
  leaderTradeId: string;
  followers: Array<{
    userId: string;
    displayName: string;
    email: string | null;
    action: "OPEN" | "CLOSE";
    symbol: string;
    status: string;
    detail: string | null;
    followerNotional: number | null;
    followerOrderId: string | null;
    realizedPnl: number | null;
    roiPercentage: number | null;
    createdAt: string;
    executedAt: string | null;
  }>;
  events: Array<{
    id: string;
    userId: string;
    displayName: string;
    email: string | null;
    action: "OPEN" | "CLOSE";
    symbol: string;
    type: string;
    status: string | null;
    detail: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
};

type ReconciliationReport = {
  generatedAt: string;
  windowDays: number;
  scannedLogs: number;
  issues: Array<{
    type: string;
    severity: "info" | "watch" | "warning" | "critical";
    leaderTradeId: string;
    userId: string;
    symbol: string;
    action: "OPEN" | "CLOSE";
    status: string;
    detail: string | null;
    recommendation: string;
    createdAt: string;
  }>;
  summary: Record<string, number>;
  automatedActions: Array<{
    issue: string;
    leaderTradeId: string;
    userId: string;
    outcome: string;
    detail: string;
  }>;
};

type SelectedLifecycleGroup =
  ProductIntelligence["executionIntegrity"]["unresolvedTradeGroups"][number];
type SelectedAuditTarget =
  | { source: "issue"; issue: ReconciliationReport["issues"][number] }
  | { source: "lifecycle"; group: SelectedLifecycleGroup }
  | null;

function fmtUsd(value: number) {
  const sign = value < 0 ? "-" : value > 0 ? "+" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function statusColor(status: ProductStatus | ModuleStatus | string) {
  if (status === "READY" || status === "HEALTHY") return "var(--long)";
  if (status === "WATCH" || status === "TODO") return "var(--warn)";
  return "var(--short)";
}

function Metric({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="panel p-4 min-h-[92px]">
      <span className="eyebrow">{label}</span>
      <p
        className="font-display text-2xl font-semibold tabular mt-1"
        style={{ color: color ?? "var(--text)" }}
      >
        {value}
      </p>
      {sub && <p className="font-mono text-[11px] text-[var(--muted)] mt-1">{sub}</p>}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const color = statusColor(status);
  return (
    <span
      className="inline-flex items-center border px-2 py-0.5 font-mono text-[10px] font-semibold"
      style={{ color, borderColor: color }}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function ProductIntelligencePage() {
  const [data, setData] = useState<ProductIntelligence | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(30);
  const [audit, setAudit] = useState<AuditTimeline | null>(null);
  const [auditLoading, setAuditLoading] = useState<string | null>(null);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationReport | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [reconError, setReconError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedAuditTarget, setSelectedAuditTarget] = useState<SelectedAuditTarget>(null);
  const auditSectionRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch(`/api/operator/product-intelligence?days=${days}`, { cache: "no-store" }),
      fetch(`/api/operator/copy-trade-reconciliation?days=${Math.min(days, 90)}`, { cache: "no-store" }),
    ])
      .then(async ([productRes, reconRes]) => {
        const productBody = await productRes.json().catch(() => null);
        if (!productRes.ok) throw new Error(productBody?.error ?? "Could not load product intelligence.");

        const reconBody = await reconRes.json().catch(() => null);
        if (!reconRes.ok) throw new Error(reconBody?.error ?? "Could not load reconciliation report.");

        setData(productBody as ProductIntelligence);
        setReconciliation(reconBody as ReconciliationReport);
        setError(null);
        setReconError(null);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days]);

  async function runReconciliationRepairs() {
    setReconLoading(true);
    setReconError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/operator/copy-trade-reconciliation?days=${Math.min(days, 90)}`, {
        method: "POST",
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not run reconciliation.");
      const report = body as ReconciliationReport;
      setReconciliation(report);
      const closed = report.automatedActions.filter((action) => action.outcome === "marked_closed").length;
      const failed = report.automatedActions.filter((action) => action.outcome === "marked_failed").length;
      const audited = report.automatedActions.filter((action) => action.outcome === "audit_recorded").length;
      const repairs = closed + failed;
      setNotice(
        repairs > 0
          ? `Safe repairs applied: ${closed} already-flat close(s) marked resolved, ${failed} stale open claim(s) marked failed. ${audited} issue(s) were audit-marked for manual review.`
          : audited > 0
          ? `No safe data repairs were applied. ${audited} issue(s) were audit-marked for manual review because changing them automatically could invent fills or PnL.`
          : "Reconciliation ran. No safe automatic repairs were available for the current issues."
      );
      load();
    } catch (err) {
      setReconError(err instanceof Error ? err.message : "Could not run reconciliation.");
    } finally {
      setReconLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [load]);

  const readinessIcon = useMemo(() => {
    if (!data) return null;
    return data.readiness === "READY" ? (
      <CheckCircle2 size={18} color="var(--long)" />
    ) : (
      <AlertTriangle size={18} color={statusColor(data.readiness)} />
    );
  }, [data]);

  async function inspectTrade(leaderTradeId: string, target: SelectedAuditTarget = null) {
    setSelectedAuditTarget(target);
    setAuditLoading(leaderTradeId);
    setAuditError(null);
    try {
      const res = await fetch(
        `/api/operator/copy-trade-audit?leaderTradeId=${encodeURIComponent(leaderTradeId)}`,
        { cache: "no-store" }
      );
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? "Could not load audit timeline.");
      setAudit(body as AuditTimeline);
      setTimeout(() => {
        auditSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    } catch (err) {
      setAuditError(err instanceof Error ? err.message : "Could not load audit timeline.");
    } finally {
      setAuditLoading(null);
    }
  }

  return (
    <main className="min-h-screen flex flex-col">
      <OperatorHeader
        status={
          <button
            onClick={() => load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 text-xs font-mono text-[var(--muted)] hover:text-[var(--text)] border border-[var(--hairline-bright)] px-3 py-1.5 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        }
      />

      <div className="flex-1 p-6">
        <div className="max-w-[1400px] mx-auto space-y-6">
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
            <div>
              <span className="eyebrow">Product intelligence</span>
              <h1 className="font-display text-3xl font-semibold mt-1">
                Growth, trust, and execution control
              </h1>
              <p className="text-sm text-[var(--muted)] mt-2 max-w-3xl">
                A single operator view for the expansion work: execution integrity,
                follower fidelity, retention risk, symbol quality, and go-live readiness.
              </p>
            </div>
            <div className="inline-flex panel p-1 self-start">
              {[7, 30, 90].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDays(option)}
                  className="px-3 py-1.5 font-mono text-xs"
                  style={{
                    background: days === option ? "var(--panel-raised)" : "transparent",
                    color: days === option ? "var(--text)" : "var(--muted)",
                  }}
                >
                  {option}d
                </button>
              ))}
            </div>
          </div>

          {error && (
            <div className="text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
              {error}
            </div>
          )}

          {reconError && (
            <div className="text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
              {reconError}
            </div>
          )}

          {notice && (
            <div className="text-sm text-[var(--long)] font-mono border border-[var(--long-dim)] bg-[var(--long-dim)]/10 px-3 py-2">
              {notice}
            </div>
          )}

          {loading && !data ? (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="h-28 panel animate-pulse" />
              ))}
            </div>
          ) : data ? (
            <>
              <section className="panel">
                <div className="p-5 border-b border-[var(--hairline)] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                  <div className="flex items-start gap-3">
                    {readinessIcon}
                    <div>
                      <span className="eyebrow">Go-live readiness</span>
                      <h2
                        className="font-display text-2xl font-semibold mt-1"
                        style={{ color: statusColor(data.readiness) }}
                      >
                        {data.readiness}
                      </h2>
                    </div>
                  </div>
                  <span className="font-mono text-xs text-[var(--muted)]">
                    Generated {new Date(data.generatedAt).toLocaleString()}
                  </span>
                </div>
                <div className="p-5 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-px bg-[var(--hairline)]">
                  <Metric
                    label="Execution integrity"
                    value={`${data.executionIntegrity.score}/100`}
                    sub={`${data.executionIntegrity.failedEvents} failed, ${data.executionIntegrity.skippedEvents} skipped`}
                    color={statusColor(data.executionIntegrity.score >= 85 ? "READY" : "BLOCKED")}
                  />
                  <Metric
                    label="Leader performance"
                    value={fmtUsd(data.tradingIntelligence.leaderPnl)}
                    sub={`${data.tradingIntelligence.leaderTrades} trades, ${fmtPct(data.tradingIntelligence.leaderWinRate)} win rate`}
                    color={data.tradingIntelligence.leaderPnl >= 0 ? "var(--long)" : "var(--short)"}
                  />
                  <Metric
                    label="Copied PnL"
                    value={fmtUsd(data.tradingIntelligence.copiedPnl)}
                    sub={`${data.executionIntegrity.copyEvents} copy events`}
                    color={data.tradingIntelligence.copiedPnl >= 0 ? "var(--long)" : "var(--short)"}
                  />
                  <Metric
                    label="Follower risk"
                    value={`${data.followerIntelligence.anxiousFollowers}`}
                    sub={`${data.followerIntelligence.activeFollowers}/${data.followerIntelligence.totalFollowers} copying`}
                    color={data.followerIntelligence.anxiousFollowers > 0 ? "var(--warn)" : "var(--long)"}
                  />
                </div>
                <div className="p-5">
                  {data.goLiveBlockers.length === 0 ? (
                    <p className="font-mono text-sm text-[var(--long)]">
                      No current go-live blockers detected for this window.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {data.goLiveBlockers.map((blocker) => (
                        <div key={blocker} className="flex gap-2 text-sm text-[var(--muted-dim)]">
                          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[var(--warn)]" />
                          <span>{blocker}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <div className="panel">
                  <div className="p-4 border-b border-[var(--hairline)]">
                    <span className="eyebrow">Execution lifecycle gaps</span>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs font-mono">
                      <thead className="text-[10px] text-[var(--muted)] uppercase">
                        <tr>
                          <th className="px-4 py-2">Symbol</th>
                          <th className="px-4 py-2 text-right">Open</th>
                          <th className="px-4 py-2 text-right">Close</th>
                          <th className="px-4 py-2 text-right">Failed</th>
                          <th className="px-4 py-2">Last</th>
                          <th className="px-4 py-2 text-right">Audit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.executionIntegrity.unresolvedTradeGroups.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="px-4 py-6 text-center text-[var(--muted)]">
                              No unresolved lifecycle groups.
                            </td>
                          </tr>
                        ) : (
                          data.executionIntegrity.unresolvedTradeGroups.map((group) => (
                            <tr key={group.leaderTradeId} className="border-t border-[var(--hairline)]">
                              <td className="px-4 py-2 font-semibold text-[var(--text)]">{group.symbol}</td>
                              <td className="px-4 py-2 text-right tabular">{group.opens}</td>
                              <td className="px-4 py-2 text-right tabular">{group.closes}</td>
                              <td className="px-4 py-2 text-right tabular text-[var(--short)]">{group.failed}</td>
                              <td className="px-4 py-2 text-[var(--muted)] max-w-[220px] truncate">
                                {group.lastDetail ?? group.lastStatus}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <button
                                  type="button"
                                  onClick={() => void inspectTrade(group.leaderTradeId, { source: "lifecycle", group })}
                                  disabled={auditLoading === group.leaderTradeId}
                                  className="font-mono text-[10px] border border-[var(--hairline-bright)] px-2 py-1 text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--long-dim)] disabled:opacity-50"
                                >
                                  {auditLoading === group.leaderTradeId ? "Loading" : "Inspect"}
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="panel">
                  <div className="p-4 border-b border-[var(--hairline)]">
                    <span className="eyebrow">Expansion modules</span>
                  </div>
                  <div className="divide-y divide-[var(--hairline)]">
                    {data.productModules.map((module) => (
                      <div key={module.key} className="p-4 flex items-start justify-between gap-4">
                        <div>
                          <h3 className="font-display font-semibold">{module.title}</h3>
                          <p className="text-xs text-[var(--muted)] mt-1 leading-relaxed">
                            {module.nextAction}
                          </p>
                        </div>
                        <StatusPill status={module.status} />
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              {(audit || auditError) && (
                <section ref={auditSectionRef} className="panel scroll-mt-6">
                  <AuditTimelinePanel
                    audit={audit}
                    auditError={auditError}
                    selectedTarget={selectedAuditTarget}
                    onClose={() => {
                      setAudit(null);
                      setAuditError(null);
                      setSelectedAuditTarget(null);
                    }}
                  />
                </section>
              )}

              <section className="panel">
                <div className="p-5 border-b border-[var(--hairline)] flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                  <div>
                    <span className="eyebrow">Automated reconciliation</span>
                    <h2 className="font-display text-xl font-semibold mt-1">
                      Copy-trade repair scanner
                    </h2>
                    <p className="text-sm text-[var(--muted)] mt-1">
                      Detects stale processing claims, failed closes, missing close logs,
                      and mismatched follower lifecycle rows.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void runReconciliationRepairs()}
                    disabled={reconLoading}
                    className="inline-flex items-center justify-center gap-2 border border-[var(--warn)] text-[var(--warn)] font-mono text-xs px-3 py-2 hover:text-[var(--text)] disabled:opacity-50"
                  >
                    {reconLoading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                    {reconLoading ? "Reconciling..." : "Run safe repairs"}
                  </button>
                </div>
                <div className="px-5 py-3 border-b border-[var(--hairline)] bg-[var(--panel-raised)]/45">
                  <p className="font-mono text-[11px] text-[var(--muted)] leading-relaxed">
                    Safe repairs only resolve already-flat failed closes and stale open claims.
                    Other execution failures are audit-marked for manual review so the app
                    does not invent fills or PnL.
                  </p>
                </div>
                {notice && (
                  <div className="mx-5 mt-5 text-sm text-[var(--long)] font-mono border border-[var(--long-dim)] bg-[var(--long-dim)]/10 px-3 py-2">
                    {notice}
                  </div>
                )}
                {reconciliation ? (
                  <div className="p-5 space-y-5">
                    <div className="grid grid-cols-2 lg:grid-cols-6 gap-px bg-[var(--hairline)]">
                      <Metric
                        label="Scanned logs"
                        value={String(reconciliation.scannedLogs)}
                        sub={`${reconciliation.windowDays}d window`}
                      />
                      <Metric
                        label="Stale"
                        value={String(reconciliation.summary.stale_processing ?? 0)}
                        color={(reconciliation.summary.stale_processing ?? 0) > 0 ? "var(--short)" : "var(--long)"}
                      />
                      <Metric
                        label="Retryable closes"
                        value={String(reconciliation.summary.failed_close_retryable ?? 0)}
                        color={(reconciliation.summary.failed_close_retryable ?? 0) > 0 ? "var(--warn)" : "var(--long)"}
                      />
                      <Metric
                        label="Missing closes"
                        value={String(reconciliation.summary.open_without_close ?? 0)}
                        color={(reconciliation.summary.open_without_close ?? 0) > 0 ? "var(--warn)" : "var(--long)"}
                      />
                      <Metric
                        label="Repair actions"
                        value={String(
                          reconciliation.automatedActions.filter((action) =>
                            action.outcome === "marked_closed" || action.outcome === "marked_failed"
                          ).length
                        )}
                        color={
                          reconciliation.automatedActions.some((action) =>
                            action.outcome === "marked_closed" || action.outcome === "marked_failed"
                          )
                            ? "var(--warn)"
                            : "var(--muted)"
                        }
                      />
                      <Metric
                        label="Audit markers"
                        value={String(
                          reconciliation.automatedActions.filter((action) => action.outcome === "audit_recorded").length
                        )}
                        color={
                          reconciliation.automatedActions.some((action) => action.outcome === "audit_recorded")
                            ? "var(--warn)"
                            : "var(--muted)"
                        }
                      />
                    </div>

                    {reconciliation.issues.length === 0 ? (
                      <p className="font-mono text-sm text-[var(--long)]">
                        No reconciliation issues detected in this window.
                      </p>
                    ) : (
                      <div className="overflow-x-auto border border-[var(--hairline)]">
                        <table className="w-full text-left text-xs font-mono">
                          <thead className="text-[10px] uppercase text-[var(--muted)] bg-[var(--panel-raised)]">
                            <tr>
                              <th className="px-4 py-2">Issue</th>
                              <th className="px-4 py-2">Symbol</th>
                              <th className="px-4 py-2">Action</th>
                              <th className="px-4 py-2">Status</th>
                              <th className="px-4 py-2">Recommendation</th>
                              <th className="px-4 py-2 text-right">Audit</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reconciliation.issues.slice(0, 12).map((issue) => (
                              <tr key={`${issue.type}-${issue.userId}-${issue.leaderTradeId}-${issue.action}`} className="border-t border-[var(--hairline)]">
                                <td className="px-4 py-2">
                                  <StatusPill status={issue.severity.toUpperCase()} />
                                  <div className="mt-1 text-[var(--muted)]">{issue.type.replace(/_/g, " ")}</div>
                                </td>
                                <td className="px-4 py-2 font-semibold text-[var(--text)]">{issue.symbol}</td>
                                <td className="px-4 py-2">{issue.action}</td>
                                <td className="px-4 py-2">{issue.status}</td>
                                <td className="px-4 py-2 text-[var(--muted-dim)] max-w-[360px]">
                                  {issue.recommendation}
                                </td>
                                <td className="px-4 py-2 text-right">
                                  <button
                                    type="button"
                                    onClick={() => void inspectTrade(issue.leaderTradeId, { source: "issue", issue })}
                                    disabled={auditLoading === issue.leaderTradeId}
                                    className="font-mono text-[10px] border border-[var(--hairline-bright)] px-2 py-1 text-[var(--muted)] hover:text-[var(--text)] hover:border-[var(--long-dim)] disabled:opacity-50"
                                  >
                                    {auditLoading === issue.leaderTradeId ? "Loading" : "Inspect"}
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="p-5">
                    <div className="h-24 bg-[var(--panel-raised)] animate-pulse" />
                  </div>
                )}
              </section>

              <section className="grid grid-cols-1 xl:grid-cols-3 gap-6">
                <DataTable
                  title="Weakest symbols"
                  empty="No symbol data in this window."
                  rows={data.tradingIntelligence.symbolQuality.map((row) => ({
                    key: row.symbol,
                    metric: `${row.trades} trades`,
                    value: fmtUsd(row.pnl),
                    color: row.pnl >= 0 ? "var(--long)" : "var(--short)",
                    detail: `${fmtPct(row.winRate)} win`,
                  }))}
                />
                <DataTable
                  title="Exit leaks"
                  empty="No exit leak data."
                  rows={data.tradingIntelligence.exitLeaks.map((row) => ({
                    key: row.reason.replace(/_/g, " "),
                    metric: `${row.trades} trades`,
                    value: fmtUsd(row.pnl),
                    color: row.pnl >= 0 ? "var(--long)" : "var(--short)",
                  }))}
                />
                <DataTable
                  title="Retention risks"
                  empty="No anxious followers."
                  rows={data.followerIntelligence.topRetentionRisks.map((row) => ({
                    key: row.displayName,
                    metric: `${row.score}/100`,
                    value: fmtUsd(row.netPnl30d),
                    color: row.netPnl30d >= 0 ? "var(--long)" : "var(--short)",
                    detail: row.driver,
                  }))}
                />
              </section>

              <section className="panel p-5">
                <span className="eyebrow">Public proof pipeline</span>
                {data.recentMarketingEvents.length === 0 ? (
                  <p className="text-sm text-[var(--muted)] mt-3">
                    No recent marketing proof events. Create one from verified results,
                    risk-guard incidents, or crisis-averted moments.
                  </p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mt-4">
                    {data.recentMarketingEvents.map((event) => (
                      <div key={event.id} className="border border-[var(--hairline)] bg-[var(--panel-raised)] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="eyebrow">{event.type.replace(/_/g, " ")}</span>
                          <span className="font-mono text-[10px] text-[var(--muted)]">
                            {new Date(event.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                        <h3 className="font-display font-semibold mt-2">{event.title}</h3>
                        <p className="font-mono text-xs text-[var(--long)] mt-2">
                          {event.metricLabel}: {event.metricValue}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </section>

            </>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function DataTable({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: Array<{ key: string; metric: string; value: string; color: string; detail?: string }>;
  empty: string;
}) {
  return (
    <div className="panel">
      <div className="p-4 border-b border-[var(--hairline)]">
        <span className="eyebrow">{title}</span>
      </div>
      <div className="divide-y divide-[var(--hairline)]">
        {rows.length === 0 ? (
          <p className="font-mono text-xs text-[var(--muted)] p-4">{empty}</p>
        ) : (
          rows.slice(0, 8).map((row) => (
            <div key={`${row.key}-${row.metric}`} className="p-4 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-display font-semibold truncate">{row.key}</p>
                <p className="font-mono text-[11px] text-[var(--muted)] mt-1">{row.metric}</p>
                {row.detail && (
                  <p className="text-xs text-[var(--muted-dim)] mt-2 line-clamp-2">{row.detail}</p>
                )}
              </div>
              <span className="font-mono text-sm font-semibold tabular" style={{ color: row.color }}>
                {row.value}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function AuditTimelinePanel({
  audit,
  auditError,
  selectedTarget,
  onClose,
}: {
  audit: AuditTimeline | null;
  auditError: string | null;
  selectedTarget: SelectedAuditTarget;
  onClose: () => void;
}) {
  const selectedLabel =
    selectedTarget?.source === "issue"
      ? `${selectedTarget.issue.symbol} ${selectedTarget.issue.action} • ${selectedTarget.issue.type.replace(/_/g, " ")}`
      : selectedTarget?.source === "lifecycle"
      ? `${selectedTarget.group.symbol} • lifecycle gap • ${selectedTarget.group.lastDetail ?? selectedTarget.group.lastStatus}`
      : null;
  const followerRows = audit
    ? [...audit.followers].sort((a, b) => (
        new Date(b.executedAt ?? b.createdAt).getTime() -
        new Date(a.executedAt ?? a.createdAt).getTime()
      ))
    : [];
  const eventRows = audit
    ? [...audit.events].sort((a, b) => (
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      ))
    : [];

  return (
    <div>
      <div className="p-5 border-b border-[var(--hairline)] flex items-start justify-between gap-4">
        <div>
          <span className="eyebrow">Trade audit timeline</span>
          <h3 className="font-display text-xl font-semibold mt-1">
            {audit?.leaderTradeId ?? "Audit unavailable"}
          </h3>
          {selectedLabel && (
            <p className="font-mono text-xs text-[var(--warn)] mt-2">
              Opened from: {selectedLabel}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="font-mono text-xs text-[var(--muted)] hover:text-[var(--text)]"
        >
          Close
        </button>
      </div>
      {auditError ? (
        <p className="m-4 text-sm text-[var(--short)] font-mono border border-[var(--short-dim)] bg-[var(--short-dim)]/10 px-3 py-2">
          {auditError}
        </p>
      ) : audit ? (
        <div className="grid grid-cols-1 xl:grid-cols-[1fr_1.2fr] gap-0">
          <div className="p-5 border-b xl:border-b-0 xl:border-r border-[var(--hairline)]">
            <span className="eyebrow">Follower outcomes</span>
            <div className="mt-3 space-y-3 max-h-[420px] overflow-y-auto">
              {audit.followers.length === 0 ? (
                <p className="text-xs font-mono text-[var(--muted)]">No follower log rows found.</p>
              ) : (
                followerRows.map((row) => (
                  <div
                    key={`${row.userId}-${row.action}-${row.createdAt}`}
                    className="border border-[var(--hairline)] bg-[var(--panel-raised)] p-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-display font-semibold">{row.displayName}</p>
                        <p className="font-mono text-[10px] text-[var(--muted)]">
                          {row.action} • {row.symbol}
                        </p>
                      </div>
                      <StatusPill status={row.status.toUpperCase()} />
                    </div>
                    <p className="font-mono text-[11px] text-[var(--muted-dim)] mt-2">
                      {row.detail ?? "No detail recorded."}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
          <div className="p-5">
            <span className="eyebrow">Event trail</span>
            <div className="mt-3 space-y-2 max-h-[420px] overflow-y-auto">
              {audit.events.length === 0 ? (
                <p className="text-xs font-mono text-[var(--muted)]">
                  No audit events recorded yet. New copy-trade events will populate this trail.
                </p>
              ) : (
                eventRows.map((event) => (
                  <div
                    key={event.id}
                    className="grid grid-cols-[88px_1fr] gap-3 border-l border-[var(--hairline-bright)] pl-3 py-2"
                  >
                    <span className="font-mono text-[10px] text-[var(--muted)]">
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </span>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[var(--text)]">
                          {event.type}
                        </span>
                        {event.status && <StatusPill status={event.status.toUpperCase()} />}
                      </div>
                      <p className="text-xs text-[var(--muted-dim)] mt-1">
                        {event.displayName}: {event.detail ?? "No detail."}
                      </p>
                      {event.type === "legacy.copy_trade_log" && (
                        <p className="text-[10px] font-mono text-[var(--warn)] mt-1">
                          Reconstructed from legacy copy-trade log.
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
