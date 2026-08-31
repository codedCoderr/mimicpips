import type { ObjectId } from "mongodb";

/**
 * Data model for the copy-trading SaaS layer. Kept separate from the bot's
 * own trading types (lib/types.ts) since these describe a different
 * system — the SaaS platform's users and their relationship to the
 * leader's trades, not the leader's own bot state.
 */

export interface UserDoc {
  _id?: ObjectId;
  email: string;
  passwordHash: string;
  displayName: string;
  createdAt: Date;
  role: "follower" | "admin";
  // Set true only once the user has completed key setup AND explicitly
  // opted in to live copy-trading — see the "gated go-live" note in
  // /areas/futures-trading-bot.md. Never true by default.
  copyTradingEnabled: boolean;
  emailVerified: boolean;
  // Risk disclosure tracking
  riskDisclosureAccepted?: boolean;
  riskDisclosureVersion?: string;
  riskDisclosureAcceptedAt?: Date;
  // Set true once the user has dismissed the first-login onboarding
  // modal — independent of whether they actually connected an exchange
  // key, so the modal doesn't reappear every session while they're still
  // mid-setup across multiple visits.
  hasSeenOnboarding: boolean;
}

export interface RiskDisclosureLogDoc {
  _id?: ObjectId;
  userId: ObjectId;
  version: string;
  ipAddress: string;
  contentSnapshot: unknown;
  userAgent: string;
  acceptedAt: Date;
}

export type ExchangeId = "binance";

export interface ExchangeKeyDoc {
  _id?: ObjectId;
  userId: ObjectId;
  exchange: ExchangeId;
  // Encrypted with lib/exchangeKeyCrypto.ts — never store plaintext.
  apiKeyEncrypted: { ciphertext: string; nonce: string };
  apiSecretEncrypted: { ciphertext: string; nonce: string };
  // Set after a successful test call (e.g. fetchBalance) confirms the
  // keys work and are read/trade-scoped, not withdrawal-scoped.
  verifiedAt: Date | null;
  // Snapshotted at verification time so the copy-trade worker can size
  // positions without re-fetching balance on every signal.
  lastKnownBalanceUSDT: number | null;
  lastBalanceCheckAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type SubscriptionStatus =
  | "PENDING_PAYMENT"
  | "RENEWING"
  | "ACTIVE"
  | "PAST_DUE"
  | "EXPIRED"
  | "CANCELLED";

export interface SubscriptionDoc {
  _id?: ObjectId;
  userId: ObjectId;
  status: SubscriptionStatus;
  // Flat monthly fee in whole Naira (NGN) — converted to kobo only at
  // the point of calling Paystack. Set from $19 at whatever
  // USD_TO_NGN_RATE was configured when the subscription was created,
  // so the charged amount stays fixed even if the rate env var changes
  // later — an existing subscriber's price doesn't silently shift with
  // FX movements between billing cycles.
  monthlyFeeNGN: number;
  // Paystack authorization — captured from the first successful charge,
  // reused for subsequent months via charge_authorization. Never store
  // full card details; this is Paystack's own reusable token.
  paystackCustomerCode: string | null;
  paystackAuthorizationCode: string | null;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  // The date the flat fee was last successfully charged — drives the
  // monthly billing cron's "is this subscription due" check.
  lastChargedAt: Date | null;
  // Consecutive failed charge attempts — used for PAST_DUE escalation
  // and eventually pausing copy trading if unresolved.
  failedChargeCount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * High-water-mark tracking for the performance fee, one record per
 * follower. Updated by the monthly performance-fee job. `peakBalance`
 * only ever moves up — a fee is owed only when the period's ending
 * balance exceeds this peak, and only on the amount above it.
 */
export interface HighWaterMarkDoc {
  _id?: ObjectId;
  userId: ObjectId;
  peakBalanceUSD: number;
  peakSetAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type PerformanceFeeInvoiceStatus =
  | "PENDING_APPROVAL" // calculated, waiting for the follower to review and approve payment
  | "APPROVED" // follower approved, Paystack payment initialized
  | "PAID"
  | "WAIVED" // operator manually waived — e.g. dispute, goodwill
  | "EXPIRED"; // not approved within the payment window

export interface PerformanceFeeInvoiceDoc {
  _id?: ObjectId;
  userId: ObjectId;
  periodStart: Date;
  periodEnd: Date;
  startBalanceUSD: number;
  endBalanceUSD: number;
  priorPeakBalanceUSD: number;
  newPeakBalanceUSD: number;
  profitAboveHighWaterMarkUSD: number; // the ONLY amount the fee is calculated from
  feePercent: number; // 0.30 — stored per-invoice in case the rate changes later
  feeAmountUSD: number;
  // The actual charged amount and the rate used to get there, frozen at
  // invoice-creation time — if USD_TO_NGN_RATE changes later, this
  // invoice still shows what the follower was actually asked to pay.
  usdToNgnRateAtInvoice: number;
  feeAmountNGN: number;
  status: PerformanceFeeInvoiceStatus;
  paystackReference: string | null;
  createdAt: Date;
  updatedAt: Date;
  paidAt: Date | null;
}

export type CopyTradeLogStatus =
  | "executed"
  | "closed"
  | "skipped_insufficient_balance"
  | "skipped_not_verified"
  | "skipped_copy_trading_disabled"
  | "skipped_duplicate"
  | "skipped_subscription_inactive"
  | "skipped_pending_invoice"
  | "skipped_balance_unavailable"
  | "failed";

export interface CopyTradeLogDoc {
  _id?: ObjectId;
  userId: ObjectId;
  leaderTradeId: string;
  action: "OPEN" | "CLOSE";
  leaderSymbol: string;
  leaderSide: "LONG" | "SHORT";
  leaderNotional: number;
  leaderBalance: number;
  followerNotional: number | null;
  followerOrderId: string | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
  stopLossPrice?: number | null;
  stopLossType?: "ATR" | "manual" | "unknown" | null;
  atrPeriod?: number | null;
  atrMultiplier?: number | null;
  realizedPnl?: number | null;
  roiPercentage?: number | null;
  exchange: ExchangeId;
  status: CopyTradeLogStatus;
  detail: string | null;
  executedAt: Date | null;
  createdAt: Date;
}

export interface SessionDoc {
  _id?: ObjectId;
  userId: ObjectId;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}

/**
 * Magic-link email verification tokens. Single-use — deleted (not just
 * marked used) once consumed, so a leaked/logged link can't be replayed.
 */
export interface EmailVerificationTokenDoc {
  _id?: ObjectId;
  userId: ObjectId;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}
