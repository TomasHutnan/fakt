import { useEffect, useMemo, useState } from "preact/hooks";
import type { Pack } from "../content/types.ts";
import { applyDesign, DEFAULT_DESIGN } from "../designs/index.ts";
import { DEFAULT_SETTINGS, newGame, reduce, type Action, type GameState, type Settings } from "../engine/game.ts";
import { randomSeed } from "../engine/rng.ts";
import { DEMO_PACK, demoState, type DemoScreen } from "./demo.ts";
import { Designs } from "./Designs.tsx";
import { play, type Cue } from "./feedback.ts";
import { Game } from "./Game.tsx";
import { loadBuiltInPacks } from "./packs.ts";
import { Home, Packs, Rules, SettingsScreen, Setup } from "./Screens.tsx";
import { sk } from "./sk.ts";
import { validatePack } from "../content/validate.ts";
import { clearAll, KEYS, load, save } from "./storage.ts";

type Screen = "home" | "setup" | "game" | "packs" | "settings" | "designs" | "rules";

const params = new URLSearchParams(location.search);
const demo = params.get("demo") as DemoScreen | null;

export function App() {
  const [design, setDesign] = useState(() => applyDesign(params.get("design") ?? load(KEYS.design, DEFAULT_DESIGN)));
  const [builtIn, setBuiltIn] = useState<Pack[] | null>(demo ? [DEMO_PACK] : null);
  const [loadError, setLoadError] = useState(false);
  const [imported, setImported] = useState<Pack[]>(() => (demo ? [] : loadImported()));
  const [enabled, setEnabled] = useState<string[] | null>(() => (demo ? ["demo"] : load(KEYS.enabledPacks, null)));
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) }));
  const [players, setPlayers] = useState<string[]>(() => (demo ? ["Zuzka", "Maroš", "Ivka"] : load(KEYS.players, [])));
  const [seen, setSeen] = useState<string[]>(() => (demo ? [] : load(KEYS.seen, [])));
  const [game, setGame] = useState<GameState | null>(() => (demo ? demoState(demo) : loadGame()));
  const [screen, setScreen] = useState<Screen>(() => initialScreen());
  const [setupError, setSetupError] = useState<string | null>(null);
  const [packsReturn, setPacksReturn] = useState<Screen>("home");
  // Built-in question ids per pack as of the last visit to the pack list.
  const [knownQuestions, setKnownQuestions] = useState<Record<string, string[]> | null>(() =>
    demo ? null : loadKnownQuestions(),
  );

  useEffect(() => {
    if (demo) return;
    loadBuiltInPacks()
      .then((list) => {
        setBuiltIn(list);
        // Packs added since the last visit get their default (on unless adult),
        // even when the player has already changed the selection.
        const known = load<unknown>(KEYS.knownPacks, null);
        const saved = load<unknown>(KEYS.enabledPacks, null);
        if (Array.isArray(saved) && Array.isArray(known)) {
          const added = list.filter((p) => !known.includes(p.id) && !p.adult && !saved.includes(p.id));
          if (added.length) {
            const ids = [...saved, ...added.map((p) => p.id)];
            setEnabled(ids);
            save(KEYS.enabledPacks, ids);
          }
        }
        // No question list yet: packs from the last visit count as known (all of them on a first visit),
        // so packs added since then still show up as new.
        if (!loadKnownQuestions()) {
          const all = questionIds(Array.isArray(known) ? list.filter((p) => known.includes(p.id)) : list);
          setKnownQuestions(all);
          save(KEYS.knownQuestions, all);
        }
        save(KEYS.knownPacks, list.map((p) => p.id));
      })
      .catch(() => setLoadError(true));
  }, []);

  const packs = useMemo(() => {
    const ids = new Set((builtIn ?? []).map((p) => p.id));
    return [...(builtIn ?? []), ...imported.filter((p) => !ids.has(p.id))];
  }, [builtIn, imported]);

  // Questions added to built-in packs since the pack list was last opened.
  const fresh = useMemo(() => {
    const out: Record<string, number> = {};
    if (!knownQuestions || !builtIn) return out;
    for (const p of builtIn) {
      const known = new Set(knownQuestions[p.id] ?? []);
      const n = p.questions.filter((q) => !known.has(q.id)).length;
      if (n) out[p.id] = n;
    }
    return out;
  }, [knownQuestions, builtIn]);
  const markKnown = () => {
    if (!builtIn || Object.keys(fresh).length === 0) return;
    const all = questionIds(builtIn);
    setKnownQuestions(all);
    persist(KEYS.knownQuestions, all);
  };

  // Default selection: everything except adult packs.
  const enabledIds = enabled ?? packs.filter((p) => !p.adult).map((p) => p.id);
  const activeIds = enabledIds.filter((id) => packs.some((p) => p.id === id));

  // Persist (never in demo mode, so the gallery cannot overwrite a real game).
  const persist = (key: string, value: unknown): boolean => (demo ? true : save(key, value));
  useEffect(() => {
    persist(KEYS.game, game && game.phase !== "over" ? game : null);
  }, [game]);

  const dispatch = (a: Action) => {
    if (!game) return;
    const next = reduce(game, a, packs);
    const cue = cueFor(game, next, a);
    if (cue) play(cue, settings);
    if (next.phase === "over" && game.phase !== "over") {
      const all = Array.from(new Set([...seen, ...next.played]));
      setSeen(all);
      persist(KEYS.seen, all);
    }
    setGame(next);
  };

  /** `remember: false` (quick start) plays with one-off settings without saving them as the defaults. */
  const start = (names: string[], s: Settings, remember = true) => {
    const settingsWithPacks = { ...s, packIds: activeIds };
    const g = newGame({ players: names, settings: settingsWithPacks, packs, seen: new Set(seen), seed: randomSeed() });
    if (!g) {
      setSetupError(sk.noQuestions);
      if (!remember) setScreen("setup");
      return;
    }
    setSetupError(null);
    setPlayers(names);
    persist(KEYS.players, names);
    if (remember) {
      setSettings(s);
      persist(KEYS.settings, s);
    }
    setGame(g);
    setScreen("game");
  };

  const updateEnabled = (ids: string[]) => {
    setEnabled(ids);
    persist(KEYS.enabledPacks, ids);
  };

  const lastPlayers = players.map((n) => n.trim()).filter(Boolean);

  if (screen === "designs") return <Designs onBack={() => setScreen("settings")} />;

  if (!builtIn && !loadError) return <div class="screen screen--loading"><p class="loading">{sk.loading}</p></div>;
  if (loadError && !builtIn) return <div class="screen screen--loading"><p class="error">{sk.loadError}</p></div>;

  switch (screen) {
    case "rules":
      return <Rules onBack={() => setScreen("home")} />;
    case "game":
      if (game)
        return (
          <Game
            state={game}
            dispatch={dispatch}
            onQuit={() => {
              setGame(null);
              setScreen("home");
            }}
            onPlayAgain={() => setScreen("setup")}
            packs={packs}
          />
        );
      break;
    case "setup":
      return (
        <Setup
          packs={packs}
          enabled={activeIds}
          initialPlayers={players}
          initialSettings={settings}
          error={setupError}
          onBack={() => {
            setSetupError(null);
            setScreen("home");
          }}
          onPacks={() => {
            setSetupError(null);
            setPacksReturn("setup");
            setScreen("packs");
          }}
          onDraft={(names, s) => {
            setPlayers(names);
            setSettings(s);
          }}
          onStart={start}
        />
      );
    case "packs":
      return (
        <Packs
          packs={packs}
          importedIds={imported.map((p) => p.id)}
          enabled={activeIds}
          fresh={fresh}
          onToggle={(id, on) => updateEnabled(on ? [...activeIds, id] : activeIds.filter((x) => x !== id))}
          onSetAll={(on) => updateEnabled(on ? packs.map((p) => p.id) : [])}
          onImport={(p) => {
            if (builtIn?.some((b) => b.id === p.id)) return sk.importClash(p.id);
            const next = [...imported.filter((x) => x.id !== p.id), p];
            setImported(next);
            if (!activeIds.includes(p.id)) updateEnabled([...activeIds, p.id]);
            return persist(KEYS.imported, next) ? null : sk.importNotSaved;
          }}
          onRemoveImported={(id) => {
            const next = imported.filter((x) => x.id !== id);
            setImported(next);
            persist(KEYS.imported, next);
            updateEnabled(activeIds.filter((x) => x !== id));
          }}
          onBack={() => {
            markKnown();
            setScreen(packsReturn);
          }}
        />
      );
    case "settings":
      return (
        <SettingsScreen
          design={design}
          settings={settings}
          seenCount={seen.length}
          onDesign={(id) => {
            setDesign(applyDesign(id));
            persist(KEYS.design, id);
          }}
          onSettings={(s) => {
            setSettings(s);
            persist(KEYS.settings, s);
          }}
          onResetSeen={() => {
            setSeen([]);
            persist(KEYS.seen, []);
          }}
          onClearAll={() => {
            if (!demo) clearAll();
            location.reload();
          }}
          onGallery={() => setScreen("designs")}
          onBack={() => setScreen("home")}
        />
      );
  }

  return (
    <Home
      canResume={!!game && game.phase !== "over"}
      questionCount={packs.filter((p) => activeIds.includes(p.id)).reduce((n, p) => n + p.questions.length, 0)}
      packCount={activeIds.length}
      freshCount={activeIds.reduce((n, id) => n + (fresh[id] ?? 0), 0)}
      lastPlayers={lastPlayers}
      onQuick={(rounds) => start(lastPlayers, { ...settings, rounds, target: null }, false)}
      onNew={() => {
        setSetupError(null);
        setScreen("setup");
      }}
      onResume={() => setScreen("game")}
      onPacks={() => {
        setPacksReturn("home");
        setScreen("packs");
      }}
      onSettings={() => setScreen("settings")}
      onRules={() => setScreen("rules")}
    />
  );
}

