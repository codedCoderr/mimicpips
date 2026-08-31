function escapeTelegramHtml(text: string): string {
  return text.replace(/[&<>]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[char] ?? char));
}

function compactText(text: string, max = 230): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  const sentenceEnd = trimmed.slice(0, max).lastIndexOf(". ");
  if (sentenceEnd > 90) return trimmed.slice(0, sentenceEnd + 1);
  return `${trimmed.slice(0, max - 3).trim()}...`;
}

function splitSummary(summary: string): { happened: string; meaning: string } {
  const clean = summary.replace(/\s+/g, " ").trim();
  const [first, ...rest] = clean.split(/(?<=\.)\s+/);
  const happened = first || clean;
  const meaning = rest.join(" ") || "Risk remains visible, performance is reported plainly, and no result is presented as guaranteed.";

  return {
    happened: compactText(happened, 230),
    meaning: compactText(
      meaning
        .replace(/^This should be communicated plainly:\s*/i, "")
        .replace(/^The useful story is not only the gain;\s*/i, ""),
      210
    ),
  };
}

export function formatTelegramMarketingSignal(event: {
  type: string;
  title: string;
  summary: string;
  metricLabel?: string;
  metricValue?: string;
}): string {
  const label = escapeTelegramHtml(event.type.replace(/_/g, " ").toUpperCase());
  const title = escapeTelegramHtml(event.title);
  const { happened, meaning } = splitSummary(event.summary);
  const metricLabel = escapeTelegramHtml(event.metricLabel || "Signal");
  const metricValue = event.metricValue ? escapeTelegramHtml(event.metricValue) : "";

  const lines = [
    "<b>MIMIC PIPS</b>",
    `Signal type: ${label}`,
    "",
    `<b>${title}</b>`,
    "",
    "<b>What happened</b>",
    escapeTelegramHtml(happened),
    "",
    "<b>What this means</b>",
    escapeTelegramHtml(meaning),
  ];

  if (metricValue) {
    lines.push(
      "",
      "<b>Snapshot</b>",
      `${metricLabel}: <b>${metricValue}</b>`
    );
  }

  lines.push(
    "",
    "<b>Controls</b>",
    "• Risk Guard active",
    "• Copy engine monitoring",
    "• Rules enforced",
    "",
    "<i>Risk note: Futures trading is high risk. This is not financial advice or a promise of returns.</i>"
  );

  return lines.join("\n");
}
