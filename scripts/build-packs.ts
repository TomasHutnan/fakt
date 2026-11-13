// Validates packs/*.yaml and writes public/packs/<id>.json plus index.json.
// Usage: node scripts/build-packs.ts [--check] [file ...]
//   --check  validate only, write nothing
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { validatePack } from "../src/content/validate.ts";
import type { PackMeta, QuestionType } from "../src/content/types.ts";

const args = process.argv.slice(2);
const check = args.includes("--check");
const only = args.filter((a) => !a.startsWith("--"));
const root = join(import.meta.dirname, "..");
const srcDir = join(root, "packs");
const outDir = join(root, "public", "packs");

const files = only.length
  ? only
  : readdirSync(srcDir)
      .filter((f) => /\.ya?ml$/.test(f))
      .sort()
      .map((f) => join(srcDir, f));

let failed = 0;
const index: PackMeta[] = [];
const outputs: [string, string][] = [];
const ids = new Set<string>();

for (const file of files) {
  const name = basename(file);
  let data: unknown;
  try {
    data = parse(readFileSync(file, "utf8"));
  } catch (e) {
    console.error(`✗ ${name}: YAML error: ${(e as Error).message}`);
    failed++;
    continue;
  }
  const { pack, errors, warnings } = validatePack(data);
  for (const w of warnings) console.warn(`  ! ${name}: ${w}`);
  if (!pack) {
    console.error(`✗ ${name}`);
    for (const e of errors) console.error(`    ${e}`);
    failed++;
    continue;
  }
  if (ids.has(pack.id)) {
    console.error(`✗ ${name}: pack id "${pack.id}" is used by another file`);
    failed++;
    continue;
  }
  ids.add(pack.id);
  const json = JSON.stringify(pack);
  const hash = createHash("sha256").update(json).digest("hex").slice(0, 12);
  const counts = { pick: 0, order: 0, number: 0, choice: 0 } as Record<QuestionType, number>;
  for (const q of pack.questions) counts[q.type]++;
  const { questions, ...meta } = pack;
  index.push({ ...meta, count: questions.length, counts, hash, file: `${pack.id}.${hash}.json` });
  outputs.push([`${pack.id}.${hash}.json`, json]);
  console.log(`✓ ${name}: ${questions.length} questions (${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")})`);
}

const total = index.reduce((n, p) => n + p.count, 0);
console.log(`${index.length} packs, ${total} questions${failed ? `, ${failed} failed` : ""}`);

if (failed) process.exit(1);
if (!check && !only.length) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  for (const [f, json] of outputs) writeFileSync(join(outDir, f), json);
  writeFileSync(join(outDir, "index.json"), JSON.stringify(index));
}
