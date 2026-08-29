/**
 * ─────────────────────────────────────────────────────────────────────────
 * PERFORMANCE FEE CALCULATION — high-water mark
 *
 * The fee is owed ONLY on profit above the follower's highest-ever
 * period-end balance ("peak"). This means:
 *
 *   - A follower who ends a period below their prior peak owes $0, even
 *     if they made money this period (they're still recovering a
 *     drawdown — no fee until they're back above where they've been
 *     before).
 *   - A follower who ends above their prior peak owes 30% of ONLY the
 *     amount above that peak, not 30% of their total period profit.
 *   - The peak only ever moves up. It's set to the new balance whenever
 *     a fee-generating period ends above the old peak — never reset
 *     downward by a loss.
 *
 * This is the standard structure for performance fees (used by hedge
 * funds and most reputable copy-trading platforms) specifically because
 * the alternative — charging on any positive period, even a partial
 * recovery from a loss — means charging a fee on money the follower
 * hasn't actually netted yet relative to their own history. That's the
 * kind of thing that erodes trust fast and invites disputes.
 * ─────────────────────────────────────────────────────────────────────────
 */

export interface PerformanceFeeCalculation {
  startBalanceUSD: number;
  endBalanceUSD: number;
  priorPeakBalanceUSD: number;
  newPeakBalanceUSD: number;
  profitAboveHighWaterMarkUSD: number;
  feeAmountUSD: number;
  feeOwed: boolean;
}

export function calculatePerformanceFee(
  startBalanceUSD: number,
  endBalanceUSD: number,
  priorPeakBalanceUSD: number,
  feePercent: number
): PerformanceFeeCalculation {
  // The peak never moves down — a loss doesn't erase prior high-water
  // progress, it just means no new fee is owed until the follower gets
  // back above it.
  const newPeakBalanceUSD = Math.max(priorPeakBalanceUSD, endBalanceUSD);

  const profitAboveHighWaterMarkUSD = Math.max(0, endBalanceUSD - priorPeakBalanceUSD);
  const feeAmountUSD =
    profitAboveHighWaterMarkUSD > 0
      ? Math.round(profitAboveHighWaterMarkUSD * feePercent * 100) / 100
      : 0;

  return {
    startBalanceUSD,
    endBalanceUSD,
    priorPeakBalanceUSD,
    newPeakBalanceUSD,
    profitAboveHighWaterMarkUSD,
    feeAmountUSD,
    feeOwed: feeAmountUSD > 0,
  };
}

/**
 * The first-ever period for a follower has no prior peak — their
 * starting balance at exchange-key verification time is the natural
 * initial high-water mark, so the first period's fee is calculated on
 * profit above their OWN starting point, not from zero (which would
 * charge a fee on their entire account balance).
 */
export function initialHighWaterMark(startingBalanceUSD: number): number {
  return startingBalanceUSD;
}