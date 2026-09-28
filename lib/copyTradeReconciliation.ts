import { ObjectId, type Db, type Document } from "mongodb";
import { checkFollowerFlatViaBot } from "@/lib/followerFlatCheck";
import { getBotDb, getSaasDb } from "@/lib/saasDb";
import type { CopyTradeAuditEventDoc, CopyTradeLogDoc } from "@/lib/saasTypes";

const STALE_PROCESSING_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const BOT_TRADES_COLLECTION = "futures_history";

export type ReconciliationIssueType =
  | "stale_processing"
  | "failed_close_retryable"
  | "open_without_close"
  | "close_without_open"
  | "failed_execution";

export interface ReconciliationIssue {
  type: ReconciliationIssueType;
  severity: "info" | "watch" | "warning" | "critical";
  leaderTradeId: string;
  userId: string;
  symbol: string;
  action: "OPEN" | "CLOSE";
  status: string;
  detail: string | null;
  recommendation: string;
  createdAt: string;
}

export interface CopyTradeReconciliationReport {
  generatedAt: string;
  windowDays: number;
  scannedLogs: number;
  issues: ReconciliationIssue[];
  summary: Record<ReconciliationIssueType, number>;
  automatedActions: Array<{
    issue: ReconciliationIssueType;
    leaderTradeId: string;
    userId: string;
    outcome: "marked_failed" | "marked_closed" | "audit_recorded" | "skipped";
    detail: string;
  }>;
}

function isAlreadyFlatDetail(detail: string | null | undefined): boolean {
  if (!detail) return false;
  const lower = detail.toLowerCase();
  return (
    lower.includes("already flat") ||
    lower.includes("already closed") ||
    lower.includes("no matching follower position is open")
  );
}

function isResolvedStaleOpenDetail(detail: string | null | undefined): boolean {
  return !!detail?.toLowerCase().includes("reconciliation marked this stale open claim as failed");
}

function userIdString(log: Pick<CopyTradeLogDoc, "userId">): string | null {
  return log.userId instanceof ObjectId ? log.userId.toString() : null;
}

function safeDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function sameUserId(a: unknown, b: unknown): boolean {
  return a instanceof ObjectId && b instanceof ObjectId && a.equals(b);
}

