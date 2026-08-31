import { ObjectId, type Db } from "mongodb";
import { calculateFollowerHealth, type FollowerHealthScore } from "@/lib/followerHealth";
import { sendEmail } from "@/lib/email";
import { getSaasDb } from "@/lib/saasDb";
import type { PerformanceFeeInvoiceDoc, SubscriptionDoc, UserDoc } from "@/lib/saasTypes";

type RetentionReason = "churn_risk" | "renewal_due" | "pending_payment" | "setup_incomplete" | "low_balance";

export interface RetentionEmailResult {
  userId: string;
  email: string;
  displayName: string;
  reason: RetentionReason;
  outcome: "sent" | "skipped_already_sent" | "dry_run" | "error";
  campaignKey: string;
  detail?: string;
}

interface Candidate {
  user: UserDoc & { _id: ObjectId };
  health: FollowerHealthScore;
  subscription: SubscriptionDoc | null;
  pendingInvoices: PerformanceFeeInvoiceDoc[];
  reason: RetentionReason;
}


function dayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function fmtNgn(n: number): string {
  return `NGN ${n.toLocaleString("en-NG", { maximumFractionDigits: 0 })}`;
}

function reasonForCandidate(
  health: FollowerHealthScore,
  subscription: SubscriptionDoc | null,
  pendingInvoices: PerformanceFeeInvoiceDoc[]
): RetentionReason | null {
  if (health.drivers.some((driver) => /below|balance/i.test(driver)) && health.band !== "healthy") return "low_balance";
  if (pendingInvoices.length > 0 || subscription?.status === "PAST_DUE") return "pending_payment";
  if (health.daysUntilRenewal !== null && health.daysUntilRenewal >= 0 && health.daysUntilRenewal <= 3) return "renewal_due";
  if (health.band === "likely_to_churn" || health.band === "anxious") return "churn_risk";
  if (health.drivers.some((driver) => /not connected|unverified|no active subscription/i.test(driver))) return "setup_incomplete";
  return null;
}

function subjectFor(reason: RetentionReason): string {
  if (reason === "pending_payment") return "Keep your Mimic Pips access uninterrupted";
  if (reason === "renewal_due") return "Your Mimic Pips renewal and risk summary";
  if (reason === "setup_incomplete") return "Finish your Mimic Pips trading setup";
  if (reason === "low_balance") return "Your Mimic Pips balance is near the safety floor";
  return "Mimic Pips risk-control update";
}

function headlineFor(reason: RetentionReason): string {
  if (reason === "pending_payment") return "One account step is blocking a clean copy-trading flow";
  if (reason === "renewal_due") return "Your renewal is close, here is the context";
  if (reason === "setup_incomplete") return "You are close to turning copy trading on safely";
  if (reason === "low_balance") return "Your balance is close to the pause threshold";
  return "Context before emotion: here is what we are seeing";
}

