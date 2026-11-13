// localStorage wrapper. Every access is guarded: storage can be missing or full
// (private windows, blocked site data) and the game must still work.

const PREFIX = "fakt:";

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

/** Returns false when the value could not be stored (storage unavailable or full). */
export function save(key: string, value: unknown): boolean {
  try {
    if (value === null || value === undefined) localStorage.removeItem(PREFIX + key);
    else localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearAll(): void {
  try {
    Object.keys(localStorage)
      .filter((k) => k.startsWith(PREFIX))
      .forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export const KEYS = {
  game: "game",
  settings: "settings",
  players: "players",
  enabledPacks: "enabledPacks",
  /** Built-in pack ids seen on the last visit, to switch on packs added later. */
  knownPacks: "knownPacks",
  seen: "seen",
  imported: "imported",
  design: "design",
  /** Per-card ratings from the game-over screen: { [packId/questionId]: { rating, version } }. */
  ratings: "ratings",
  /** Built-in question ids per pack seen when the pack list was last opened, for "new questions". */
  knownQuestions: "knownQuestions",
} as const;
