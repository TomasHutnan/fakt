// Plays full games through the real UI. Usage: node scripts/e2e.ts [baseUrl]
// Needs a running server (npm run build && npx vite preview).
import { chromium, type Page } from "playwright";

const base = process.argv[2] ?? "http://localhost:4173/";
const browser = await chromium.launch();
const errors: string[] = [];
let compareCards = 0;
let reportLinks = 0;

async function playGame(page: Page, mode: "Klasika" | "Mix", players: string[], revealEach: boolean) {
  await page.goto(base);
  await page.evaluate(() => localStorage.clear());
  await page.goto(base);
  if (!revealEach) {
    await page.getByRole("button", { name: "Nastavenia" }).click();
    await page.getByRole("button", { name: "Všetkým po kole" }).click();
    await page.locator(".topbar .btn").first().click();
  }
  await page.getByRole("button", { name: "Nová hra" }).click();
  // Set players
  const inputs = page.locator(".player-row input");
  while ((await inputs.count()) > players.length) await page.locator(".player-row .btn--icon").last().click();
  while ((await inputs.count()) < players.length) await page.getByRole("button", { name: /Pridať hráča/ }).click();
  for (let i = 0; i < players.length; i++) await inputs.nth(i).fill(players[i]);
  await page.getByRole("button", { name: mode, exact: true }).click();
  await page.getByRole("button", { name: "5 kôl" }).click();
  await page.getByRole("button", { name: "Začať hru" }).click();

  for (let step = 0; step < 400; step++) {
    if (await page.locator(".screen--over").count()) return;
    if (await page.locator(".handover").count()) {
      await page.locator(".handover").click();
      continue;
    }
    if (await page.locator(".turnend").count()) {
      const report = page.locator(".q__source a", { hasText: "Nahlásiť chybu" });
      if (await report.count()) {
        const href = (await report.getAttribute("href")) ?? "";
        if (!/\/issues\/new\?title=/.test(href)) errors.push(`bad report link: ${href}`);
        reportLinks++;
      }
      await page.locator(".turnend .btn--primary").click();
      continue;
    }
    if (await page.locator(".q--reveal").count()) {
      await page.locator(".q--reveal .actions .btn--primary").click();
      continue;
    }
    const pick = page.locator(".q--pick .options button.opt:not([disabled])");
    if (await page.locator(".q--pick").count()) {
      const bank = page.locator(".q--pick .actions .btn--primary");
      if ((await bank.count()) && (await bank.isEnabled()) && Math.random() < 0.4) await bank.click();
      else await pick.nth(Math.floor(Math.random() * (await pick.count()))).click();
      continue;
    }
    if (await page.locator(".q--order:not(.q--reveal) .order-item--draggable").count()) {
      if (Math.random() < 0.5) await page.locator(".order-item .btn--icon:not([disabled])").first().click();
      else await dragFirstToLast(page);
      await page.locator(".q--order .actions .btn--primary").click();
      continue;
    }
    if (await page.locator(".q--number").count()) {
      await page.locator("#number-guess").fill(String(Math.round(Math.random() * 3000)));
      await page.locator(".q--number .actions .btn--primary").click();
      continue;
    }
    if (await page.locator(".q--choice").count()) {
      const opts = page.locator(".q--choice .options button.opt");
      if (await page.locator(".options--compare").count()) compareCards++;
      await opts.nth(Math.floor(Math.random() * (await opts.count()))).click();
      continue;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`${mode}: game did not finish`);
}

// Drags the first row below the last one and checks it moved.
async function dragFirstToLast(page: Page) {
  const items = page.locator(".order-item--draggable");
  const first = (await items.first().locator(".order-item__text").textContent()) ?? "";
  const a = (await items.first().locator(".order-item__text").boundingBox())!;
  const b = (await items.last().boundingBox())!;
  await page.mouse.move(a.x + 5, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(a.x + 5, a.y + ((b.y + b.height + 4 - a.y) * i) / 10);
  await page.mouse.up();
  const last = (await items.last().locator(".order-item__text").textContent()) ?? "";
  if (last !== first) errors.push(`drag did not move "${first}" to the end (last is "${last}")`);
}

for (const [mode, players, revealEach] of [
  ["Klasika", ["Ana", "Bo", "Cyril"], true],
  ["Mix", ["Ana", "Bo"], true],
  ["Mix", ["Ana", "Bo", "Cyril"], false],
  ["Mix", ["Sólo"], true],
  ["Mix", ["Sólo"], false],
  ["Klasika", ["Sólo"], true],
] as const) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => errors.push(`${mode}/${players.length}: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`${mode}/${players.length} console: ${m.text()}`));
  await playGame(page, mode, [...players], revealEach);
  const title = await page.locator(".over__title").textContent();
  console.log(`✓ ${mode} with ${players.length} player(s), answers ${revealEach ? "per turn" : "after round"}: ${title}`);
  await page.close();
}
// Game over: rate a card, then quick start from Home with the same players.
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", (e) => errors.push(`review: ${e.message}`));
  await playGame(page, "Klasika", ["Ana", "Bo"], true);
  await page.locator(".review__btn").first().click();
  const send = page.locator(".review a.btn");
  const href = (await send.getAttribute("href")) ?? "";
  if (!href.includes("issues/new") || !decodeURIComponent(href).includes("👍")) errors.push(`bad review link: ${href}`);
  await page.getByRole("button", { name: "Domov" }).click();
  await page.getByRole("button", { name: /Rýchla hra/ }).click();
  if (!(await page.locator(".handover").count())) errors.push("quick start did not start a game");
  const round = (await page.locator(".handover__round").textContent()) ?? "";
  if (!round.includes("/ 5")) errors.push(`quick start round label: ${round}`);
  console.log("✓ review link and quick start");
  await page.close();
}
await browser.close();
console.log(`compare cards seen: ${compareCards}, report links checked: ${reportLinks}`);
if (!reportLinks) errors.push("no report link seen");
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