/** Imported packs are re-validated on load: storage may hold data from an older build. */
function loadImported(): Pack[] {
  const raw = load<unknown>(KEYS.imported, []);
  if (!Array.isArray(raw)) return [];
  return raw.map((p) => validatePack(p).pack).filter((p): p is Pack => p !== null);
}

/** A saved game is only resumed if it has the current shape; otherwise it is dropped. */
function loadGame(): GameState | null {
  const g = load<Partial<GameState> | null>(KEYS.game, null);
  const ok =
    !!g &&
    typeof g === "object" &&
    Array.isArray(g.players) &&
    g.players.length > 0 &&
    Array.isArray(g.order) &&
    typeof g.turn === "number" &&
    g.turn >= 0 &&
    g.turn < g.order.length &&
    g.order.every((i) => Number.isInteger(i) && i >= 0 && i < g.players!.length) &&
    typeof g.deckPos === "number" &&
    Array.isArray(g.played) &&
    typeof g.round === "number" &&
    Array.isArray(g.deck) &&
    Array.isArray(g.results) &&
    typeof g.phase === "string" &&
    typeof (g.card as { type?: unknown } | undefined)?.type === "string" &&
    !!g.settings &&
    !!g.answer;
  if (!ok) return null;
  // Games saved before the per-turn answer setting existed keep the old behaviour.
  if (typeof g.settings!.revealEach !== "boolean") g.settings = { ...g.settings!, revealEach: false };
  return g as GameState;
}

