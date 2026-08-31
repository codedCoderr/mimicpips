import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const botUrl = process.env.BOT_SERVER_URL?.replace(/\/+$/, "");
const serviceKey = process.env.SAAS_SERVICE_KEY;
const maxEvents = Number(process.env.CHECK_BOT_STOP_EVENTS ?? 10);
const timeoutMs = Number(process.env.CHECK_BOT_STOP_TIMEOUT_MS ?? 30_000);

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function unwrapTradePayload(input) {
  if (!input || typeof input !== "object") return input;
  return input.trade ?? input.position ?? input.order ?? input;
}

function parseTradeEvent(input) {
  const body = unwrapTradePayload(input);
  if (!body || typeof body !== "object") return null;

  const leaderTradeId = readString(body.leaderTradeId) ?? readString(body.tradeId) ?? readString(body.id);
  const rawAction = readString(body.action)?.toUpperCase() ?? (readString(body.type) === "position.closed" ? "CLOSE" : "OPEN");
  const action = rawAction === "CLOSE" ? "CLOSE" : rawAction === "OPEN" ? "OPEN" : null;
  const symbol = readString(body.symbol) ?? readString(body.leaderSymbol);
  const side = body.side === "SHORT" || body.side === "SELL" ? "SHORT" : body.side === "LONG" || body.side === "BUY" ? "LONG" : null;
  const stopLossPrice =
    readNumber(body.stopLossPrice) ??
    readNumber(body.stopLoss) ??
    readNumber(body.atrStopLoss) ??
    readNumber(body.atrStopLossPrice) ??
    null;
  const stopLossType =
    readNumber(body.atrStopLoss) || readNumber(body.atrStopLossPrice) || readNumber(body.atrMultiplier) || readNumber(body.stMult)
      ? "ATR"
      : readNumber(body.stopLossPrice) || readNumber(body.stopLoss)
        ? "manual"
        : null;

  if (!leaderTradeId || !action || !symbol || !side) return null;
  return {
    action,
    symbol,
    side,
    stopLossPrice,
    stopLossType,
    atrPeriod: readNumber(body.atrPeriod) ?? readNumber(body.stPeriod) ?? null,
    atrMultiplier: readNumber(body.atrMultiplier) ?? readNumber(body.stMult) ?? null,
  };
}

function inspectEnvelope(envelope) {
  const eventType = envelope.type ?? envelope.event;
  if (eventType !== "TRADE_EXECUTED" && eventType !== "position.opened" && eventType !== "position.closed") {
    return false;
  }

  const tradeEvent = parseTradeEvent(envelope.payload ?? envelope.data ?? envelope);
  if (!tradeEvent) {
    console.log(`[WARN] ${eventType}: trade event was malformed.`);
    return true;
  }

  if (tradeEvent.action !== "OPEN") {
    console.log(`[OK] ${eventType}: ${tradeEvent.action} ${tradeEvent.symbol}; stop data is only required on OPEN.`);
    return true;
  }

  const hasStop = Number.isFinite(tradeEvent.stopLossPrice) && tradeEvent.stopLossPrice > 0;
  const status = hasStop ? "OK" : "MISSING";
  console.log(
    `[${status}] ${eventType}: ${tradeEvent.symbol} ${tradeEvent.side} stopLossPrice=${tradeEvent.stopLossPrice ?? "null"} type=${tradeEvent.stopLossType ?? "null"} atrPeriod=${tradeEvent.atrPeriod ?? "null"} atrMultiplier=${tradeEvent.atrMultiplier ?? "null"}`
  );
  return true;
}

async function main() {
  if (!botUrl || !serviceKey) {
    throw new Error("BOT_SERVER_URL and SAAS_SERVICE_KEY must be set in .env.local.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => {
    console.log("Stopped after timeout. No trade events were observed in the check window.");
    controller.abort();
    process.exit(0);
  }, timeoutMs);

  const response = await fetch(`${botUrl}/api/events`, {
    headers: {
      Accept: "text/event-stream",
      "X-Service-Key": serviceKey,
    },
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    throw new Error(`Bot event stream unavailable: HTTP ${response.status}.`);
  }

  console.log(`Connected to ${botUrl}/api/events. Watching up to ${maxEvents} relevant event(s)...`);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let relevantEvents = 0;

  while (relevantEvents < maxEvents) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = chunk
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (data && data !== "[DONE]") {
        try {
          if (inspectEnvelope(JSON.parse(data))) relevantEvents += 1;
        } catch {
          console.log("[WARN] Ignored malformed SSE JSON.");
        }
      }

      if (relevantEvents >= maxEvents) break;
      boundary = buffer.indexOf("\n\n");
    }
  }

  clearTimeout(timeout);
  controller.abort();

  if (relevantEvents === 0) {
    console.log("No trade events were observed before the stream ended.");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Unknown error.");
  process.exit(1);
});
