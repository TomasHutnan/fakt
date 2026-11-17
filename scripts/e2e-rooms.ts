// Plays full room games through the real UI: one host phone, two more phones that join
// by link, and a big screen. Usage: node scripts/e2e-rooms.ts [baseUrl] [shotDir]
// Needs the Node server with the built app (npm run build && npm start), with relaxed
// creation limits for repeated runs, e.g. FAKT_ROOMS_PER_IP=50 FAKT_CREATES_PER_10MIN=100.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const base = process.argv[2] ?? "http://localhost:8080/";
const shots = process.argv[3] ?? "";
if (shots) mkdirSync(shots, { recursive: true });
const browser = await chromium.launch();
const errors: string[] = [];
const log = (...a: unknown[]) => console.log(...a);

async function phone(b: Browser, label: string, viewport = { width: 390, height: 844 }): Promise<Page> {
  const ctx = await b.newContext({ viewport });
  // Reports and ratings never reach the real form.
  await ctx.route("https://docs.google.com/forms/**", (r) => r.fulfill({ status: 200, body: "" }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/WebSocket|ERR_NETWORK_CHANGED|net::ERR/.test(m.text())) errors.push(`${label} console: ${m.text()}`);
  });
  return page;
}

async function createRoom(host: Page, mode: "Mix" | "Klasika", pace: string, rounds: string): Promise<string> {
  await host.goto(base);
  await host.evaluate(() => localStorage.clear());
  await host.goto(base);
  await host.getByRole("button", { name: "Nová hra" }).click();
  await host.getByRole("button", { name: "Každý na svojom" }).click();
  await host.locator("#room-name").fill("Jano");
  await host.getByRole("button", { name: mode, exact: true }).click();
  await host.getByRole("button", { name: rounds }).click();
  await host.getByRole("button", { name: pace, exact: true }).click();
  await host.getByRole("button", { name: "Vytvoriť hru" }).click();
  await host.locator(".room-code").waitFor();
  return (await host.locator(".room-code").textContent())!.trim();
}

async function joinByLink(p: Page, code: string, name: string) {
  await p.goto(base);
  await p.evaluate(() => localStorage.clear());
  await p.goto(`${base}?r=${code}`);
  await p.locator("#join-name").fill(name);
  if ((await p.locator("#join-code").inputValue()) !== code) errors.push(`${name}: code not prefilled`);
  await p.getByRole("button", { name: "Vstúpiť" }).click();
  await p.locator(".screen--lobby").waitFor();
}

/** One step for one phone on whatever its screen shows; returns false when nothing to do. */
let packPicks = 0;
let socialLines = 0;

async function step(p: Page): Promise<boolean> {
  if (await p.locator(".screen--over").count()) return false;
  const pack = p.locator(".q--packpick button.opt:not([disabled])");
  if (await pack.count()) {
    packPicks++;
    await pack.last().click();
    return true;
  }
  if (await p.locator(".q--packpick").count()) return false;
  const reveal = p.locator(".q--reveal .actions .btn--primary:not([disabled])");
  if (await reveal.count()) {
    socialLines += await p.locator(".social__line").count();
    await reveal.click();
    return true;
  }
  if (await p.locator(".q--reveal").count()) return false;
  const pick = p.locator(".q--pick .options button.opt:not([disabled])");
  if (await p.locator(".q--pick").count()) {
    if (await p.locator(".q--pick .verdict").count()) return false;
    const bank = p.locator(".q--pick .actions .btn--primary");
    if ((await bank.count()) && (await bank.isEnabled()) && Math.random() < 0.4) await bank.click();
    else if (await pick.count()) await pick.nth(Math.floor(Math.random() * (await pick.count()))).click();
    return true;
  }
  if (await p.locator(".q--order .order-item--draggable").count()) {
    await p.locator(".order-item .btn--icon:not([disabled])").first().click();
    await p.locator(".q--order .actions .btn--primary").click();
    return true;
  }
  if (await p.locator(".q--number #number-guess").count()) {
    await p.locator("#number-guess").fill(String(Math.floor(Math.random() * 1000) + 1));
    await p.locator(".q--number .actions .btn--primary").click();
    return true;
  }
  const choice = p.locator(".q--choice .options button.opt:not([disabled])");
  if (await choice.count()) {
    await choice.nth(Math.floor(Math.random() * (await choice.count()))).click();
    return true;
  }
  return false;
}

