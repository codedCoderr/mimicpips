// instrumentation.ts
export async function register () {
  if ( process.env.NEXT_RUNTIME === "nodejs" ) {
    await import( "@/lib/cron/billingCron" );
    // initBillingCron();
    const { initCopyTradeSubscriber } = await import( "@/lib/copyTradeSubscriber" );
    initCopyTradeSubscriber();
  }
}
