import type { Card } from "../engine/cards.ts";

export const REPO_URL = "https://github.com/TomasHutnan/fakt";

// Reports go to a Google Form (no account needed). Field ids from the owner's prefilled link.
const FORM_URL = "https://docs.google.com/forms/d/e/1FAIpQLScDquWAxCQQ_4CbRyajF6npX8sKzrcmCUiZQ5iHpu0FceSSGw/viewform";
const FIELD = {
  key: "entry.395949983",
  version: "entry.808986666",
  question: "entry.265971660",
  ratings: "entry.295936394",
  problem: "entry.1415300164",
  comment: "entry.1837133220",
} as const;
type Fields = Partial<Record<keyof typeof FIELD, string>>;

/** Problem types as the form lists them; "other" is the form's own "Iné" choice. */
export const PROBLEMS = {
  fact: "Nesprávny fakt",
  unclear: "Príliš nejasné alebo mätúce",
  boring: "Nuda",
  other: "__other_option__",
} as const;
export type Problem = keyof typeof PROBLEMS;

// Long prefilled URLs can fail; drop whole lines from the end of the longest field until it fits.
const MAX_URL = 7000;

function formUrl(fields: Fields, trim?: keyof typeof FIELD): string {
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

/** What a report or rating says about one card. */
export interface CardRef {
  key: string;
  version?: number;
  /** The question, with the options shown where there are any. */
  question: string;
}

export function cardRef(card: Card): CardRef {
  const lines = [card.prompt];
  if (card.type === "pick" || card.type === "choice") {
    lines.push(...card.options.map((o) => `${o.correct ? "✓" : "✗"} ${o.text}`));
  }
  return { key: card.key, version: card.packVersion, question: lines.join("\n") };
}

function refFields(ref: CardRef): Fields {
  return { key: ref.key, version: ref.version != null ? String(ref.version) : "", question: ref.question };
}

/** Report form for one card, prefilled (fallback when sending in the background fails). */
export function reportUrl(ref: CardRef): string {
  return formUrl(refFields(ref), "question");
}

export function reportFields(ref: CardRef, problem: Problem | null, comment: string): Fields {
  return { ...refFields(ref), problem: problem ? PROBLEMS[problem] : "", comment: comment.trim() };
}

/** One rated card: the rating as an icon, plus the card. */
export function ratingFields(ref: CardRef, icon: string): Fields {
  return { ...refFields(ref), ratings: icon };
}

const POST_URL = FORM_URL.replace(/\/viewform$/, "/formResponse");
const MAX_FIELD = 4000;

/**
 * Sends a form response in the background, without leaving the app. Google Forms
 * allows no CORS, so the response is opaque: true means it went out, false that
 * the network failed (offline). keepalive lets it finish when the page closes.
 */
export async function sendForm(fields: Fields): Promise<boolean> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) if (v) body.set(FIELD[k as keyof typeof FIELD], v.slice(0, MAX_FIELD));
  if (fields.problem === PROBLEMS.other) body.set(`${FIELD.problem}.other_option_response`, "iné");
  try {
    await fetch(POST_URL, { method: "POST", mode: "no-cors", body, keepalive: true });
    return true;
  } catch {
    return false;
  }
}

/** The report form with nothing filled in (Settings). */
export const REPORT_FORM_URL = FORM_URL;
