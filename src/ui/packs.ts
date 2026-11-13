import type { Pack, PackMeta } from "../content/types.ts";
import { validatePack } from "../content/validate.ts";

export interface LoadedPack {
  pack: Pack;
  imported: boolean;
}

const BASE = import.meta.env.BASE_URL;

export async function loadBuiltInPacks(): Promise<Pack[]> {
  const res = await fetch(`${BASE}packs/index.json`);
  if (!res.ok) throw new Error(`index.json: ${res.status}`);
  const index = (await res.json()) as PackMeta[];
  return Promise.all(
    index.map(async (m) => {
      const r = await fetch(`${BASE}packs/${m.file}`);
      if (!r.ok) throw new Error(`${m.file}: ${r.status}`);
      return (await r.json()) as Pack;
    }),
  );
}

export interface ImportResult {
  pack: Pack | null;
  errors: string[];
  warnings: string[];
}

/** Parses a YAML or JSON pack file and validates it. */
export async function parsePackFile(name: string, text: string): Promise<ImportResult> {
  let data: unknown;
  try {
    if (/\.json$/i.test(name) || text.trimStart().startsWith("{")) data = JSON.parse(text);
    else {
      const { parse } = await import("yaml");
      data = parse(text);
    }
  } catch (e) {
    return { pack: null, errors: [`Súbor sa nedá prečítať: ${(e as Error).message}`], warnings: [] };
  }
  return validatePack(data);
}