function readLeaderTradeKeys(doc: Document): string[] {
  return [doc._id?.toString(), doc.tradeId, doc.leaderTradeId, doc.id]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

async function loadClosedLeaderTradeIds(tradeIds: string[], since: Date): Promise<Set<string>> {
  if (tradeIds.length === 0) return new Set();
  const botDb = await getBotDb().catch(() => null);
  if (!botDb) return new Set();
  const objectTradeIds = tradeIds
    .filter((id) => ObjectId.isValid(id))
    .map((id) => new ObjectId(id));

  const docs = await botDb
    .collection<Document>(BOT_TRADES_COLLECTION)
    .find({
      status: { $in: ["CLOSED", "closed"] },
      $or: [
        { tradeId: { $in: tradeIds } },
        { leaderTradeId: { $in: tradeIds } },
        { id: { $in: tradeIds } },
        ...(objectTradeIds.length > 0 ? [{ _id: { $in: objectTradeIds } }] : []),
        { closedAt: { $gte: since } },
        { exitTime: { $gte: since } },
      ],
    })
    .limit(1000)
    .toArray()
    .catch(() => []);

  const closed = new Set<string>();
  for (const doc of docs) {
    for (const key of readLeaderTradeKeys(doc)) {
      if (tradeIds.includes(key)) closed.add(key);
    }
  }
  return closed;
}

function makeIssue(
  type: ReconciliationIssueType,
  log: CopyTradeLogDoc,
  recommendation: string,
  severity: ReconciliationIssue["severity"] = "warning"
): ReconciliationIssue {
  const createdAt = safeDate(log.createdAt) ?? new Date();
  return {
    type,
    severity,
    leaderTradeId: log.leaderTradeId || "unknown",
    userId: userIdString(log) ?? "unknown",
    symbol: log.leaderSymbol || "UNKNOWN",
    action: log.action === "CLOSE" ? "CLOSE" : "OPEN",
    status: log.status || "unknown",
    detail: log.detail,
    recommendation,
    createdAt: createdAt.toISOString(),
  };
}

async function writeAudit(
  db: Db,
  log: CopyTradeLogDoc,
  type: CopyTradeAuditEventDoc["type"],
  detail: string,
  metadata?: Record<string, unknown>
) {
  if (!(log.userId instanceof ObjectId)) return;
  await db
    .collection<CopyTradeAuditEventDoc>("copy_trade_audit_events")
    .insertOne({
      userId: log.userId,
      leaderTradeId: log.leaderTradeId,
      action: log.action,
      leaderSymbol: log.leaderSymbol,
      type,
      status: log.status,
      detail,
      metadata,
      createdAt: new Date(),
    })
    .catch(() => undefined);
}

async function writeAuditOnce(
  db: Db,
  log: CopyTradeLogDoc,
  type: CopyTradeAuditEventDoc["type"],
  detail: string,
  metadata: Record<string, unknown>
): Promise<boolean> {
  if (!(log.userId instanceof ObjectId)) return false;
  const result = await db
    .collection<CopyTradeAuditEventDoc>("copy_trade_audit_events")
    .updateOne(
      {
        userId: log.userId,
        leaderTradeId: log.leaderTradeId,
        action: log.action,
        leaderSymbol: log.leaderSymbol,
        type,
        "metadata.issueType": metadata.issueType,
      },
      {
        $setOnInsert: {
          userId: log.userId,
          leaderTradeId: log.leaderTradeId,
          action: log.action,
          leaderSymbol: log.leaderSymbol,
          type,
          status: log.status,
          detail,
          metadata,
          createdAt: new Date(),
        },
      },
      { upsert: true }
    )
    .catch(() => null);

  return !!result?.upsertedCount;
}

/**
 * Max exchange checks per reconciliation run. Each one is a round trip
 * through the bot to Binance; an unbounded loop over a big backlog could
 * outlive a serverless cron invocation. Whatever isn't reached this run is
 * picked up on the next one.
 */
const MAX_FLAT_CHECKS_PER_RUN = 10;

export async function runCopyTradeReconciliation(options?: {
  days?: number;
  applyRepairs?: boolean;
}): Promise<CopyTradeReconciliationReport> {
  const db = await getSaasDb();
  const days = Math.max(1, Math.min(options?.days ?? 7, 90));
  const applyRepairs = options?.applyRepairs ?? false;
  const since = new Date(Date.now() - days * DAY_MS);
  const now = new Date();

  const logs = await db
    .collection<CopyTradeLogDoc>("copy_trade_log")
    .find({ createdAt: { $gte: since } })
    .sort({ createdAt: -1 })
    .limit(1000)
    .toArray();

  const validLogs = logs.filter((log) => (
    log.userId instanceof ObjectId &&
    typeof log.leaderTradeId === "string" &&
    log.leaderTradeId.trim() &&
    (log.action === "OPEN" || log.action === "CLOSE")
  ));

  const byUserAndTrade = new Map<string, CopyTradeLogDoc[]>();
  const leaderTradeIds = Array.from(
    new Set(validLogs.map((log) => log.leaderTradeId).filter(Boolean))
  );
  const closedLeaderTradeIds = await loadClosedLeaderTradeIds(leaderTradeIds, since);
  const closeLogsNeedingOpenCheck = validLogs.filter((log) => log.action === "CLOSE");
  const historicalOpenKeys = new Set<string>();
  if (closeLogsNeedingOpenCheck.length > 0) {
    const closeUserIds = Array.from(
      new Set(
        closeLogsNeedingOpenCheck
          .map((log) => log.userId)
          .filter((userId): userId is ObjectId => userId instanceof ObjectId)
          .map((userId) => userId.toString())
      )
    ).map((userId) => new ObjectId(userId));
    const closeLeaderTradeIds = Array.from(
      new Set(closeLogsNeedingOpenCheck.map((log) => log.leaderTradeId))
    );
    const historicalOpens = await db
      .collection<CopyTradeLogDoc>("copy_trade_log")
      .find({
        userId: { $in: closeUserIds },
        leaderTradeId: { $in: closeLeaderTradeIds },
        action: "OPEN",
      })
      .project({ userId: 1, leaderTradeId: 1 })
      .toArray();
    for (const open of historicalOpens) {
      if (open.userId instanceof ObjectId && open.leaderTradeId) {
        historicalOpenKeys.add(`${open.userId.toString()}:${open.leaderTradeId}`);
      }
    }
  }
  for (const log of validLogs) {
    const key = `${log.userId.toString()}:${log.leaderTradeId}`;
    byUserAndTrade.set(key, [...(byUserAndTrade.get(key) ?? []), log]);
  }

  const issues: ReconciliationIssue[] = [];
  const automatedActions: CopyTradeReconciliationReport["automatedActions"] = [];

  for (const log of validLogs) {
    const createdAt = safeDate(log.createdAt);
    if (
      log.status === "processing" &&
      createdAt &&
      createdAt.getTime() < now.getTime() - STALE_PROCESSING_MS
    ) {
      issues.push(
        makeIssue(
          "stale_processing",
          log,
          log.action === "OPEN"
            ? "Mark the stale OPEN as failed and block automatic retry to avoid duplicate follower positions."
            : "Reclaim or retry the stale CLOSE event; close events are safe to retry with idempotency.",
          log.action === "OPEN" ? "critical" : "warning"
        )
      );

      if (applyRepairs && log.action === "OPEN" && log._id) {
        const result = await db.collection<CopyTradeLogDoc>("copy_trade_log").updateOne(
          { _id: log._id, status: "processing" },
          {
            $set: {
              status: "failed",
              detail:
                "Reconciliation marked this stale OPEN claim as failed. Auto-retry is blocked to avoid duplicate follower positions.",
              executedAt: now,
            },
          }
        );
        if (result.modifiedCount > 0) {
          await writeAudit(
            db,
            { ...log, status: "failed" },
            "reconciliation.stale_open_marked_failed",
            "Stale OPEN claim marked failed by reconciliation."
          );
          automatedActions.push({
            issue: "stale_processing",
            leaderTradeId: log.leaderTradeId,
            userId: log.userId.toString(),
            outcome: "marked_failed",
            detail: "Stale OPEN claim marked failed.",
          });
        }
      }
    }

    if (log.status === "failed" && log.action === "CLOSE" && isAlreadyFlatDetail(log.detail)) {
      issues.push(
        makeIssue(
          "failed_close_retryable",
          log,
          "Treat as a repaired close if an exchange check confirms the follower is flat.",
          "watch"
        )
      );
      if (applyRepairs && log._id) {
        const result = await db.collection<CopyTradeLogDoc>("copy_trade_log").updateOne(
          { _id: log._id, status: "failed", action: "CLOSE" },
          {
            $set: {
              status: "closed",
              detail: "Reconciliation marked this close as resolved because the follower was already flat.",
              executedAt: now,
            },
          }
        );
        if (result.modifiedCount > 0) {
          await writeAudit(
            db,
            { ...log, status: "closed" },
            "reconciliation.already_flat_marked_closed",
            "Failed CLOSE row marked closed because the follower was already flat.",
            { previousDetail: log.detail }
          );
          automatedActions.push({
            issue: "failed_close_retryable",
            leaderTradeId: log.leaderTradeId,
            userId: log.userId.toString(),
            outcome: "marked_closed",
            detail: "Failed CLOSE row marked closed because the follower was already flat.",
          });
        }
      }
    } else if (log.status === "failed" && !isResolvedStaleOpenDetail(log.detail)) {
      issues.push(
        makeIssue(
          "failed_execution",
          log,
          "Inspect the follower audit trail and exchange credentials before the next signal.",
          "warning"
        )
      );
    }
  }

  for (const group of byUserAndTrade.values()) {
    const opens = group.filter((log) => log.action === "OPEN");
    const closes = group.filter((log) => log.action === "CLOSE");
    const executedOpen = opens.find((log) => log.status === "executed" || log.status === "processing");
    const closed = closes.find((log) => log.status === "closed" || log.status === "processing");

    if (executedOpen && !closed && closedLeaderTradeIds.has(executedOpen.leaderTradeId)) {
      issues.push(
        makeIssue(
          "open_without_close",
          executedOpen,
          "If the leader trade is closed, send or retry the CLOSE event for this follower.",
          "warning"
        )
      );
    }

    const closeWithoutOpen = closes.find((log) => {
      const hasWindowOpen = opens.some((open) => sameUserId(open.userId, log.userId));
      const hasHistoricalOpen =
        log.userId instanceof ObjectId &&
        historicalOpenKeys.has(`${log.userId.toString()}:${log.leaderTradeId}`);
      return !hasWindowOpen && !hasHistoricalOpen;
    });
    if (closeWithoutOpen) {
      issues.push(
        makeIssue(
          "close_without_open",
          closeWithoutOpen,
          "Check whether this follower skipped the open or the open log was lost before trusting PnL.",
          "watch"
        )
      );
    }
  }

  const uniqueIssues = Array.from(
    new Map(
      issues.map((issue) => [
        `${issue.type}:${issue.userId}:${issue.leaderTradeId}:${issue.action}`,
        issue,
      ])
    ).values()
  );

  const summary = {
    stale_processing: 0,
    failed_close_retryable: 0,
    open_without_close: 0,
    close_without_open: 0,
    failed_execution: 0,
  };
  for (const issue of uniqueIssues) {
    summary[issue.type] += 1;
  }

  if (applyRepairs) {
    for (const issue of uniqueIssues) {
      if (
        issue.type === "failed_close_retryable" ||
        (issue.type === "stale_processing" && issue.action === "OPEN")
      ) {
        continue;
      }
      const log = logs.find(
        (item) =>
          item.userId instanceof ObjectId &&
          ObjectId.isValid(issue.userId) &&
          item.userId.equals(new ObjectId(issue.userId)) &&
          item.leaderTradeId === issue.leaderTradeId &&
          item.action === issue.action
      );
      if (!log) continue;
      const inserted = await writeAuditOnce(db, log, "reconciliation.issue_detected", issue.recommendation, {
        issueType: issue.type,
        severity: issue.severity,
      });
      if (inserted) {
        automatedActions.push({
          issue: issue.type,
          leaderTradeId: issue.leaderTradeId,
          userId: issue.userId,
          outcome: "audit_recorded",
          detail: issue.recommendation,
        });
      }
    }
  }

  // Repair: a copied trade the dashboard still shows as OPEN although the
  // leader's trade is closed. Cause: the follower closed by hand on
  // Binance, or the close event was missed. Only the exchange can say
  // which, so ask it. "flat" -> write a CLOSE row. "open" or "unknown" ->
  // leave everything alone (never guess flat: that would hide a live
  // position from the follower).
  if (applyRepairs) {
    let checksUsed = 0;
    for (const issue of uniqueIssues) {
      if (issue.type !== "open_without_close") continue;
      if (checksUsed >= MAX_FLAT_CHECKS_PER_RUN) break;
      if (!ObjectId.isValid(issue.userId)) continue;

      const openLog = logs.find(
        (item) =>
          item.userId instanceof ObjectId &&
          item.userId.equals(new ObjectId(issue.userId)) &&
          item.leaderTradeId === issue.leaderTradeId &&
          item.action === "OPEN"
      );
      if (!openLog) continue;

      checksUsed += 1;
      const side = openLog.leaderSide === "SHORT" ? "SHORT" : "LONG";
      const flat = await checkFollowerFlatViaBot(issue.userId, openLog.leaderSymbol, side);

      if (flat.state !== "flat") {
        automatedActions.push({
          issue: "open_without_close",
          leaderTradeId: issue.leaderTradeId,
          userId: issue.userId,
          outcome: "skipped",
          detail:
            flat.state === "open"
              ? "Follower still holds a live position; not marked closed."
              : `Could not confirm the follower is flat (${flat.reason}); left unchanged.`,
        });
        continue;
      }

      // Insert-if-absent, keyed on user + trade + CLOSE, so two overlapping
      // runs cannot both write a close row for the same trade.
      const closeRow: CopyTradeLogDoc = {
        userId: openLog.userId,
        leaderTradeId: openLog.leaderTradeId,
        exchange: openLog.exchange ?? "binance",
        action: "CLOSE",
        leaderSymbol: openLog.leaderSymbol,
        leaderSide: openLog.leaderSide,
        leaderNotional: openLog.leaderNotional,
        // Rows written by the bot's worker don't carry leaderBalance, but
        // the shared type requires it. Fall back to 0 rather than inventing one.
        leaderBalance: Number(openLog.leaderBalance ?? 0) || 0,
        followerNotional: openLog.followerNotional ?? null,
        followerOrderId: null,
        entryPrice: openLog.entryPrice ?? null,
        exitPrice: null,
        realizedPnl: null,
        roiPercentage: null,
        status: "closed",
        detail:
          "Closed outside the bot (manual close on the exchange or a missed close event). Confirmed flat on the exchange by reconciliation. Realized PnL not recorded.",
        executedAt: now,
        createdAt: now,
      };

      // Insert-if-absent, keyed on user + trade + CLOSE, so two overlapping
      // runs cannot both write a close row for the same trade.
      // The filter's own equality fields (userId, leaderTradeId, action) are
      // written by the upsert itself. Keep them OUT of $setOnInsert: setting
      // the same path in both is the form MongoDB is strictest about, and
      // it is not worth relying on remembered behaviour for a write that
      // decides what a follower sees as open.
      const insertFields: Omit<CopyTradeLogDoc, "userId" | "leaderTradeId" | "action"> = {
        exchange: closeRow.exchange,
        leaderSymbol: closeRow.leaderSymbol,
        leaderSide: closeRow.leaderSide,
        leaderNotional: closeRow.leaderNotional,
        leaderBalance: closeRow.leaderBalance,
        followerNotional: closeRow.followerNotional,
        followerOrderId: closeRow.followerOrderId,
        entryPrice: closeRow.entryPrice,
        exitPrice: closeRow.exitPrice,
        realizedPnl: closeRow.realizedPnl,
        roiPercentage: closeRow.roiPercentage,
        status: closeRow.status,
        detail: closeRow.detail,
        executedAt: closeRow.executedAt,
        createdAt: closeRow.createdAt,
      };
      const result = await db.collection<CopyTradeLogDoc>("copy_trade_log").updateOne(
        { userId: closeRow.userId, leaderTradeId: closeRow.leaderTradeId, action: "CLOSE" },
        { $setOnInsert: insertFields },
        { upsert: true }
      );

      if (result.upsertedCount > 0) {
        await writeAudit(
          db,
          { ...openLog, action: "CLOSE", status: "closed" },
          "reconciliation.open_verified_flat_marked_closed",
          "Open copy trade marked closed: the exchange confirmed the follower is flat."
        );
        automatedActions.push({
          issue: "open_without_close",
          leaderTradeId: issue.leaderTradeId,
          userId: issue.userId,
          outcome: "marked_closed",
          detail: "Exchange confirmed the follower is flat; CLOSE row written.",
        });
      }
    }
  }

  return {
    generatedAt: now.toISOString(),
    windowDays: days,
    scannedLogs: validLogs.length,
    issues: uniqueIssues,
    summary,
    automatedActions,
  };
}