function bodyCopy(candidate: Candidate): string {
  const { reason, health, pendingInvoices } = candidate;
  const invoiceTotal = pendingInvoices.reduce((sum, invoice) => sum + Number(invoice.feeAmountNGN ?? 0), 0);

  if (reason === "pending_payment") {
    const amount = invoiceTotal > 0 ? ` A pending performance-fee balance of ${fmtNgn(invoiceTotal)} is waiting for approval/payment.` : " Your subscription payment is not fully active yet.";
    return `${amount} We pause or block live copying when payment gates are unsettled, because the system should never quietly keep trading while account access is unclear. Once resolved, your dashboard can return to the normal copy-trading checks: verified email, connected exchange, active billing, and no unpaid invoices.`;
  }
  if (reason === "renewal_due") {
    const days = health.daysUntilRenewal !== null ? `${health.daysUntilRenewal} day${health.daysUntilRenewal === 1 ? "" : "s"}` : "a few days";
    return `Your subscription renewal is due in ${days}. Before renewal, here is the practical view: your Risk Guard score is ${health.score}/100, recent 30-day copied PnL is ${health.netPnl30d >= 0 ? "+" : ""}$${health.netPnl30d.toFixed(2)}, and the system is still checking payment, exchange, and execution gates before live entries.`;
  }
  if (reason === "setup_incomplete") {
    return `Your account is not fully live-ready yet. The missing setup gate is: ${health.drivers[0]} This is intentional friction: Mimic Pips should only copy trades after your account is verified, funded, connected, subscribed, and clear of payment holds.`;
  }
  if (reason === "low_balance") {
    return `Your account is showing a balance or safety-floor signal: ${health.drivers[0]} When balances approach the pause threshold, the system is designed to protect you by avoiding undersized or unsafe copied entries rather than forcing trades through.`;
  }
  return `We noticed a behaviour pattern that often appears after losses or uncertainty: ${health.drivers[0]} Over the last 30 days, copied PnL is ${health.netPnl30d >= 0 ? "+" : ""}$${health.netPnl30d.toFixed(2)} with ${health.losingTrades30d} losing close event(s). This note is meant to give you context before emotion takes over: risk gates are visible, copy status is explicit, and you can review the details before making account changes.`;
}

function textEmail(candidate: Candidate): string {
  const { user, health, reason } = candidate;
  return [
    `Hi ${user.displayName || "there"},`,
    headlineFor(reason),
    bodyCopy(candidate),
    `Follower health score: ${health.score}/100 (${health.label}).`,
    `Main signal: ${health.drivers[0]}`,
    `Recommended next step: ${health.recommendedAction}`,
    "Open your Mimic Pips dashboard to review copy status, billing, and recent copied trades.",
    "Mimic Pips",
  ].join("\n\n");
}

