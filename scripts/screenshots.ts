// Screenshots of every design × demo screen, light and dark, at phone size.
// Usage: node scripts/screenshots.ts <outDir> [designId ...]
// Needs a running server: npm run preview (http://localhost:4173) or URL in env BASE_URL.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";

const SCREENS = ["home", "setup", "handover", "play", "busted", "order", "number", "choice", "compare", "answer", "reveal", "over", "packs", "settings", "rules"];
const [outDir = "screenshots", ...only] = process.argv.slice(2);
const base = process.env.BASE_URL ?? "http://localhost:4173/";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const designs: string[] = only.length
  ? only
  : await (async () => {
      const page = await browser.newPage();
      await page.goto(`${base}#designs`);
      await page.waitForSelector(".gallery__item");
      const ids = await page.$$eval(".gallery__caption a", (as) =>
        as.map((a) => new URL((a as HTMLAnchorElement).href).searchParams.get("design")!),
      );
      await page.close();
      return ids;
    })();

const errors: string[] = [];
for (const scheme of ["light", "dark"] as const) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, colorScheme: scheme });
  for (const d of designs) {
    for (const s of SCREENS) {
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(`${d}/${s}: ${e.message}`));
      await page.goto(`${base}?design=${d}&demo=${s}`);
      await page.waitForTimeout(400);
      await page.evaluate(() => document.fonts.ready);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      if (overflow) errors.push(`${d}/${s}/${scheme}: horizontal overflow`);
      await page.screenshot({ path: join(outDir, `${d}-${s}-${scheme}.png`), fullPage: true });
      await page.close();
    }
  }
  await ctx.close();
}
await browser.close();
console.log(`${designs.length} designs × ${SCREENS.length} screens × 2 schemes → ${outDir}`);
if (errors.length) console.log(errors.join("\n"));
