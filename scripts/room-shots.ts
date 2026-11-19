// A manageable set of room screenshots for review: phone and big screen, all designs in
// light mode, plus dark mode for the key screens. Usage: node scripts/room-shots.ts <outDir>
// Needs a running server (BASE_URL, default http://localhost:4174/).
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const [outDir = "room-shots"] = process.argv.slice(2);
const base = process.env.BASE_URL ?? "http://localhost:4174/";
mkdirSync(outDir, { recursive: true });
const DESIGNS = ["kartoteka", "tabula", "tlac", "zvyraznovac"];
const LIGHT = ["room-lobby", "room-packpick", "room-pick", "room-number", "room-choice", "room-order", "room-reveal", "room-tiebreak", "room-tiebreak-reveal", "room-over", "tv-question", "tv-reveal", "tv-tiebreak", "tv-over"];
const KEY = ["room-pick", "room-reveal", "room-tiebreak-reveal", "tv-reveal", "tv-over"];
// The default design gets every screen, the others the key ones.
const screensFor = (d: string, scheme: string) => (scheme === "light" ? (d === DESIGNS[0] ? LIGHT : KEY) : d === DESIGNS[0] ? KEY : KEY.slice(1, 4).slice(0, 2));
const errors: string[] = [];
const browser = await chromium.launch();
let n = 0;
for (const scheme of ["light", "dark"] as const) {
  for (const d of DESIGNS) {
    for (const s of screensFor(d, scheme)) {
      const tv = s.startsWith("tv-");
      const ctx = await browser.newContext({ viewport: tv ? { width: 1280, height: 720 } : { width: 390, height: 844 }, colorScheme: scheme });
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`${d}/${s}: ${e.message}`));
      await page.goto(`${base}?design=${d}&demo=${s}`);
      await page.waitForTimeout(400);
      await page.evaluate(() => document.fonts.ready);
      if (!tv && (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth))) errors.push(`${d}/${s}/${scheme}: horizontal overflow`);
      await page.screenshot({ path: join(outDir, `${d}-${s}-${scheme}.png`), fullPage: !tv });
      await ctx.close();
      n++;
    }
  }
}
await browser.close();
console.log(`${n} screenshots → ${outDir}`);
if (errors.length) console.log(errors.join("\n"));
