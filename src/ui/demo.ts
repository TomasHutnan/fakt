import type { Pack } from "../content/types.ts";
import { makeCompareCard, type Card } from "../engine/cards.ts";
import { createRoom, DEFAULT_ROOM_SETTINGS, reduceRoom, viewFor, type ClientAction, type RoomState, type RoomView } from "../engine/room.ts";
import { DEFAULT_SETTINGS, newGame, reduce, type GameState } from "../engine/game.ts";
import { createRng } from "../engine/rng.ts";

// Fixed demo states for the design gallery (?demo=<screen>). Uses its own
// small pack so the gallery works before the real packs load.

const o = (text: string, why: string) => ({ text, why });

export const DEMO_PACK: Pack = {
  id: "demo",
  title: "Slovenská príroda",
  category: "zemepis",
  lang: "sk",
  license: "CC0-1.0",
  adult: false,
  version: 1,
  questions: [
    {
      id: "ryby",
      type: "pick",
      prompt: "Ktoré z týchto rýb žijú vo voľnej prírode v slovenských riekach?",
      difficulty: 1,
      source: "https://sk.wikipedia.org/wiki/Zoznam_rýb_Slovenska",
      correct: [
        o("kapor rybničný", "Najznámejšia sladkovodná ryba, pôvodne z povodia Dunaja."),
        o("šťuka severná", "Dravec stojatých aj tečúcich vôd celého Slovenska."),
        o("sumec veľký", "Najväčšia sladkovodná ryba Slovenska, môže mať aj cez 2 metre."),
        o("hlavátka podunajská", "Najväčšia lososovitá ryba Európy, žije v Dunaji a prítokoch."),
        o("zubáč veľkoústy", "Obľúbený dravec Dunaja a nádrží."),
      ],
      wrong: [
        o("treska škvrnitá", "Morská ryba severného Atlantiku."),
        o("makrela atlantická", "Žije v mori, u nás len v konzerve."),
        o("tuniak modroplutvý", "Oceánsky dravec, do riek nepláva."),
        o("platesa veľká", "Plochá morská ryba Severného mora."),
        o("sardinka európska", "Morská ryba zo Stredomoria a Atlantiku."),
      ],
    },
    {
      id: "stity",
      type: "order",
      prompt: "Zoraď štíty od najvyššieho.",
      difficulty: 2,
      source: "https://sk.wikipedia.org/wiki/Gerlachovský_štít",
      direction: "desc",
      unit: "m n. m.",
      items: [
        { text: "Gerlachovský štít", value: 2655 },
        { text: "Lomnický štít", value: 2634 },
        { text: "Rysy", value: 2503 },
        { text: "Kriváň", value: 2494 },
      ],
    },
    {
      id: "kosice",
      type: "number",
      prompt: "Koľko obyvateľov majú Košice?",
      difficulty: 2,
      source: "https://sk.wikipedia.org/wiki/Košice",
      asOf: "2021",
      answer: 229040,
      unit: "obyvateľov",
      scale: "log",
      tolerance: 0.05,
      why: "Podľa sčítania 2021; druhé najväčšie mesto Slovenska.",
    },
    {
      id: "hornad",
      type: "choice",
      prompt: "Ktorá rieka preteká Košicami?",
      difficulty: 1,
      source: "https://sk.wikipedia.org/wiki/Hornád",
      correct: o("Hornád", "Preteká mestom od juhu na sever."),
      wrong: [o("Hron", "Tečie stredným Slovenskom."), o("Torysa", "Tečie cez Prešov."), o("Ondava", "Tečie cez Stropkov a Michalovce.")],
    },
  ],
};

export type DemoScreen =
  | "home" | "setup" | "rules" | "packs" | "settings"
  | "handover" | "play" | "order" | "number" | "choice" | "compare" | "answer" | "busted" | "reveal" | "over";

export const DEMO_SCREENS: DemoScreen[] = [
  "home", "setup", "handover", "play", "busted", "order", "number", "choice", "compare", "answer", "reveal", "over", "packs", "settings", "rules",
];

