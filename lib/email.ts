import nodemailer from "nodemailer";

/**
 * SMTP email sending, configured via env vars — works with any provider
 * (Gmail, AWS SES, Mailgun, etc.), not tied to a specific vendor's SDK.
 *
 * Required env vars:
 *   SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
 *
 * SMTP_FROM is the "from" address shown to recipients — must be an
 * address your SMTP provider is authorized to send as (many providers
 * reject mail from unverified addresses).
 */

let transporter: nodemailer.Transporter | null = null;

function getTransporter (): nodemailer.Transporter {
  if ( transporter ) return transporter;

  const host = process.env.SMTP_HOST;
  const port = process.env.SMTP_PORT;
  const user = process.env.SMTP_USER;
  const password = process.env.SMTP_PASSWORD;


  if ( !host || !port || !user || !password ) {
    throw new Error(
      "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, and SMTP_FROM."
    );
  }

  transporter = nodemailer.createTransport( {
    host,
    port: Number( port ),
    secure: Number( port ) === 465, // true for 465 (implicit TLS), false for 587/25 (STARTTLS)
    auth: { user, pass: password },
  } );

  return transporter;
}

export async function sendEmail ( params: {
  to: string;
  subject: string;
  html: string;
  text: string;
} ): Promise<void> {
  const from = process.env.SMTP_FROM;
  if ( !from ) {
    throw new Error( "SMTP_FROM is not set." );
  }

  const t = getTransporter();
  await t.sendMail( {
    from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
  } );
}