async function scores(p: Page): Promise<string> {
  return (await p.locator(".scoreboard").innerText()).replace(/\s+/g, " ");
}

async function playRoom(mode: "Mix" | "Klasika", pace: string) {
  const host = await phone(browser, "host");
  const zuzka = await phone(browser, "zuzka");
  const miro = await phone(browser, "miro");
  const tv = await phone(browser, "tv", { width: 1920, height: 1080 });
  /** The big screen must never need scrolling by hand. */
  const tvFits = async (where: string) => {
    const over = await tv.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
    if (over > 1) errors.push(`${mode}: tv ${where} scrolls by ${over}px`);
  };

  const code = await createRoom(host, mode, pace, "10 kôl");
  log(`${mode}/${pace}: room ${code}`);

  // Errors on the join screen: unknown code, taken name.
  await zuzka.goto(base);
  await zuzka.getByRole("button", { name: /Pripojiť sa k hre/ }).click();
  await zuzka.locator("#join-code").fill("BBBB");
  await zuzka.locator("#join-name").fill("Zuzka");
  await zuzka.getByRole("button", { name: "Vstúpiť" }).click();
  await zuzka.locator(".error", { hasText: "neexistuje" }).waitFor();
  await zuzka.locator("#join-code").fill(code);
  await zuzka.locator("#join-name").fill("jano");
  await zuzka.getByRole("button", { name: "Vstúpiť" }).click();
  await zuzka.locator(".error", { hasText: "meno" }).waitFor();

  await joinByLink(zuzka, code, "Zuzka");
  await joinByLink(miro, code, "Miro");
  if (mode === "Mix") await tv.goto(`${base}?tv=${code}`);
  else {
    // The same link as the phones: the TV says it is the big screen.
    await tv.goto(`${base}?r=${code}`);
    await tv.getByRole("button", { name: /Toto je veľká obrazovka/ }).click();
  }
  await tv.locator(".screen--tv .room-code").waitFor();
  await tvFits("lobby");
  await host.locator(".room-player", { hasText: "Miro" }).waitFor();
  if ((await tv.locator(".room-player").count()) !== 3) errors.push("tv lobby does not list 3 players");
  if (shots) await tv.screenshot({ path: join(shots, `tv-lobby-${mode}.png`) });
  if (await zuzka.getByRole("button", { name: "Začať hru" }).count()) errors.push("non-host sees the start button");

  await host.getByRole("button", { name: "Začať hru" }).click();
  await tv.locator(".screen--tv-question").waitFor();
  if (shots) await tv.screenshot({ path: join(shots, `tv-question-${mode}.png`) });
  await tvFits("question");

  let reloaded = false;
  let reveals = 0;
  let pauses = 0;
  for (let i = 0; i < 600; i++) {
    const phones = [host, zuzka, miro];
    const did = await Promise.all(phones.map((p) => step(p).catch(() => true)));
    if (await tv.locator(".screen--tv-reveal").count()) {
      if (!reveals++) {
        if (shots) await tv.screenshot({ path: join(shots, `tv-reveal-${mode}.png`) });
        await tvFits("reveal");
        if (pace !== "Bez limitu" && !(await tv.locator(".screen--tv-reveal .timer").count())) errors.push(`${mode}: no timer on the tv reveal`);
        // The host pauses the answers on show, the big screen says so, then it goes on.
        const pause = host.locator(".topbar__pause");
        if (await pause.count()) {
          await pause.click();
          await tv.locator(".screen--tv-reveal .paused").waitFor({ timeout: 3000 }).catch(() => errors.push(`${mode}: tv does not show the pause`));
          await zuzka.locator(".notice", { hasText: "pozastavil" }).waitFor({ timeout: 3000 }).catch(() => errors.push(`${mode}: zuzka does not see the pause`));
          await host.locator(".topbar__pause").click();
          pauses++;
        }
      }
    }
    // Reload a phone in the middle of the game: it must rejoin its seat.
    if (!reloaded && reveals >= 2) {
      reloaded = true;
      await zuzka.reload();
      await zuzka.locator(".screen--room, .screen--over").first().waitFor();
      log("  reloaded Zuzka's phone, back in the room");
    }
    if (await Promise.all(phones.map((p) => p.locator(".screen--over").count())).then((c) => c.every(Boolean))) break;
    if (pace === "Bez limitu" && !did.some(Boolean)) {
      // Everyone waits: the host can end the round.
      const close = host.getByRole("button", { name: "Ukončiť kolo" });
      if (await close.count()) await close.click();
      const nextAll = host.getByRole("button", { name: "Pokračovať bez čakania" });
      if (await nextAll.count()) await nextAll.click();
    }
    await host.waitForTimeout(80);
  }
  for (const p of [host, zuzka, miro]) if (!(await p.locator(".screen--over").count())) errors.push(`${mode}: a phone did not reach the end`);
  await tv.locator(".screen--tv-over").waitFor();
  const table = await scores(host);
  for (const [p, n] of [[zuzka, "zuzka"], [miro, "miro"], [tv, "tv"]] as const) if ((await scores(p)) !== table) errors.push(`${mode}: ${n} sees other scores`);
  log(`  final: ${table}`);
  for (const [p, n] of [[host, "host"], [tv, "tv"]] as const) if (!(await p.locator(".title-row").count())) errors.push(`${mode}: no titles on ${n}`);
  if (shots) await tv.screenshot({ path: join(shots, `tv-over-${mode}.png`) });
  await tvFits("results");
  if (!pauses) errors.push(`${mode}: the host never paused`);

  // Ešte jednu: everyone back in the lobby.
  if (await zuzka.getByRole("button", { name: "Ešte jednu" }).count()) errors.push("non-host sees Ešte jednu");
  await host.getByRole("button", { name: "Ešte jednu" }).click();
  await miro.locator(".screen--lobby").waitFor();
  await tv.locator(".screen--tv-lobby").waitFor();
  // The big screen can always leave.
  await tv.getByRole("button", { name: "Zavrieť" }).click();
  await tv.locator(".screen--home").waitFor();

  // Leaving clears the seat: Home no longer offers to go back.
  await miro.getByRole("button", { name: "Odísť" }).click();
  await miro.getByRole("button", { name: "Áno, odísť" }).click();
  await miro.locator(".screen--home").waitFor();
  if (await miro.getByRole("button", { name: /Späť do hry/ }).count()) errors.push("seat kept after leaving");
  await host.locator(".room-player--away", { hasText: "Miro" }).waitFor();

  // The host removes Miro.
  await host.getByRole("button", { name: "Odstrániť Miro z hry" }).click();
  await host.locator(".room-player", { hasText: "Miro" }).waitFor({ state: "detached" });

  for (const p of [host, zuzka, miro, tv]) await p.context().close();
}

await playRoom("Mix", "Bez limitu");
await playRoom("Klasika", "Rýchlo");
await browser.close();
log(`pack picks: ${packPicks}, social lines: ${socialLines}`);
if (!packPicks) errors.push("no pack pick seen");
if (!socialLines) errors.push("no social line seen");
if (errors.length) {
  console.log(`FAILED:\n${errors.join("\n")}`);
  process.exit(1);
}
console.log("✓ room games OK");