const players = ["Zuzka", "Maroš", "Ivka"];

function game(type: "pick" | "order" | "number" | "choice"): GameState {
  const pack: Pack = { ...DEMO_PACK, questions: DEMO_PACK.questions.filter((q) => q.type === type) };
  const s = newGame({
    players,
    settings: { ...DEFAULT_SETTINGS, mode: "mix", packIds: ["demo"] },
    packs: [pack],
    seen: new Set(),
    seed: 4,
  })!;
  return { ...s, round: 3, players: s.players.map((p, i) => ({ ...p, score: [14, 9, 11][i] })) };
}

export function demoState(screen: DemoScreen): GameState | null {
  const packs = [DEMO_PACK];
  switch (screen) {
    case "handover":
      return game("pick");
    case "play": {
      let s = reduce(game("pick"), { type: "continue" }, packs);
      if (s.card.type !== "pick") return s;
      const right = s.card.options.map((x, i) => (x.correct ? i : -1)).filter((i) => i >= 0);
      for (const i of right.slice(0, 2)) s = reduce(s, { type: "pick", option: i }, packs);
      return s;
    }
    case "busted": {
      let s = reduce(game("pick"), { type: "continue" }, packs);
      if (s.card.type !== "pick") return s;
      const card = s.card;
      s = reduce(s, { type: "pick", option: card.options.findIndex((x) => x.correct) }, packs);
      return reduce(s, { type: "pick", option: card.options.findIndex((x) => !x.correct) }, packs);
    }
    case "order":
      return reduce(game("order"), { type: "continue" }, packs);
    case "number":
      return reduce(game("number"), { type: "continue" }, packs);
    case "choice":
      return reduce(game("choice"), { type: "continue" }, packs);
    case "compare": {
      const s = reduce(game("order"), { type: "continue" }, packs);
      const q = DEMO_PACK.questions.find((x) => x.type === "order")!;
      return { ...s, card: makeCompareCard(DEMO_PACK, q as Extract<typeof q, { type: "order" }>, createRng(2))! };
    }
    case "answer": {
      const s = reduce(game("order"), { type: "continue" }, packs);
      if (s.card.type !== "order") return s;
      return reduce(s, { type: "submitOrder", arrangement: s.card.items.map((_, i) => i).reverse() }, packs);
    }
    case "reveal": {
      let s = game("pick");
      s = { ...s, settings: { ...s.settings, revealEach: false } };
      for (let t = 0; t < players.length; t++) {
        s = reduce(s, { type: "continue" }, packs);
        if (s.card.type !== "pick") return s;
        const card = s.card;
        const right = card.options.map((x, i) => (x.correct ? i : -1)).filter((i) => i >= 0);
        for (const i of right.slice(0, t + 1)) s = reduce(s, { type: "pick", option: i }, packs);
        if (t === 1) s = reduce(s, { type: "pick", option: card.options.findIndex((x) => !x.correct) }, packs);
        else s = reduce(s, { type: "bank" }, packs);
        s = reduce(s, { type: "endTurn" }, packs);
      }
      return s;
    }
    case "over":
      return { ...game("pick"), phase: "over", played: DEMO_PACK.questions.map((q) => `demo/${q.id}`) };
    default:
      return null;
  }
}

// Room demo states (?demo=room-…, ?demo=tv-…): views as a device would get them.

export type RoomDemo = "room-choice" | "room-order" | "room-tiebreak" | "room-tiebreak-reveal" | "tv-over" | "tv-tiebreak" | "room-lobby" | "room-packpick" | "room-pick" | "room-number" | "room-reveal" | "room-over" | "tv-lobby" | "tv-question" | "tv-reveal";
export const ROOM_DEMOS: RoomDemo[] = ["room-choice", "room-order", "room-tiebreak", "room-tiebreak-reveal", "tv-over", "tv-tiebreak", "room-lobby", "room-packpick", "room-pick", "room-number", "room-reveal", "room-over", "tv-lobby", "tv-question", "tv-reveal"];

