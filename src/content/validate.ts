import type { Difficulty, Option, OrderItem, Pack, Question } from "./types.ts";

// Validation shared by scripts/build-packs.ts and the in-app importer.
// Messages are Slovak because the importer shows them to players.

export interface ValidationResult {
  pack: Pack | null;
  errors: string[];
  warnings: string[];
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const AS_OF = /^\d{4}(-(0[1-9]|1[0-2]))?$/;
const LANGS = ["sk", "cs", "en"];
const STALE_YEARS = 2;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

export function validatePack(input: unknown, now: Date = new Date()): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (path: string, msg: string) => errors.push(`${path}: ${msg}`);

  if (!isObj(input)) return { pack: null, errors: ["Balíček musí byť objekt."], warnings };

  const id = str(input.id);
  if (!id || !SLUG.test(id)) err("id", "chýba alebo nie je v tvare malé-písmená-a-pomlčky");
  const title = str(input.title);
  if (!title) err("title", "chýba názov");
  const lang = str(input.lang) ?? "";
  if (!LANGS.includes(lang)) err("lang", `musí byť jedno z: ${LANGS.join(", ")}`);
  const license = str(input.license) ?? "CC0-1.0";
  const adult = input.adult === undefined ? false : input.adult;
  if (typeof adult !== "boolean") err("adult", "musí byť true alebo false");
  const version = input.version === undefined ? 1 : input.version;
  if (!Number.isInteger(version)) err("version", "musí byť celé číslo");

  const questions: Question[] = [];
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    err("questions", "balíček nemá žiadne otázky");
  } else {
    const seen = new Set<string>();
    input.questions.forEach((q, i) => {
      const where = `questions[${i}]${isObj(q) && typeof q.id === "string" ? ` (${q.id})` : ""}`;
      const res = validateQuestion(q, where, now);
      errors.push(...res.errors);
      warnings.push(...res.warnings);
      if (res.question) {
        if (seen.has(res.question.id)) err(where, `duplicitné id "${res.question.id}"`);
        seen.add(res.question.id);
        questions.push(res.question);
      }
    });
  }

  if (errors.length) return { pack: null, errors, warnings };
  const pack: Pack = {
    id: id!,
    title: title!,
    lang,
    license,
    adult: adult as boolean,
    version: version as number,
    questions,
  };
  const description = str(input.description);
  if (description) pack.description = description;
  const author = str(input.author);
  if (author) pack.author = author;
  return { pack, errors, warnings };
}

