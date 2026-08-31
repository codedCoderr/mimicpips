import { executeCopyTradeFanOut, hasStopLossProtection, parseLeaderTradeEvent } from "./copyTradeWorker";
import { getErrorMessage } from "./errorMessage";

const RECONNECT_MS = 5000;

const globalForCopyTradeSubscriber = globalThis as unknown as {
  copyTradeSubscriberStarted?: boolean;
  copyTradeSubscriberAbort?: AbortController;
};

interface BrokerEnvelope {
  type?: string;
  event?: string;
  payload?: unknown;
  data?: unknown;
}

export function initCopyTradeSubscriber(): void {
  if (globalForCopyTradeSubscriber.copyTradeSubscriberStarted) return;
  if (process.env.COPY_TRADE_WORKER_ENABLED !== "true") return;

  const botUrl = process.env.BOT_SERVER_URL;
  const serviceKey = process.env.SAAS_SERVICE_KEY;
  if (!botUrl || !serviceKey) {
    console.warn("[CopyTrade] Worker disabled: BOT_SERVER_URL / SAAS_SERVICE_KEY not configured.");
    return;
  }

  console.log(`[CopyTrade] Worker starting; subscribing to ${botUrl.replace(/\/+$/, "")}/api/events`);
  globalForCopyTradeSubscriber.copyTradeSubscriberStarted = true;
  void runSubscriber(botUrl.replace(/\/+$/, ""), serviceKey);
}

async function runSubscriber(botUrl: string, serviceKey: string): Promise<void> {
  while (globalForCopyTradeSubscriber.copyTradeSubscriberStarted) {
    const controller = new AbortController();
    globalForCopyTradeSubscriber.copyTradeSubscriberAbort = controller;

    try {
      const response = await fetch(`${botUrl}/api/events`, {
        headers: {
          Accept: "text/event-stream",
          "X-Service-Key": serviceKey,
        },
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        console.warn(`[CopyTrade] Event stream unavailable (${response.status}). Retrying...`);
      } else {
        console.log("[CopyTrade] Event stream connected.");
        await readEventStream(response.body);
      }
    } catch (error: unknown) {
      if (!controller.signal.aborted) {
        console.warn(`[CopyTrade] Event stream error: ${getErrorMessage(error, "unknown error")}`);
      }
    } finally {
      if (globalForCopyTradeSubscriber.copyTradeSubscriberAbort === controller) {
        globalForCopyTradeSubscriber.copyTradeSubscriberAbort = undefined;
      }
    }

    await sleep(RECONNECT_MS);
  }
}

async function readEventStream(body: ReadableStream<Uint8Array>): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) return;

    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      await handleSseChunk(chunk);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

async function handleSseChunk(chunk: string): Promise<void> {
  const data = chunk
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .join("\n");
  if (!data || data === "[DONE]") return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return;
  }

  const envelope = parsed as BrokerEnvelope;
  const eventType = envelope.type ?? envelope.event;
  if (eventType !== "TRADE_EXECUTED" && eventType !== "position.opened" && eventType !== "position.closed") {
    return;
  }

  const tradeEvent = parseLeaderTradeEvent(envelope.payload ?? envelope.data ?? envelope);
  if (!tradeEvent) {
    console.warn("[CopyTrade] Ignored malformed leader trade event.");
    return;
  }

  const results = await executeCopyTradeFanOut(tradeEvent);
  const executed = results.filter((result) => result.status === "executed" || result.status === "closed").length;
  const failed = results.filter((result) => result.status === "failed").length;
  if (tradeEvent.action === "OPEN" && !hasStopLossProtection(tradeEvent)) {
    console.warn(
      `[CopyTrade] ${tradeEvent.action} ${tradeEvent.symbol}: bot payload did not include stopLossPrice/stopLoss/atrStopLoss. Follower dashboard will show stop data as pending.`
    );
  }
  console.log(
    `[CopyTrade] ${tradeEvent.action} ${tradeEvent.symbol}: ${executed} executed, ${failed} failed, ${results.length} total.`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
