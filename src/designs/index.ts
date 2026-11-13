// Each design lives in src/designs/<id>/ with:
//   meta.ts    export default { id, name, description, themeColor } satisfies DesignMeta
//   design.css every rule scoped under :root[data-design="<id>"]
// See src/designs/README.md for the class vocabulary.

export interface DesignMeta {
  id: string;
  name: string;
  description: string;
  /** Colour for the browser toolbar / PWA theme. */
  themeColor: string;
}

export const DEFAULT_DESIGN = "zaklad";

const metas = import.meta.glob<DesignMeta>("./*/meta.ts", { eager: true, import: "default" });
import.meta.glob("./*/design.css", { eager: true });

export const DESIGNS: DesignMeta[] = Object.values(metas).sort((a, b) =>
  a.id === DEFAULT_DESIGN ? -1 : b.id === DEFAULT_DESIGN ? 1 : a.name.localeCompare(b.name, "sk"),
);

export function applyDesign(id: string): string {
  const meta = DESIGNS.find((d) => d.id === id) ?? DESIGNS.find((d) => d.id === DEFAULT_DESIGN) ?? DESIGNS[0];
  if (!meta) return id;
  document.documentElement.dataset.design = meta.id;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", meta.themeColor);
  return meta.id;
}
