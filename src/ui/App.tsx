import { useEffect, useMemo, useState } from "preact/hooks";
import { onByDefault, type Pack } from "../content/types.ts";
import { applyDesign, DEFAULT_DESIGN } from "../designs/index.ts";
import { DEFAULT_SETTINGS, newGame, reduce, type Action, type GameState, type Settings } from "../engine/game.ts";
import { randomSeed } from "../engine/rng.ts";
import { DEMO_PACK, demoState, type DemoScreen } from "./demo.ts";
import { Designs } from "./Designs.tsx";
import { play, type Cue } from "./feedback.ts";
import { Game } from "./Game.tsx";
import { PrefsContext, type Prefs } from "./QuickSettings.tsx";
import { loadBuiltInPacks } from "./packs.ts";
import { Home, Packs, Rules, SettingsScreen, Setup } from "./Screens.tsx";
import { JoinScreen, RoomBody, RoomScreen } from "./Room.tsx";
import { RoomClient, type StoredSeat } from "../net/client.ts";
import { isCode, normalizeCode, PROTOCOL, type ClientMessage } from "../net/protocol.ts";
import type { RoomSettings } from "../engine/room.ts";
import { demoRoom } from "./demo.ts";
import { sk } from "./sk.ts";
import { validatePack } from "../content/validate.ts";
import { clearAll, KEYS, load, save } from "./storage.ts";

type Screen = "home" | "setup" | "game" | "packs" | "settings" | "designs" | "rules" | "join" | "room";

const params = new URLSearchParams(location.search);
const demo = params.get("demo") as DemoScreen | null;
// Room links: ?r=KTVR joins, ?tv=KTVR opens the big screen. Removed from the address
// right away so a reload goes through the stored seat instead.
const linkCode = (() => {
  const r = normalizeCode(params.get("r") ?? "");
  return isCode(r) ? r : null;
})();
const tvCode = (() => {
  const t = normalizeCode(params.get("tv") ?? "");
  return isCode(t) ? t : null;
})();
if (!demo && (params.has("r") || params.has("tv"))) {
  params.delete("r");
  params.delete("tv");
  const q = params.toString();
  history.replaceState(null, "", `${location.pathname}${q ? `?${q}` : ""}${location.hash}`);
}

