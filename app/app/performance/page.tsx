import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME, getUserFromSessionToken } from "@/lib/saasAuth";
import { PerformanceClient } from "./client";

export default async function PerformancePage () {
  const cookieStore = await cookies();
  const token = cookieStore.get( COOKIE_NAME )?.value;
  const user = token ? await getUserFromSessionToken( token ) : null;

  if ( !user ) {
    redirect( "/app/login?next=/app/performance" );
  }

  return <PerformanceClient />;
}