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
  } );

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if ( !appUrl ) {
    throw new Error( "NEXT_PUBLIC_APP_URL is not set — cannot build the verification link." );
  }

  const verifyUrl = `${ appUrl.replace( /\/+$/, "" ) }/app/verify-email?token=${ token }`;

  await sendEmail( {
    to: email,
    subject: "Verify your email address",
    text: `Welcome! Please verify your email address by opening the following link in your browser:\n\n${ verifyUrl }\n\nThis link will expire in 24 hours. If you did not request this email, you can safely ignore it.`,
    html: `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Verify your email address</title>
        </head>
        <body style="background-color: #f4f5f7; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; margin: 0; padding: 40px 16px; -webkit-font-smoothing: antialiased;">
          <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e5e7eb; overflow: hidden; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
            <!-- Top Accent Bar -->
            <tr>
              <td style="background-color: #111827; height: 6px;"></td>
            </tr>

            <!-- Content Area -->
            <tr>
              <td style="padding: 40px 32px 32px;">
                <h1 style="color: #111827; font-size: 22px; font-weight: 700; margin: 0 0 16px 0; letter-spacing: -0.02em;">
                  Verify your email address
                </h1>

                <p style="color: #4b5563; font-size: 15px; line-height: 1.6; margin: 0 0 24px 0;">
                  Thanks for signing up! Please confirm your email address to finish setting up your account and get started.
                </p>

                <!-- Primary CTA Button -->
                <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 0 28px 0;">
                  <tr>
                    <td align="center" style="border-radius: 8px; background-color: #111827;">
                      <a href="${ verifyUrl }" target="_blank" style="display: inline-block; padding: 13px 26px; font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 8px;">
                        Verify Email Address &rarr;
                      </a>
                    </td>
                  </tr>
                </table>

                <p style="color: #6b7280; font-size: 13px; line-height: 1.5; margin: 0 0 24px 0;">
                  This verification link will expire in <strong>24 hours</strong>.
                </p>

                <!-- Fallback URL Container -->
                <div style="border-top: 1px solid #f3f4f6; padding-top: 20px; margin-top: 20px;">
                  <p style="color: #9ca3af; font-size: 12px; line-height: 1.5; margin: 0 0 8px 0;">
                    Having trouble with the button? Copy and paste this URL into your browser:
                  </p>
                  <a href="${ verifyUrl }" style="color: #2563eb; font-size: 12px; word-break: break-all; text-decoration: underline;">
                    ${ verifyUrl }
                  </a>
                </div>
              </td>
            </tr>

            <!-- Footer Area -->
            <tr>
              <td style="background-color: #f9fafb; padding: 20px 32px; border-top: 1px solid #f3f4f6; text-align: center;">
                <p style="color: #9ca3af; font-size: 12px; margin: 0; line-height: 1.5;">
                  If you didn't create an account, no further action is required. You can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </body>
      </html>
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
