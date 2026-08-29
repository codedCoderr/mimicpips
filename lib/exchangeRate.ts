/**
 * Configurable exchange rate for converting the bot's USD-denominated
 * profit (USDT balances) into NGN for performance fee invoices. Set as
 * an env var so it can be updated periodically without a code change or
 * redeploy involving logic changes — just update the env var and
 * restart.
 *
 * This is NOT used for the flat monthly fee, which is priced directly
 * in NGN and never touches a conversion.
 */
export function getUsdToNgnRate(): number {
  const raw = process.env.USD_TO_NGN_RATE;
  const rate = raw ? parseFloat(raw) : NaN;
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error(
      "USD_TO_NGN_RATE is not set or invalid. Set it to the current USD→NGN rate, e.g. USD_TO_NGN_RATE=1650"
    );
  }
  return rate;
}

export function convertUsdToNgn(amountUSD: number): number {
  return amountUSD * getUsdToNgnRate();
}