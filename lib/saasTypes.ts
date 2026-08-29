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
  | "TRIALING"
  | "ACTIVE"
  | "PAST_DUE"
  | "CANCELLED";

export interface SubscriptionDoc {
  _id?: ObjectId;
  userId: ObjectId;
  status: SubscriptionStatus;
  plan: "starter" | "pro";
  // Paystack fields — populated once billing is wired up. Left optional
  // and unused by any code path until then.
  paystackCustomerCode?: string;
  paystackSubscriptionCode?: string;
  currentPeriodEnd?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export type CopyTradeLogStatus =
  | "executed"
  | "skipped_insufficient_balance"
  | "skipped_not_verified"
  | "skipped_copy_trading_disabled"
  | "failed";

export interface CopyTradeLogDoc {
  _id?: ObjectId;
  userId: ObjectId;
  leaderSymbol: string;
  leaderSide: "LONG" | "SHORT";
  leaderNotional: number;
  followerNotional: number | null;
  followerOrderId: string | null;
  status: CopyTradeLogStatus;
  detail: string | null;
  createdAt: Date;
}

export interface SessionDoc {
  _id?: ObjectId;
  userId: ObjectId;
  token: string;
  expiresAt: Date;
  createdAt: Date;
}