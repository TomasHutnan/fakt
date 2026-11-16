// Sections of the pack list and the pack search. Pure, so it can be tested without the UI.
import { CATEGORIES, type Pack } from "../content/types.ts";
import { sk } from "./sk.ts";

export interface PackGroup {
  id: string;
  label: string;
  packs: Pack[];
}

const collator = new Intl.Collator("sk");

/** Imported packs first, then topic sections in CATEGORIES order, packs without one, and 18+ last. */
export function groupPacks(packs: Pack[], importedIds: string[]): PackGroup[] {
  const sectionOf = (p: Pack): string =>
    importedIds.includes(p.id) ? "imported" : p.adult ? "adult" : (p.category ?? "other");
  const order = ["imported", ...CATEGORIES, "other", "adult"];
  const label = (id: string): string =>
    id === "imported"
      ? sk.groupImported
      : id === "adult"
        ? sk.groupAdult
        : id === "other"
          ? sk.groupOther
          : sk.categories[id as keyof typeof sk.categories];
  return order
    .map((id) => ({
      id,
      label: label(id),
      packs: packs.filter((p) => sectionOf(p) === id).sort((a, b) => collator.compare(a.title, b.title)),
    }))
    .filter((g) => g.packs.length > 0);
}

/** Lower case without diacritics, so "skola" finds "Školské minimum". */
export const fold = (s: string): string => s.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("sk");

/** Packs whose title, description or section name contain every word of the query. */
export function searchPacks(groups: PackGroup[], query: string): Pack[] {
  // Slovak endings vary (škola, školy, školské): trailing vowels are dropped when 3+ letters remain.
  const words = fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.replace(/[aeiouy]+$/, "").length >= 3 ? w.replace(/[aeiouy]+$/, "") : w));
  if (!words.length) return [];
  return groups.flatMap((g) =>
    g.packs.filter((p) => {
      const text = fold([p.title, p.description ?? "", g.label].join(" "));
      return words.every((w) => text.includes(w));
    }),
  );
}
