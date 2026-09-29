/**
 * The one formula for directional realized PnL and ROI on a copied trade,
 * shared by every place that computes it: this app's copyTradeWorker.ts
 * (both the "already flat" and the normal-close branches),
 * copyTradeLogDisplay.ts's historical-data repair, and the bot's own
 * copyTradeWorker.ts close handler. Before this, the same
 * `((exit - entry) / entry) * notional * direction` line was written out
 * independently in four places — a fix to the math in one would not have
 * reached the others.
 *
 * Deliberately NOT merged with the different DECISION logic around each
 * call site (which price to use when one is missing, whether to fall back
 * to the leader's own scaled PnL, what counts as "resolvable" for display
 * purposes) — those differ for real reasons per call site and collapsing
 * them would risk changing behavior. This is only the arithmetic.
 */
export interface DirectionalPnlResult {
  pnl: number;
  roi: number;
}

/**
 * @param entryPrice Fill price the position was opened at. Must be > 0.
 * @param exitPrice Fill price the position was closed at. Must be > 0.
 * @param notional The follower's notional (position size in quote currency)
 *   the PnL is computed against. Must be > 0.
 * @param side Direction of the position being closed.
 * @returns null if any input is missing, non-finite, or <= 0 — callers
 *   decide what "unknown" means for their own context (leave a field null,
 *   fall back to a stored value, etc.), this function does not guess.
 */
export function calculateDirectionalPnl(
  entryPrice: number | null | undefined,
  exitPrice: number | null | undefined,
  notional: number | null | undefined,
  side: "LONG" | "SHORT" | null | undefined
): DirectionalPnlResult | null {
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  const size = Number(notional);
  if (!Number.isFinite(entry) || entry <= 0) return null;
  if (!Number.isFinite(exit) || exit <= 0) return null;
  if (!Number.isFinite(size) || size <= 0) return null;

  const direction = side === "SHORT" ? -1 : 1;
  const pnl = ((exit - entry) / entry) * size * direction;
  const roi = (pnl / size) * 100;
  return { pnl, roi };
}
