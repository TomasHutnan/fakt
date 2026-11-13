import type { Card } from "../engine/cards.ts";

export const REPO_URL = "https://github.com/TomasHutnan/fakt";

// Reports go to a Google Form (no account needed). Field ids from the owner's prefilled link.
const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScDquWAxCQQ_4CbRyajF6npX8sKzrcmCUiZQ5iHpu0FceSSGw/viewform";
const FIELD = {
  key: "entry.395949983",
  version: "entry.808986666",
  question: "entry.265971660",
  ratings: "entry.295936394",
} as const;

// Long prefilled URLs can fail; drop whole lines from the end of the longest field until it fits.
const MAX_URL = 7000;

function formUrl(fields: Partial<Record<keyof typeof FIELD, string>>, trim?: keyof typeof FIELD): string {
  const url = (f: typeof fields) => {
    const params = new URLSearchParams({ usp: "pp_url" });
    for (const [k, v] of Object.entries(f)) if (v) params.set(FIELD[k as keyof typeof FIELD], v);
    return `${FORM_URL}?${params}`;
  };
  let out = url(fields);
  if (!trim || !fields[trim]) return out;
  const lines = fields[trim]!.split("\n");
  while (out.length > MAX_URL && lines.length > 1) {
    lines.pop();
    out = url({ ...fields, [trim]: `${lines.join("\n")}\n…` });
  }
  return out;
}

/** Report form for one card: key, pack version, and the question with the options shown. */
export function reportUrl(card: Card): string {
  const lines = [card.prompt];
  if (card.type === "pick" || card.type === "choice") {
    lines.push(...card.options.map((o) => `${o.correct ? "✓" : "✗"} ${o.text}`));
  }
  return formUrl(
    {
      key: card.key,
      version: card.packVersion != null ? String(card.packVersion) : "",
      question: lines.join("\n"),
    },
    "question",
  );
}

/** Ratings form after a game: one line per rated card. */
export function ratingsUrl(lines: string[]): string {
  return formUrl({ ratings: lines.join("\n") }, "ratings");
}

/** The report form with nothing filled in (Settings). */
export const REPORT_FORM_URL = FORM_URL;
