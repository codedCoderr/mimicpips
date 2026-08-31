import { NextRequest, NextResponse } from "next/server";
import { ObjectId } from "mongodb";
import { COOKIE_NAME, verifySessionToken } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { getSaasDb } from "@/lib/saasDb";
import { sendTelegramPublicMessage, TelegramSendError } from "@/lib/telegram";
import type { UserDoc } from "@/lib/saasTypes";

async function requireOperator(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  return token ? !!(await verifySessionToken(token).catch(() => null)) : false;
}

function clean(value: unknown, max = 500): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char] ?? char)).replace(/\n/g, "<br />")}</p>`)
    .join("");
}

export async function POST(req: NextRequest) {
  if (!(await requireOperator(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const channel = clean(body?.channel, 40);
  const eventId = clean(body?.eventId, 80);
  const userId = clean(body?.userId, 80);
  const subject = clean(body?.subject, 160) || "Mimic Pips update";
  const message = clean(body?.message, 2000);

  if (!["email", "telegram_draft", "telegram_public"].includes(channel)) {
    return NextResponse.json({ error: "channel must be email, telegram_draft, or telegram_public." }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "message is required." }, { status: 400 });
  }

  const db = await getSaasDb();
  let recipientEmail = clean(body?.recipientEmail, 180);
  let recipientName = clean(body?.recipientName, 120) || "follower";

  if (userId) {
    if (!ObjectId.isValid(userId)) return NextResponse.json({ error: "Invalid userId." }, { status: 400 });
    const user = await db.collection<UserDoc>("users").findOne({ _id: new ObjectId(userId), role: "follower" });
    if (!user) return NextResponse.json({ error: "Follower not found." }, { status: 404 });
    recipientEmail = user.email;
    recipientName = user.displayName || user.email;
  }

  if (channel === "email" && !recipientEmail) {
    return NextResponse.json({ error: "recipientEmail or userId is required for email." }, { status: 400 });
  }

  const now = new Date();
  let status: "sent" | "drafted" = "drafted";
  let providerMessageId: number | null = null;
  let providerChatId: string | null = null;

  if (channel === "email") {
    await sendEmail({
      to: recipientEmail,
      subject,
      text: `Hi ${recipientName},\n\n${message}\n\nMimic Pips`,
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#111827"><p>Hi ${recipientName},</p>${textToHtml(message)}<p>Mimic Pips</p></div>`,
    });
    status = "sent";
  }

  if (channel === "telegram_public") {
    try {
      const result = await sendTelegramPublicMessage(message);
      providerMessageId = result.messageId;
      providerChatId = result.chatId;
      status = "sent";
    } catch (error) {
      if (error instanceof TelegramSendError) {
        return NextResponse.json({ error: error.message }, { status: error.statusCode });
      }
      throw error;
    }
  }

  const log = {
    eventId: ObjectId.isValid(eventId) ? new ObjectId(eventId) : null,
    userId: ObjectId.isValid(userId) ? new ObjectId(userId) : null,
    channel,
    status,
    subject,
    message,
    recipientEmail: channel === "email" ? recipientEmail : null,
    providerMessageId,
    providerChatId,
    createdAt: now,
  };

  await db.collection("marketing_send_logs").insertOne(log);
  if (ObjectId.isValid(eventId)) {
    await db.collection("marketing_events").updateOne(
      { _id: new ObjectId(eventId) },
      { $set: { lastSentAt: now, lastSentChannel: channel, updatedAt: now } }
    );
  }

  return NextResponse.json({ ok: true, status, log: { ...log, createdAt: now.toISOString() } });
}