export function App() {
  const [design, setDesign] = useState(() => applyDesign(params.get("design") ?? load(KEYS.design, DEFAULT_DESIGN)));
  const [builtIn, setBuiltIn] = useState<Pack[] | null>(demo ? [DEMO_PACK] : null);
  const [loadError, setLoadError] = useState(false);
  const [imported, setImported] = useState<Pack[]>(() => (demo ? [] : loadImported()));
  const [enabled, setEnabled] = useState<string[] | null>(() => (demo ? ["demo"] : load(KEYS.enabledPacks, null)));
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [players, setPlayers] = useState<string[]>(() => (demo ? ["Zuzka", "Maroš", "Ivka"] : load(KEYS.players, [])));
  const [seen, setSeen] = useState<string[]>(() => (demo ? [] : load(KEYS.seen, [])));
  const [game, setGame] = useState<GameState | null>(() => (demo ? demoState(demo) : loadGame()));
  const [screen, setScreen] = useState<Screen>(() => initialScreen());
  const [setupError, setSetupError] = useState<string | null>(null);
  const [seat, setSeat] = useState<StoredSeat | null>(() => (demo ? null : load<StoredSeat | null>(KEYS.room, null)));
  const [roomName, setRoomName] = useState<string>(() => (demo ? "" : load(KEYS.roomName, "")));
  const [client, setClient] = useState<RoomClient | null>(null);
  const [roomReturn, setRoomReturn] = useState<Screen>("home");
  const [packsReturn, setPacksReturn] = useState<Screen>("home");
  // Built-in question ids per pack as of the last visit to the pack list.
  const [knownQuestions, setKnownQuestions] = useState<Record<string, string[]> | null>(() =>
    demo ? null : loadKnownQuestions(),
  );

  // Opening a room link or the big screen; a reload rejoins the stored seat.
  useEffect(() => {
    if (demo) return;
    if (tvCode) return openRoom({ t: "watch", v: PROTOCOL, code: tvCode }, "home");
    if (linkCode && seat?.code === linkCode && seat.role === "player" && seat.token)
      return openRoom({ t: "join", v: PROTOCOL, code: seat.code, token: seat.token }, "home");
    if (linkCode) return setScreen("join");
    if (seat && location.hash !== "#designs") resumeSeat(seat);
  }, []);

  useEffect(() => {
    if (demo) return;
    loadBuiltInPacks()
      .then((list) => {
        setBuiltIn(list);
        // Packs added since the last visit get their default (on unless adult or defaultOn: false),
        // even when the player has already changed the selection.
        const known = load<unknown>(KEYS.knownPacks, null);
        const saved = load<unknown>(KEYS.enabledPacks, null);
        if (Array.isArray(saved) && Array.isArray(known)) {
          const added = list.filter((p) => !known.includes(p.id) && onByDefault(p) && !saved.includes(p.id));
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

  // Default selection: everything except adult and opt-in packs.
  const enabledIds = enabled ?? packs.filter(onByDefault).map((p) => p.id);
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

  // A finished room game: remember its cards as seen on this phone too, like a one-phone game does.
  useEffect(() => {
    if (!client || demo) return;
    let merged = "";
    return client.subscribe((st) => {
      const v = st.view;
      if (!v || v.phase !== "over" || v.you == null || !Array.isArray(v.played) || v.played.length === 0) return;
      const sig = `${v.code}:${v.played.join(",")}`;
      if (sig === merged) return;
      merged = sig;
      setSeen((prev) => {
        const all = Array.from(new Set([...prev, ...v.played]));
        persist(KEYS.seen, all);
        return all;
      });
    });
  }, [client]);

  function storeSeat(next: StoredSeat | null) {
    setSeat(next);
    persist(KEYS.room, next);
  }

  function openRoom(hello: ClientMessage, back: Screen) {
    client?.close();
    const c = new RoomClient(hello, (st) => storeSeat(st));
    setClient(c);
    setRoomReturn(back);
    setScreen("room");
  }

  function resumeSeat(st: StoredSeat) {
    if (st.role === "screen") openRoom({ t: "watch", v: PROTOCOL, code: st.code }, "home");
    else if (st.token) openRoom({ t: "join", v: PROTOCOL, code: st.code, token: st.token }, "home");
  }

  function leaveRoom() {
    client?.close();
    setClient(null);
    storeSeat(null);
    setScreen("home");
  }

  /** Creates a room on the server with this device's enabled packs. */
  const createRoom = (name: string, s: Settings) => {
    if (!name) return setSetupError(sk.roomErrors.badName);
    const rs: RoomSettings = {
      mode: s.mode,
      rounds: s.rounds,
      target: s.target,
      wipe: s.wipe,
      showCorrectCount: s.showCorrectCount,
      difficulties: s.difficulties,
      packIds: activeIds,
      pace: s.pace,
      lastPicks: s.lastPicks,
    };
    setSetupError(null);
    setSettings(s);
    persist(KEYS.settings, s);
    setRoomName(name);
    persist(KEYS.roomName, name);
    openRoom({ t: "create", v: PROTOCOL, name, settings: rs, packs: packs.filter((p) => activeIds.includes(p.id)), seen }, "setup");
  };

  /** `remember: false` (quick start) plays with one-off settings without saving them as the defaults. */
  const start = (names: string[], s: Settings, remember = true) => {
    if (s.online && remember) return createRoom(names[0] ?? "", s);
    if (s.online) s = { ...s, online: false };
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

  const prefs: Prefs = {
    design,
    onDesign: (id) => {
      setDesign(applyDesign(id));
      persist(KEYS.design, id);
    },
    settings,
    onSettings: (next) => {
      setSettings(next);
      persist(KEYS.settings, next);
    },
  };
  const page = (() => {
    if (screen === "designs") return <Designs onBack={() => setScreen("settings")} />;
    if (demo?.startsWith("room-") || demo?.startsWith("tv-")) {
      const d = demoRoom(demo);
      return <RoomBody view={d.view} status="open" send={() => {}} now={() => d.now} onLeave={() => {}} screen={d.screen} />;
    }
    if (screen === "room" && client)
      return (
        <RoomScreen
          client={client}
          onLeave={leaveRoom}
          onBack={() => {
            client.close();
            setClient(null);
            // A seat that no longer works is forgotten.
            if (client.state.error && client.state.error !== "busy") storeSeat(null);
            setScreen(roomReturn);
          }}
        />
      );
    if (screen === "join")
      return (
        <JoinScreen
          initialCode={linkCode ?? ""}
          initialName={roomName || players[0] || ""}
          makeClient={(code, name) => new RoomClient({ t: "join", v: PROTOCOL, code, name }, (st) => storeSeat(st))}
          onJoined={(c, name) => {
            setRoomName(name);
            persist(KEYS.roomName, name);
            setClient(c);
            setRoomReturn("home");
            setScreen("room");
          }}
          onWatch={(code) => openRoom({ t: "watch", v: PROTOCOL, code }, "home")}
          onBack={() => setScreen("home")}
        />
      );

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
            initialName={roomName}
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
            onSetMany={(ids, on) =>
              updateEnabled(on ? [...activeIds, ...ids.filter((id) => !activeIds.includes(id))] : activeIds.filter((id) => !ids.includes(id)))
            }
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
        roomCode={seat?.code ?? null}
        onRoom={() => seat && resumeSeat(seat)}
        onJoin={() => setScreen("join")}
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
  })();
  return <PrefsContext.Provider value={prefs}>{page}</PrefsContext.Provider>;
}

/** Imported packs are re-validated on load: storage may hold data from an older build. */
/** Saved settings always held a mode (every start saves them), so players from
 *  before Mix became the default are moved to it once; choosing Klasika later sticks. */
function loadSettings(): Settings {
  const saved = load<Partial<Settings> | null>(KEYS.settings, null) ?? {};
  if (!demo && !load(KEYS.mixDefault, false)) {
    if (saved.mode === "classic") {
      saved.mode = "mix";
      save(KEYS.settings, saved);
    }
    save(KEYS.mixDefault, true);
  }
  return { ...DEFAULT_SETTINGS, ...saved };
}

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
  // Games saved before the comeback rules play on without them.
  if (typeof g.settings!.lastPicks !== "boolean") g.settings = { ...g.settings!, lastPicks: false };
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
