import { NextRequest, NextResponse } from "next/server";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { runPerformanceFeeBillingCycle, runSubscriptionRenewalCycle } from "@/lib/billingJobs";

/**
 * Operator-triggered version of /api/cron/run-billing — same underlying
 * jobs, gated by the operator's existing session instead of CRON_SECRET.
 * Exists specifically so billing can be tested/run on demand from the
 * Control Room UI rather than requiring curl + the cron secret, which
 * was the only way to trigger a cycle before this existed.
 */
export async function POST ( req: NextRequest ) {
  const token = req.cookies.get( COOKIE_NAME )?.value;
  const valid = token ? await verifySessionToken( token ) : false;
  if ( !valid ) {
    return NextResponse.json( { error: "Unauthorized" }, { status: 401 } );
  }

  const [ performanceFeeResults, renewalResults ] = await Promise.all( [
    runPerformanceFeeBillingCycle(),
    runSubscriptionRenewalCycle(),
  ] );

  return NextResponse.json( {
    ok: true,
    performanceFees: performanceFeeResults,
    renewals: renewalResults,
  } );
}