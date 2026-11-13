import type { Card } from "../engine/cards.ts";

export const REPO_URL = "https://github.com/TomasHutnan/fakt";

// GitHub caps the URL of a prefilled issue (~8 kB); keep bodies well under it.
const MAX_BODY = 6000;

export function issueUrl(title: string, body: string): string {
  const b = body.length > MAX_BODY ? `${body.slice(0, MAX_BODY)}\n…` : body;
  return `${REPO_URL}/issues/new?${new URLSearchParams({ title, body: b })}`;
}

/** Prefilled issue for one card: pack, question id, pack version and what was shown. */
export function reportUrl(card: Card): string {
  const lines = [
    `**Otázka:** ${card.prompt}`,
    `**Balíček:** ${card.packTitle} (\`${card.key}\`${card.packVersion != null ? `, verzia ${card.packVersion}` : ""})`,
  ];
  if (card.type === "pick" || card.type === "choice") {
    lines.push("", "**Možnosti na karte:**", ...card.options.map((o) => `- ${o.correct ? "✓" : "✗"} ${o.text}`));
  }
  lines.push("", "**Čo je zle:**", "");
  return issueUrl(`Otázka ${card.key}`, lines.join("\n"));
}
