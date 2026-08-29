/**
 * ─────────────────────────────────────────────────────────────────────────
 * COPY-TRADE SIZING — risk parity
 *
 * A follower's position size scales by their own account balance relative
 * to the leader's, not a flat percentage of the leader's dollar size.
 * This means a follower with 1/10th the leader's capital opens a position
 * roughly 1/10th the leader's notional — proportional risk exposure,
 * not proportional dollar exposure.
 *
 *   followerNotional = leaderNotional × (followerBalance / leaderBalance)
 *
 * This deliberately does NOT apply the bot's own RISK_PERCENT_PER_TRADE a
 * second time — the leader's trade already embeds that risk decision
 * (that's where leaderNotional comes from), so scaling it down
 * proportionally preserves the same risk percentage of THEIR wallet as
 * the leader took of theirs. Applying RISK_PERCENT_PER_TRADE again here
 * would double-derate follower position sizes for no reason.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface SizingInput {
  leaderNotional: number;
  leaderBalance: number;
  followerBalance: number;
  // Safety caps — a follower should never risk more of their own account
  // than the platform is comfortable with, independent of what the
  // leader's ratio implies (e.g. if the leader's balance snapshot is
  // stale and understates their real balance, this prevents a follower
  // from being sized absurdly large).
  maxNotionalPctOfBalance?: number; // default 0.5 (50%)
  minNotionalUSDT?: number; // default 25 — exchange minimums vary; caller should also check the specific market's minimum
}

export interface SizingResult {
  followerNotional: number;
  scaleFactor: number; // followerBalance / leaderBalance, for logging/audit
  cappedByMaxPct: boolean;
  belowMinimum: boolean;
  minNotionalUSDT: number;
}

function readPositiveEnvNumber(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : fallback;
}

export function getCopyTradeMinActivationBalanceUSDT(): number {
  return readPositiveEnvNumber("COPY_TRADE_MIN_ACTIVATION_BALANCE_USDT", 300);
}

export function getCopyTradeWarnBalanceUSDT(): number {
  return readPositiveEnvNumber("COPY_TRADE_WARN_BALANCE_USDT", 250);
}

export function getCopyTradePauseBalanceUSDT(): number {
  return readPositiveEnvNumber("COPY_TRADE_PAUSE_BALANCE_USDT", 150);
}

export function getMinimumCopyTradeOrderNotionalUSDT(): number {
  return readPositiveEnvNumber("COPY_TRADE_MIN_ORDER_NOTIONAL_USDT", 25);
}

export function calculateFollowerNotional(input: SizingInput): SizingResult {
  const {
    leaderNotional,
    leaderBalance,
    followerBalance,
    maxNotionalPctOfBalance = 0.5,
    minNotionalUSDT = getMinimumCopyTradeOrderNotionalUSDT(),
  } = input;

  if (leaderBalance <= 0 || followerBalance <= 0 || leaderNotional <= 0) {
    return {
      followerNotional: 0,
      scaleFactor: 0,
      cappedByMaxPct: false,
      belowMinimum: true,
      minNotionalUSDT,
    };
  }

  const scaleFactor = followerBalance / leaderBalance;
  let followerNotional = leaderNotional * scaleFactor;

  const maxAllowed = followerBalance * maxNotionalPctOfBalance;
  const cappedByMaxPct = followerNotional > maxAllowed;
  if (cappedByMaxPct) {
    followerNotional = maxAllowed;
  }

  const belowMinimum = followerNotional < minNotionalUSDT;

  return {
    followerNotional: belowMinimum ? 0 : followerNotional,
    scaleFactor,
    cappedByMaxPct,
    belowMinimum,
    minNotionalUSDT,
  };
}
