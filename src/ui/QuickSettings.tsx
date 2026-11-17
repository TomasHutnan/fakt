import { createContext } from "preact";
import { useContext, useState } from "preact/hooks";
import { DESIGNS } from "../designs/index.ts";
import type { Settings } from "../engine/game.ts";
import { Segmented } from "./Screens.tsx";
import { sk } from "./sk.ts";

// Quick settings during a game (one phone or a room): design, vibration, sound.
// The values are device preferences, so they come from the app, not the game state.

export interface Prefs {
  design: string;
  onDesign: (id: string) => void;
  settings: Settings;
  onSettings: (s: Settings) => void;
}

export const PrefsContext = createContext<Prefs | null>(null);

/** A topbar button that opens the quick settings below the bar. */
export function QuickSettings() {
  const prefs = useContext(PrefsContext);
  const [open, setOpen] = useState(false);
  if (!prefs) return null;
  const s = prefs.settings;
  const onOff = [
    { value: "on", label: sk.on },
    { value: "off", label: sk.off },
  ];
  return (
    <>
      <button
        type="button"
        class="btn btn--ghost btn--small topbar__prefs"
        aria-expanded={open}
        aria-label={sk.quickSettings}
        title={sk.quickSettings}
        onClick={() => setOpen(!open)}
      >
        {"⚙︎"}
      </button>
      {open && (
        <div class="prefs-panel" role="group" aria-label={sk.quickSettings} onKeyDown={(e) => e.key === "Escape" && setOpen(false)}>
          <Segmented<string>
            id="quick-design"
            label={sk.design}
            value={prefs.design}
            options={DESIGNS.map((d) => ({ value: d.id, label: d.name }))}
            onChange={prefs.onDesign}
          />
          <Segmented<string>
            id="quick-haptics"
            label={sk.haptics}
            value={s.haptics ? "on" : "off"}
            options={onOff}
            onChange={(v) => prefs.onSettings({ ...s, haptics: v === "on" })}
          />
          <Segmented<string>
            id="quick-sound"
            label={sk.sound}
            value={s.sound ? "on" : "off"}
            options={onOff}
            onChange={(v) => prefs.onSettings({ ...s, sound: v === "on" })}
          />
          <button type="button" class="btn btn--small" onClick={() => setOpen(false)}>
            {sk.close}
          </button>
        </div>
      )}
    </>
  );
}
