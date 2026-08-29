import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME, getUserFromSessionToken } from "@/lib/saasAuth";
import { CopyTradingDashboardClient } from "./client";

export default async function CopyTradingDashboardPage () {
  const cookieStore = await cookies();
  const token = cookieStore.get( COOKIE_NAME )?.value;
  let user = null;

  try {
    user = token ? await getUserFromSessionToken( token ) : null;
  } catch ( error ) {
    console.error( "CopyTradingDashboardPage database unavailable:", error );
    return (
      <main className="min-h-screen flex items-center justify-center px-6">
        <div className="panel max-w-lg w-full p-6 space-y-4">
          <div>
            <span className="eyebrow">Dashboard temporarily unavailable</span>
            <h1 className="font-display text-2xl font-semibold mt-2">
              Could not reach the dashboard database
            </h1>
          </div>
          <p className="text-sm text-[var(--muted)] leading-relaxed">
            Your bot and exchange positions can continue running, but this dashboard
            needs the database connection to load your copy-trading account and recent
            activity.
          </p>
          <a
            href="/app/dashboard"
            className="inline-flex items-center justify-center w-full font-display font-semibold text-sm py-2.5 bg-[var(--text)] text-[var(--bg)]"
          >
            Retry dashboard
          </a>
        </div>
      </main>
    );
  }

  if ( !user ) {
    redirect( "/app/login?next=/app/dashboard" );
  }

  return (
    <CopyTradingDashboardClient
      displayName={ user.displayName }
      copyTradingEnabled={ user.copyTradingEnabled }
    />
  );
}
