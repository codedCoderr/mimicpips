import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { COOKIE_NAME, getUserFromSessionToken } from "@/lib/saasAuth";
import { getSaasDb } from "@/lib/saasDb";
import type { ExchangeKeyDoc } from "@/lib/saasTypes";
import { ProfilePageClient } from "./client";

export default async function ProfilePage () {
  const cookieStore = await cookies();
  const token = cookieStore.get( COOKIE_NAME )?.value;
  const user = token ? await getUserFromSessionToken( token ) : null;

  // This is the real auth boundary — proxy.ts only checked that SOME
  // cookie was present (it can't reach MongoDB from the Edge runtime).
  // An expired or revoked token lands here and gets redirected properly.
  if ( !user ) {
    redirect( "/app/login?next=/app/profile" );
  }

  const db = await getSaasDb();
  const keyDoc = await db
    .collection<ExchangeKeyDoc>( "exchange_keys" )
    .findOne( { userId: user._id! } );

  return (
    <ProfilePageClient
      displayName={ user.displayName }
      email={ user.email }
      emailVerified={ user.emailVerified }
      exchangeConnected={ !!keyDoc?.verifiedAt }
      lastKnownBalanceUSDT={ keyDoc?.lastKnownBalanceUSDT ?? null }
      hasSeenOnboarding={ user.hasSeenOnboarding }
    />
  );
}