const T0 = 1_800_000_000_000;

function roomWith(type: "pick" | "number" | "choice" | "order"): { s: RoomState; packs: Pack[] } {
  const pack: Pack = { ...DEMO_PACK, questions: DEMO_PACK.questions.filter((q) => q.type === type) };
  const packs = [pack];
  let s = createRoom({
    code: "KTVR",
    hostId: "jano",
    hostName: "Jano",
    settings: { ...DEFAULT_ROOM_SETTINGS, packIds: ["demo"], mode: "mix", rounds: 10 },
    packs,
    seen: [],
    seed: 3,
  })!;
  for (const [id, name] of [["zuzka", "Zuzka"], ["miro", "Miro"], ["peta", "Peťa"], ["dano", "Dano"]]) s = reduceRoom(s, { type: "join", id, name }, packs);
  s = reduceRoom(s, { type: "connect", id: "dano", connected: false }, packs);
  return { s, packs };
}

export function demoRoom(screen: string): { view: RoomView; now: number; screen: boolean } {
  const tv = screen.startsWith("tv-");
  const you = tv ? null : "zuzka";
  const kind: "pick" | "number" | "choice" | "order" =
    screen === "room-number" || screen.includes("tiebreak") ? "number" : screen === "room-choice" ? "choice" : screen === "room-order" ? "order" : "pick";
  let { s, packs } = roomWith(kind);
  const act = (by: string, a: ClientAction) => (s = reduceRoom(s, { ...a, by, now: T0 } as never, packs));
  if (screen === "room-packpick") {
    act("jano", { type: "start" });
    const options = [
      { id: "a", title: "Slovenské rieky" },
      { id: "b", title: "Koktaily" },
      { id: "c", title: "Guinnessove rekordy" },
    ];
    s = { ...s, phase: "choosePack", round: 3, card: null, packChoice: { chooser: "zuzka", options }, deadline: T0 + 35_000 };
  } else if (screen !== "room-lobby" && screen !== "tv-lobby") {
    act("jano", { type: "start" });
    if (kind === "pick") {
      const card = s.card as Extract<Card, { type: "pick" }>;
      const right = card.options.map((o, i) => (o.correct ? i : -1)).filter((i) => i >= 0);
      const wrong = card.options.findIndex((o) => !o.correct);
      act("jano", { type: "pick", option: right[0] });
      act("jano", { type: "pick", option: right[1] });
      act("jano", { type: "bank" });
      act("miro", { type: "pick", option: wrong });
      act("zuzka", { type: "pick", option: right[2] });
      if (screen === "room-reveal" || screen === "tv-reveal" || screen === "room-over") {
        act("zuzka", { type: "pick", option: right[1] });
        act("zuzka", { type: "pick", option: right[0] });
        act("zuzka", { type: "bank" });
        act("peta", { type: "pick", option: right[3] });
        act("peta", { type: "bank" });
      }
    } else if (kind === "choice") {
      act("jano", { type: "submitChoice", option: 0 });
    } else if (kind === "order") {
      act("jano", { type: "submitOrder", arrangement: [0, 1, 2, 3] });
    } else if (screen.includes("tiebreak")) {
      // Jano and Zuzka share the lead; only they answer the extra card.
      s = { ...s, tiebreak: ["jano", "zuzka"], players: s.players.map((p) => ({ ...p, score: p.id === "jano" || p.id === "zuzka" ? 14 : 8 })) };
      act("jano", { type: "submitNumber", value: 215000 });
      if (screen === "room-tiebreak-reveal") act("zuzka", { type: "submitNumber", value: 260000 });
    } else {
      act("jano", { type: "submitNumber", value: 200000 });
    }
    if (screen === "room-reveal" || screen === "tv-reveal") act("jano", { type: "ready" });
    if (screen === "room-over" || screen === "tv-over") s = { ...s, phase: "over", players: s.players.map((p, i) => ({ ...p, score: [21, 19, 12, 14, 9][i] })) };
  }
  return { view: viewFor(s, you), now: T0 + 23_000, screen: tv };
}