function questionIds(packs: Pack[]): Record<string, string[]> {
  return Object.fromEntries(packs.map((p) => [p.id, p.questions.map((q) => q.id)]));
}

function loadKnownQuestions(): Record<string, string[]> | null {
  const raw = load<unknown>(KEYS.knownQuestions, null);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return Object.values(raw).every(Array.isArray) ? (raw as Record<string, string[]>) : null;
}

/** Sound/vibration for what the player just saw: picks always, other answers only when shown right away. */
function cueFor(prev: GameState, next: GameState, a: Action): Cue | null {
  if (a.type === "pick" && next !== prev && next.answer?.type === "pick") {
    const st = next.answer.status;
    return st === "busted" ? "wrong" : st === "complete" ? "done" : "right";
  }
  if (a.type === "submitChoice" && next.phase === "turnEnd" && next.card.type === "choice") {
    const r = next.results[next.results.length - 1];
    return r?.answer.type === "choice" && next.card.options[r.answer.option]?.correct ? "done" : "wrong";
  }
  return null;
}

function initialScreen(): Screen {
  if (location.hash === "#designs") return "designs";
  if (!demo) return "home";
  if (demo === "home") return "home";
  if (demo === "setup" || demo === "packs" || demo === "settings" || demo === "rules") return demo;
  return "game";
}