function validateQuestion(q: unknown, where: string, now: Date) {
  const errors: string[] = [];
  const warnings: string[] = [];
  const err = (msg: string) => errors.push(`${where}: ${msg}`);
  if (!isObj(q)) {
    err("otázka musí byť objekt");
    return { question: null, errors, warnings };
  }

  const id = str(q.id);
  if (!id || !SLUG.test(id)) err("id chýba alebo nie je v tvare malé-písmená-a-pomlčky");
  const prompt = str(q.prompt);
  if (!prompt) err("chýba znenie otázky (prompt)");
  const difficulty = q.difficulty === undefined ? 2 : q.difficulty;
  if (difficulty !== 1 && difficulty !== 2 && difficulty !== 3) err("difficulty musí byť 1, 2 alebo 3");
  const source = str(q.source);
  if (!source) err("chýba zdroj (source)");
  let asOf: string | undefined;
  if (q.asOf !== undefined) {
    asOf = String(q.asOf).trim();
    if (!AS_OF.test(asOf)) err('asOf musí byť v tvare "RRRR" alebo "RRRR-MM"');
    else if (now.getFullYear() - Number(asOf.slice(0, 4)) > STALE_YEARS)
      warnings.push(`${where}: údaj k ${asOf} môže byť zastaraný`);
  }
  const tags = Array.isArray(q.tags) ? q.tags.map(String) : undefined;
  const note = str(q.note) ?? undefined;

  const base = {
    id: id ?? "",
    prompt: prompt ?? "",
    difficulty: difficulty as Difficulty,
    source: source ?? "",
    ...(tags ? { tags } : {}),
    ...(asOf ? { asOf } : {}),
    ...(note ? { note } : {}),
  };

  const options = (v: unknown, label: string): Option[] => {
    if (!Array.isArray(v)) {
      err(`${label} musí byť zoznam možností`);
      return [];
    }
    return v.map((o, j) => option(o, `${label}[${j}]`)).filter((o): o is Option => o !== null);
  };
  const option = (o: unknown, label: string): Option | null => {
    if (typeof o === "string") {
      err(`${label}: možnosť "${o}" nemá vysvetlenie (why)`);
      return null;
    }
    if (!isObj(o)) {
      err(`${label}: možnosť musí mať text a why`);
      return null;
    }
    const text = str(o.text);
    const why = str(o.why);
    if (!text) err(`${label}: chýba text`);
    if (!why) err(`${label}: chýba vysvetlenie (why)`);
    return text && why ? { text, why } : null;
  };
  const noDuplicates = (texts: string[]) => {
    const lower = texts.map((t) => t.toLocaleLowerCase("sk"));
    const dup = lower.find((t, i) => lower.indexOf(t) !== i);
    if (dup) err(`možnosť "${dup}" je tam dvakrát`);
  };

  let question: Question | null = null;
  switch (q.type) {
    case "pick": {
      const correct = options(q.correct, "correct");
      const wrong = options(q.wrong, "wrong");
      if (correct.length < 2) err("pick potrebuje aspoň 2 správne možnosti");
      if (wrong.length < 2) err("pick potrebuje aspoň 2 nesprávne možnosti");
      if (correct.length + wrong.length < 10) err("pick potrebuje spolu aspoň 10 možností");
      noDuplicates([...correct, ...wrong].map((o) => o.text));
      question = { ...base, type: "pick", correct, wrong };
      break;
    }
    case "order": {
      const items: OrderItem[] = [];
      if (!Array.isArray(q.items)) err("order potrebuje zoznam items");
      else
        q.items.forEach((it, j) => {
          if (!isObj(it)) return err(`items[${j}] musí mať text a value`);
          const text = str(it.text);
          const value = it.value;
          if (!text) err(`items[${j}]: chýba text`);
          if (typeof value !== "number" || !Number.isFinite(value)) err(`items[${j}]: value musí byť číslo`);
          if (text && typeof value === "number") {
            const item: OrderItem = { text, value };
            const label = str(it.label);
            const why = str(it.why);
            if (label) item.label = label;
            if (why) item.why = why;
            items.push(item);
          }
        });
      if (items.length < 4) err("order potrebuje aspoň 4 položky");
      const values = items.map((i) => i.value);
      if (new Set(values).size !== values.length) err("order: hodnoty sa nesmú opakovať");
      noDuplicates(items.map((i) => i.text));
      const direction = q.direction === undefined ? "desc" : q.direction;
      if (direction !== "asc" && direction !== "desc") err("direction musí byť asc alebo desc");
      const unit = str(q.unit) ?? undefined;
      question = {
        ...base,
        type: "order",
        direction: direction as "asc" | "desc",
        items,
        ...(unit ? { unit } : {}),
      };
      break;
    }
    case "number": {
      const answer = q.answer;
      if (typeof answer !== "number" || !Number.isFinite(answer)) err("answer musí byť číslo");
      const scale = q.scale ?? "linear";
      if (scale !== "linear" && scale !== "log") err("scale musí byť linear alebo log");
      if (scale === "log" && typeof answer === "number" && answer <= 0) err("scale log potrebuje kladnú odpoveď");
      const tolerance = q.tolerance;
      if (typeof tolerance !== "number" || !(tolerance > 0)) err("tolerance musí byť kladné číslo");
      if (scale === "log" && typeof tolerance === "number" && tolerance >= 1)
        err("pri scale log je tolerance podiel, napr. 0.1 = 10 %");
      const why = str(q.why);
      if (!why) err("chýba vysvetlenie (why)");
      const unit = str(q.unit) ?? undefined;
      question = {
        ...base,
        type: "number",
        answer: answer as number,
        scale: scale as "linear" | "log",
        tolerance: tolerance as number,
        why: why ?? "",
        ...(unit ? { unit } : {}),
      };
      break;
    }
    case "choice": {
      const correct = option(q.correct, "correct");
      const wrong = options(q.wrong, "wrong");
      if (wrong.length < 3) err("choice potrebuje aspoň 3 nesprávne možnosti");
      if (correct) noDuplicates([correct, ...wrong].map((o) => o.text));
      question = correct ? { ...base, type: "choice", correct, wrong } : null;
      break;
    }
    default:
      err(`neznámy typ "${String(q.type)}" (pick, order, number, choice)`);
  }

  return { question: errors.length ? null : question, errors, warnings };
}
