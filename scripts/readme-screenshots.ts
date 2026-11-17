// Screenshots for the README, from the demo screens (made-up players, demo pack).
// Usage: node scripts/readme-screenshots.ts [baseUrl]   (needs `npx vite preview`)
// Writes docs/screenshots/*.png; regenerate after visible UI changes.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:4173/";
const out = "docs/screenshots";
mkdirSync(out, { recursive: true });

const PHONE = { width: 390, height: 844 };
const SHOTS: { name: string; design: string; demo: string; scheme: "light" | "dark"; viewport?: { width: number; height: number } }[] = [
  { name: "home", design: "kartoteka", demo: "home", scheme: "light" },
  { name: "pick", design: "kartoteka", demo: "play", scheme: "light" },
  { name: "answer", design: "kartoteka", demo: "busted", scheme: "light" },
  { name: "room", design: "tabula", demo: "room-pick", scheme: "dark" },
  { name: "order", design: "zvyraznovac", demo: "order", scheme: "light" },
  { name: "over", design: "tlac", demo: "over", scheme: "light" },
  { name: "tv", design: "kartoteka", demo: "tv-reveal", scheme: "light", viewport: { width: 1600, height: 900 } },
];

const browser = await chromium.launch();
for (const s of SHOTS) {
  const ctx = await browser.newContext({ viewport: s.viewport ?? PHONE, colorScheme: s.scheme, deviceScaleFactor: s.viewport ? 1 : 2 });
  const page = await ctx.newPage();
  await page.goto(`${base}?design=${s.design}&demo=${s.demo}`);
  await page.waitForTimeout(500);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `${out}/${s.name}.png` });
  await ctx.close();
}
await browser.close();
console.log(`${SHOTS.length} screenshots → ${out}`);
