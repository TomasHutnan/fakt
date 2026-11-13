// Pack format. Source files are YAML in packs/, built to JSON in public/packs/.
// The same shape is accepted by the in-app importer (YAML or JSON).

export type Difficulty = 1 | 2 | 3;

export interface Option {
  text: string;
  /** One line: why this option is right or wrong. */
  why: string;
}

export interface OrderItem {
  text: string;
  value: number;
  /** Optional display of the value, e.g. "2 655 m". Defaults to value + unit. */
  label?: string;
  why?: string;
}

interface QuestionBase {
  id: string;
  prompt: string;
  difficulty: Difficulty;
  tags?: string[];
  /** URL or a short citation. Required. */
  source: string;
  /** YYYY or YYYY-MM. Required for facts that change over time. */
  asOf?: string;
  /** Optional extra fact shown after the card. */
  note?: string;
}

/** Many options, some true. The game shows 10 with 2–8 true. */
export interface PickQuestion extends QuestionBase {
  type: "pick";
  correct: Option[];
  wrong: Option[];
}

/** Arrange items by value. */
export interface OrderQuestion extends QuestionBase {
  type: "order";
  /** desc = highest first (default). */
  direction?: "asc" | "desc";
  unit?: string;
  items: OrderItem[];
}

/** Type a number; closeness scores. */
export interface NumberQuestion extends QuestionBase {
  type: "number";
  answer: number;
  unit?: string;
  /** linear = absolute error (years), log = relative error (populations). */
  scale: "linear" | "log";
  /** linear: absolute units for full points; log: relative fraction (0.1 = 10 %). */
  tolerance: number;
  why: string;
}

/** One correct of four (or more). */
export interface ChoiceQuestion extends QuestionBase {
  type: "choice";
  correct: Option;
  wrong: Option[];
}

export type Question = PickQuestion | OrderQuestion | NumberQuestion | ChoiceQuestion;
export type QuestionType = Question["type"];

export const CONTENT_WARNINGS = ["vulgar", "sexual", "drugs", "dark-humor", "racism", "abuse"] as const;
export type ContentWarning = (typeof CONTENT_WARNINGS)[number];

export interface Pack {
  id: string;
  title: string;
  description?: string;
  /** sk | cs | en */
  lang: string;
  /** SPDX id, default CC0-1.0 */
  license: string;
  adult: boolean;
  /** Content warnings shown on the pack, see CONTENT_WARNINGS. */
  warnings?: ContentWarning[];
  version: number;
  author?: string;
  questions: Question[];
}

/** Entry in public/packs/index.json */
export interface PackMeta {
  id: string;
  title: string;
  description?: string;
  lang: string;
  license: string;
  adult: boolean;
  warnings?: ContentWarning[];
  version: number;
  count: number;
  counts: Record<QuestionType, number>;
  hash: string;
  file: string;
}