function htmlEmail(candidate: Candidate): string {
  const { user, health, reason } = candidate;
  const accent = health.band === "likely_to_churn" ? "#ef4444" : health.band === "anxious" ? "#f59e0b" : "#22c55e";
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "";
  const cta = appUrl ? `${appUrl}/app/dashboard` : "/app/dashboard";
  const driverItems = health.drivers.slice(0, 4).map((driver) => `<li style="margin:0 0 8px;color:#475569">${driver}</li>`).join("");

  return `<!doctype html>
<html>
  <body style="margin:0;background:#eef2f7;padding:24px;font-family:Inter,Arial,sans-serif;color:#0f172a">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #dbe3ef;border-radius:18px;overflow:hidden">
      <tr>
        <td style="background:#07111f;padding:24px 28px;color:#ffffff">
          <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#94a3b8">Mimic Pips</div>
          <h1 style="margin:10px 0 0;font-size:26px;line-height:1.2">${headlineFor(reason)}</h1>
        </td>
      </tr>
      <tr>
        <td style="padding:28px">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.7">Hi ${user.displayName || "there"},</p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#334155">${bodyCopy(candidate)}</p>
          <div style="border:1px solid #e2e8f0;border-radius:14px;padding:18px;margin:22px 0;background:#f8fafc">
            <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#64748b">Follower health</div>
            <div style="display:flex;align-items:center;gap:14px;margin-top:10px">
              <div style="font-size:34px;font-weight:800;color:${accent};line-height:1">${health.score}</div>
              <div>
                <div style="font-weight:700;color:#0f172a">${health.label}</div>
                <div style="font-size:13px;color:#64748b">Risk Guard monitors account readiness, payment gates, renewal timing, and copy-trade behaviour.</div>
              </div>
            </div>
          </div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:20px 0;border-collapse:separate;border-spacing:0 8px">
            <tr>
              <td style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:10px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b">30-day copied PnL</div><div style="font-weight:800;color:#0f172a;margin-top:4px">${health.netPnl30d >= 0 ? "+" : ""}$${health.netPnl30d.toFixed(2)}</div></td>
              <td style="width:8px"></td>
              <td style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:10px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b">Dashboard checks</div><div style="font-weight:800;color:#0f172a;margin-top:4px">${health.recentDashboardViews}</div></td>
              <td style="width:8px"></td>
              <td style="background:#f8fafc;border:1px solid #e2e8f0;padding:12px;border-radius:10px"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b">Risk actions</div><div style="font-weight:800;color:#0f172a;margin-top:4px">${health.recentRiskActions}</div></td>
            </tr>
          </table>
          <div style="margin:22px 0">
            <div style="font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#64748b;margin-bottom:10px">What triggered this note</div>
            <ul style="padding-left:18px;margin:0">${driverItems}</ul>
          </div>
          <div style="border-left:4px solid ${accent};background:#f8fafc;padding:14px 16px;margin:22px 0;color:#334155;font-size:14px;line-height:1.6">
            ${health.recommendedAction}
          </div>
          <a href="${cta}" style="display:inline-block;background:#0f172a;color:#ffffff;text-decoration:none;font-weight:700;border-radius:10px;padding:12px 18px">Open dashboard</a>
          <p style="margin:24px 0 0;font-size:12px;line-height:1.6;color:#64748b">This is not financial advice. Futures trading carries risk. This update is intended to give you operational context about your Mimic Pips account.</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function findCandidates(db: Db): Promise<Candidate[]> {
  const users = await db.collection<UserDoc>("users").find({ role: "follower" }).toArray();
  const candidates = await Promise.all(users.map(async (user) => {
    if (!user._id) return null;
    const typedUser = user as UserDoc & { _id: ObjectId };
    const [health, subscription, pendingInvoices] = await Promise.all([
      calculateFollowerHealth(db, typedUser),
      db.collection<SubscriptionDoc>("subscriptions").findOne({ userId: typedUser._id }),
      db.collection<PerformanceFeeInvoiceDoc>("performance_fee_invoices").find({
        userId: typedUser._id,
        status: { $in: ["PENDING_APPROVAL", "APPROVED"] },
      }).toArray(),
    ]);
    const reason = reasonForCandidate(health, subscription, pendingInvoices);
    return reason ? { user: typedUser, health, subscription, pendingInvoices, reason } : null;
  }));

  return candidates.filter((candidate) => candidate !== null) as Candidate[];
}

export async function runRetentionEmailCycle(options: { dryRun?: boolean } = {}): Promise<RetentionEmailResult[]> {
  const db = await getSaasDb();
  const today = dayKey();
  const candidates = await findCandidates(db);
  const results: RetentionEmailResult[] = [];

  for (const candidate of candidates) {
    const campaignKey = `retention:${today}:${candidate.reason}:${candidate.user._id.toString()}`;
    const base = {
      userId: candidate.user._id.toString(),
      email: candidate.user.email,
      displayName: candidate.user.displayName || candidate.user.email,
      reason: candidate.reason,
      campaignKey,
    };

    const existing = await db.collection("marketing_send_logs").findOne({ campaignKey });
    if (existing) {
      results.push({ ...base, outcome: "skipped_already_sent" });
      continue;
    }

    if (options.dryRun) {
      results.push({ ...base, outcome: "dry_run", detail: subjectFor(candidate.reason) });
      continue;
    }

    try {
      await sendEmail({
        to: candidate.user.email,
        subject: subjectFor(candidate.reason),
        text: textEmail(candidate),
        html: htmlEmail(candidate),
      });

      await db.collection("marketing_send_logs").insertOne({
        campaignKey,
        userId: candidate.user._id,
        channel: "email",
        status: "sent",
        subject: subjectFor(candidate.reason),
        message: textEmail(candidate),
        recipientEmail: candidate.user.email,
        reason: candidate.reason,
        healthScore: candidate.health.score,
        healthBand: candidate.health.band,
        createdAt: new Date(),
      });

      results.push({ ...base, outcome: "sent" });
    } catch (error) {
      results.push({ ...base, outcome: "error", detail: error instanceof Error ? error.message : "Email send failed." });
    }
  }

  return results;
}
