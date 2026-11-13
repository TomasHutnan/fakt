import { useEffect, useMemo, useState } from "preact/hooks";
import type { Pack } from "../content/types.ts";
import { applyDesign, DEFAULT_DESIGN } from "../designs/index.ts";
import { DEFAULT_SETTINGS, newGame, reduce, type Action, type GameState, type Settings } from "../engine/game.ts";
import { randomSeed } from "../engine/rng.ts";
import { DEMO_PACK, demoState, type DemoScreen } from "./demo.ts";
import { Designs } from "./Designs.tsx";
import { Game } from "./Game.tsx";
import { loadBuiltInPacks } from "./packs.ts";
import { Home, Packs, Rules, SettingsScreen, Setup } from "./Screens.tsx";
import { sk } from "./sk.ts";
import { clearAll, KEYS, load, save } from "./storage.ts";

type Screen = "home" | "setup" | "game" | "packs" | "settings" | "designs" | "rules";

const params = new URLSearchParams(location.search);
const demo = params.get("demo") as DemoScreen | null;

export function App() {
  const [design, setDesign] = useState(() => applyDesign(params.get("design") ?? load(KEYS.design, DEFAULT_DESIGN)));
  const [builtIn, setBuiltIn] = useState<Pack[] | null>(demo ? [DEMO_PACK] : null);
  const [loadError, setLoadError] = useState(false);
  const [imported, setImported] = useState<Pack[]>(() => (demo ? [] : load(KEYS.imported, [])));
  const [enabled, setEnabled] = useState<string[] | null>(() => (demo ? ["demo"] : load(KEYS.enabledPacks, null)));
  const [settings, setSettings] = useState<Settings>(() => ({ ...DEFAULT_SETTINGS, ...load(KEYS.settings, {}) }));
  const [players, setPlayers] = useState<string[]>(() => (demo ? ["Zuzka", "Maroš", "Ivka"] : load(KEYS.players, [])));
  const [seen, setSeen] = useState<string[]>(() => (demo ? [] : load(KEYS.seen, [])));
  const [game, setGame] = useState<GameState | null>(() => (demo ? demoState(demo) : load(KEYS.game, null)));
  const [screen, setScreen] = useState<Screen>(() => initialScreen());
  const [setupError, setSetupError] = useState<string | null>(null);
  const [packsReturn, setPacksReturn] = useState<Screen>("home");

  useEffect(() => {
    if (demo) return;
    loadBuiltInPacks()
      .then(setBuiltIn)
      .catch(() => setLoadError(true));
  }, []);

  const packs = useMemo(() => {
    const ids = new Set((builtIn ?? []).map((p) => p.id));
    return [...(builtIn ?? []), ...imported.filter((p) => !ids.has(p.id))];
  }, [builtIn, imported]);

  // Default selection: everything except adult packs.
  const enabledIds = enabled ?? packs.filter((p) => !p.adult).map((p) => p.id);
  const activeIds = enabledIds.filter((id) => packs.some((p) => p.id === id));

  // Persist (never in demo mode, so the gallery cannot overwrite a real game).
  const persist = (key: string, value: unknown) => {
    if (!demo) save(key, value);
  };
  useEffect(() => persist(KEYS.game, game && game.phase !== "over" ? game : null), [game]);

  const dispatch = (a: Action) => {
    if (!game) return;
    const next = reduce(game, a, packs);
    if (next.phase === "over" && game.phase !== "over") {
      const all = Array.from(new Set([...seen, ...next.played]));
      setSeen(all);
      persist(KEYS.seen, all);
    }
    setGame(next);
  };

  const start = (names: string[], s: Settings) => {
    const settingsWithPacks = { ...s, packIds: activeIds };
    const g = newGame({ players: names, settings: settingsWithPacks, packs, seen: new Set(seen), seed: randomSeed() });
    if (!g) return setSetupError(sk.noQuestions);
    setSetupError(null);
    setPlayers(names);
    persist(KEYS.players, names);
    setSettings(s);
    persist(KEYS.settings, s);
    setGame(g);
    setScreen("game");
  };

  const updateEnabled = (ids: string[]) => {
    setEnabled(ids);
    persist(KEYS.enabledPacks, ids);
  };

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
          onBack={() => setScreen("home")}
          onPacks={() => {
            setPacksReturn("setup");
            setScreen("packs");
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
          onToggle={(id, on) => updateEnabled(on ? [...activeIds, id] : activeIds.filter((x) => x !== id))}
          onSetAll={(on) => updateEnabled(on ? packs.map((p) => p.id) : [])}
          onImport={(p) => {
            const next = [...imported.filter((x) => x.id !== p.id), p];
            setImported(next);
            persist(KEYS.imported, next);
            if (!activeIds.includes(p.id)) updateEnabled([...activeIds, p.id]);
          }}
          onRemoveImported={(id) => {
            const next = imported.filter((x) => x.id !== id);
            setImported(next);
            persist(KEYS.imported, next);
            updateEnabled(activeIds.filter((x) => x !== id));
          }}
          onBack={() => setScreen(packsReturn)}
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
      onNew={() => setScreen("setup")}
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

function initialScreen(): Screen {
  if (location.hash === "#designs") return "designs";
  if (!demo) return "home";
  if (demo === "home") return "home";
  if (demo === "setup" || demo === "packs" || demo === "settings" || demo === "rules") return demo;
  return "game";
}
