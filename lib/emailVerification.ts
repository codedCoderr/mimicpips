import { randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import { getSaasDb } from "./saasDb";
import { sendEmail } from "./email";
import type { EmailVerificationTokenDoc, UserDoc } from "./saasTypes";

const TOKEN_TTL_MS = 1000 * 60 * 60 * 24; // 24 hours

function generateToken (): string {
  return randomBytes( 32 ).toString( "hex" );
}

/**
 * Creates a fresh verification token and emails the follower a magic
 * link. Any existing unused tokens for this user are deleted first —
 * only the most recently requested link should work, so an old email
 * (forwarded, cached, whatever) can't be used after a newer one was
 * requested.
 */
export async function sendVerificationEmail ( userId: ObjectId, email: string ): Promise<void> {
  const db = await getSaasDb();

  await db.collection<EmailVerificationTokenDoc>( "email_verification_tokens" ).deleteMany( { userId } );

  const token = generateToken();
  const expiresAt = new Date( Date.now() + TOKEN_TTL_MS );

  await db.collection<EmailVerificationTokenDoc>( "email_verification_tokens" ).insertOne( {
    userId,
    token,
    expiresAt,
    createdAt: new Date(),
  } as any );

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if ( !appUrl ) {
    throw new Error( "NEXT_PUBLIC_APP_URL is not set — cannot build the verification link." );
  }

  const verifyUrl = `${ appUrl.replace( /\/+$/, "" ) }/app/verify-email?token=${ token }`;

  await sendEmail( {
    to: email,
    subject: "Verify your email",
    text: `Verify your email by opening this link: ${ verifyUrl }\n\nThis link expires in 24 hours.`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px;">
        <h1 style="font-size: 20px; margin-bottom: 12px;">Verify your email</h1>
        <p style="color: #555; line-height: 1.5;">
          Click the button below to verify your email address. This link expires in 24 hours.
        </p>
        <a href="${ verifyUrl }"
           style="display: inline-block; background: #111; color: #fff; text-decoration: none;
                  padding: 12px 24px; border-radius: 4px; margin-top: 16px; font-weight: 600;">
          Verify email
        </a>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">
          If you didn't request this, you can safely ignore this email.
        </p>
      </div>
    `,
  } );
}

export type VerifyEmailResult =
  | { success: true }
  | { success: false; reason: "invalid_or_expired" };

/**
 * Consumes a verification token — single use, deleted immediately on
 * success so it can't be replayed even if the link leaks (browser
 * history, a forwarded email, server logs, etc.).
 */
export async function verifyEmailToken ( token: string ): Promise<VerifyEmailResult> {
  const db = await getSaasDb();

  const tokenDoc = await db
    .collection<EmailVerificationTokenDoc>( "email_verification_tokens" )
    .findOne( { token } );

  if ( !tokenDoc || tokenDoc.expiresAt < new Date() ) {
    return { success: false, reason: "invalid_or_expired" };
  }

  await db.collection<UserDoc>( "users" ).updateOne(
    { _id: tokenDoc.userId },
    { $set: { emailVerified: true } }
  );

  await db.collection<EmailVerificationTokenDoc>( "email_verification_tokens" ).deleteOne( {
    _id: tokenDoc._id,
  } );

  return { success: true };
}