export interface TelegramSendResult {
  messageId: number | null;
  chatId: string;
}

export interface TelegramInviteResult {
  inviteLink: string;
  createsJoinRequest: boolean;
}

export class TelegramSendError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "TelegramSendError";
    this.statusCode = statusCode;
  }
}

function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const publicChannelId = process.env.TELEGRAM_PUBLIC_CHANNEL_ID?.trim();

  if (!token || !publicChannelId) {
    throw new TelegramSendError(
      "Telegram is not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_PUBLIC_CHANNEL_ID in .env.local.",
      400
    );
  }

  return { token, publicChannelId };
}

function telegramFriendlyError(description: string | undefined, publicChannelId: string): string {
  const lower = description?.toLowerCase() ?? "";
  if (lower.includes("not found")) {
    return `Telegram could not find ${publicChannelId}. Check TELEGRAM_PUBLIC_CHANNEL_ID and make sure the bot has been added to the channel. For public channels use @channelusername; for private channels use the numeric -100... id.`;
  }
  if (lower.includes("chat not found")) {
    return `Telegram chat not found. Add the bot to ${publicChannelId} first, then try again.`;
  }
  if (lower.includes("forbidden") || lower.includes("not enough rights")) {
    return `Telegram rejected the send because the bot does not have permission to post in ${publicChannelId}. In Telegram, open the channel, add the bot as an administrator, and enable permission to post messages.`;
  }
  if (lower.includes("unauthorized")) {
    return "Telegram rejected the bot token. Check TELEGRAM_BOT_TOKEN in .env.local.";
  }
  return description ?? "Telegram send failed.";
}

export async function sendTelegramPublicMessage(html: string): Promise<TelegramSendResult> {
  const { token, publicChannelId } = getTelegramConfig();
  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: publicChannelId,
      text: html.slice(0, 3900),
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
  });

  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    description?: string;
    parameters?: { retry_after?: number };
    result?: { message_id?: number; chat?: { id?: string | number } };
  } | null;

  if (!response.ok || !data?.ok) {
    if (response.status === 429) {
      const retryAfter = data?.parameters?.retry_after;
      const retryText = retryAfter ? ` Please wait about ${retryAfter} seconds before trying again.` : " Please wait a moment before trying again.";
      throw new TelegramSendError(`Telegram is rate limiting this bot because messages are being sent too quickly.${retryText}`, 429);
    }

    const statusCode = response.status === 400 || response.status === 401 || response.status === 403 || response.status === 404 ? 400 : 502;
    throw new TelegramSendError(telegramFriendlyError(data?.description, publicChannelId), statusCode);
  }

  return {
    messageId: data.result?.message_id ?? null,
    chatId: String(data.result?.chat?.id ?? publicChannelId),
  };
}

export async function createTelegramSignalInviteLink(name: string): Promise<TelegramInviteResult | null> {
  const staticInviteUrl = process.env.TELEGRAM_SIGNAL_INVITE_URL?.trim();
  if (staticInviteUrl) {
    return { inviteLink: staticInviteUrl, createsJoinRequest: false };
  }

  const { token, publicChannelId } = getTelegramConfig();
  const response = await fetch(`https://api.telegram.org/bot${token}/createChatInviteLink`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: publicChannelId,
      name: name.slice(0, 32) || "Mimic Pips signal access",
      creates_join_request: false,
    }),
  });

  const data = await response.json().catch(() => null) as {
    ok?: boolean;
    description?: string;
    result?: { invite_link?: string; creates_join_request?: boolean };
  } | null;

  if (!response.ok || !data?.ok || !data.result?.invite_link) {
    if (response.status === 429) {
      throw new TelegramSendError("Telegram is rate limiting invite link creation. Please wait a moment before trying again.", 429);
    }
    throw new TelegramSendError(telegramFriendlyError(data?.description, publicChannelId), 400);
  }

  return {
    inviteLink: data.result.invite_link,
    createsJoinRequest: !!data.result.creates_join_request,
  };
}
