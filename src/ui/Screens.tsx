import { useEffect, useState } from "preact/hooks";
import type { Pack } from "../content/types.ts";
import { DEFAULT_SETTINGS, type Mode, type Settings } from "../engine/game.ts";
import type { WipeRule } from "../engine/scoring.ts";
import { DESIGNS } from "../designs/index.ts";
import { parsePackFile } from "./packs.ts";
import { REPO_URL, REPORT_FORM_URL } from "./links.ts";
import { sk } from "./sk.ts";

const QUICK = [
  { rounds: 5, label: sk.quickGame },
  { rounds: 20, label: sk.longGame },
];

export function TopBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <header class="topbar">
      <button type="button" class="btn btn--ghost btn--small topbar__back" onClick={onBack}>
        ← {sk.back}
      </button>
      <h1 class="topbar__title">{title}</h1>
    </header>
  );
}

export function Home(props: {
  canResume: boolean;
  questionCount: number;
  packCount: number;
  /** Questions added since the pack list was last opened. */
  freshCount: number;
  /** Players of the last game; quick starts are offered when there are some. */
  lastPlayers: string[];
  onQuick: (rounds: number) => void;
  onNew: () => void;
  onResume: () => void;
  onPacks: () => void;
  onSettings: () => void;
  onRules: () => void;
}) {
  return (
    <div class="screen screen--home">
      <div class="brand">
        <span class="brand__mark" aria-hidden="true">
          ?
        </span>
        <h1 class="brand__name">{sk.appName}</h1>
        <p class="brand__tagline">{sk.tagline}</p>
      </div>
      <nav class="menu">
        {props.canResume && (
          <button type="button" class="btn btn--primary btn--block" onClick={props.onResume}>
            {sk.resume}
          </button>
        )}
        {props.lastPlayers.length > 0 && (
          <div class="quick">
            {QUICK.map((q, i) => (
              <button
                type="button"
                class={`btn quick__btn${!props.canResume && i === 0 ? " btn--primary" : ""}`}
                onClick={() => props.onQuick(q.rounds)}>
                <span class="quick__label">{q.label}</span>
                <span class="quick__meta">{sk.quickWith(props.lastPlayers, q.rounds)}</span>
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          class={`btn btn--block${props.canResume || props.lastPlayers.length > 0 ? "" : " btn--primary"}`}
          onClick={props.onNew}
        >
          {sk.newGame}
        </button>
        <button type="button" class="btn btn--block" onClick={props.onPacks}>
          {sk.packs}
        </button>
        <button type="button" class="btn btn--block" onClick={props.onRules}>
          {sk.rules}
        </button>
        <button type="button" class="btn btn--block" onClick={props.onSettings}>
          {sk.settings}
        </button>
      </nav>
      <p class="home__stats">
        {sk.questionsInPacks(props.questionCount, props.packCount)}
        {props.freshCount > 0 && (
          <>
            {" · "}
            <button type="button" class="link home__fresh" onClick={props.onPacks}>
              {sk.newQuestions(props.freshCount)}
            </button>
          </>
        )}
      </p>
    </div>
  );
}

function Segmented<T extends string | number>(props: {
  id: string;
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <fieldset class="field">
      <legend class="field__label">{props.label}</legend>
      <div class="segmented" role="group" id={props.id}>
        {props.options.map((o) => (
          <button
            type="button"
            class="segmented__opt"
            aria-pressed={o.value === props.value}
            onClick={() => props.onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export function Setup(props: {
  packs: Pack[];
  enabled: string[];
  initialPlayers: string[];
  initialSettings: Settings;
  error: string | null;
  onBack: () => void;
  onPacks: () => void;
  onDraft: (players: string[], settings: Settings) => void;
  onStart: (players: string[], settings: Settings) => void;
}) {
  const [players, setPlayers] = useState<string[]>(props.initialPlayers.length ? props.initialPlayers : ["", ""]);
  const [settings, setSettings] = useState<Settings>(props.initialSettings);
  const set = (patch: Partial<Settings>) => setSettings({ ...settings, ...patch });
  // Keep unsaved edits in App, so visiting the pack list does not lose them.
  useEffect(() => props.onDraft(players, settings), [players, settings]);
  const names = players.map((p, i) => p.trim() || sk.playerPlaceholder(i + 1));
  const lengthValue = settings.target != null ? `t${settings.target}` : `r${settings.rounds}`;

  return (
    <div class="screen screen--setup">
      <TopBar title={sk.newGame} onBack={props.onBack} />
      <form
        class="stack"
        onSubmit={(e) => {
          e.preventDefault();
          props.onStart(names, settings);
        }}
      >
        <fieldset class="field">
          <legend class="field__label">{sk.players}</legend>
          <ul class="player-list">
            {players.map((p, i) => (
              <li class="player-row" key={i}>
                <input
                  id={`player-${i}`}
                  class="input"
                  aria-label={sk.playerPlaceholder(i + 1)}
                  value={p}
                  maxLength={24}
                  placeholder={sk.playerPlaceholder(i + 1)}
                  onInput={(e) => setPlayers(players.map((x, j) => (j === i ? (e.target as HTMLInputElement).value : x)))}
                />
                {players.length > 1 && (
                  <button
                    type="button"
                    class="btn btn--icon"
                    aria-label={sk.removePlayer(names[i])}
                    onClick={() => setPlayers(players.filter((_, j) => j !== i))}
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          {players.length < 10 && (
            <button type="button" class="btn btn--ghost btn--small" onClick={() => setPlayers([...players, ""])}>
              + {sk.addPlayer}
            </button>
          )}
          {players.length === 1 && <p class="field__hint">{sk.soloHint}</p>}
        </fieldset>

        <Segmented<Mode>
          id="mode"
          label={sk.mode}
          value={settings.mode}
          options={[
            { value: "classic", label: sk.modeClassic },
            { value: "mix", label: sk.modeMix },
          ]}
          onChange={(mode) => set({ mode })}
        />
        <p class="field__hint">{settings.mode === "classic" ? sk.modeClassicHint : sk.modeMixHint}</p>

        <Segmented<string>
          id="length"
          label={sk.length}
          value={lengthValue}
          options={[
            { value: "r5", label: sk.rounds(5) },
            { value: "r10", label: sk.rounds(10) },
            { value: "r20", label: sk.rounds(20) },
            { value: "t50", label: sk.target(50) },
          ]}
          onChange={(v) =>
            v.startsWith("t") ? set({ target: Number(v.slice(1)) }) : set({ target: null, rounds: Number(v.slice(1)) })
          }
        />

        <fieldset class="field">
          <legend class="field__label">{sk.difficulty}</legend>
          <div class="segmented" role="group">
            {[1, 2, 3].map((d) => {
              const on = settings.difficulties.includes(d);
              return (
                <button
                  type="button"
                  class="segmented__opt"
                  aria-pressed={on}
                  onClick={() =>
                    set({
                      difficulties: on
                        ? settings.difficulties.filter((x) => x !== d)
                        : [...settings.difficulties, d].sort(),
                    })
                  }
                >
                  {sk.difficultyNames[d]}
                </button>
              );
            })}
          </div>
        </fieldset>

        <fieldset class="field">
          <legend class="field__label">{sk.packs}</legend>
          <div class="row row--between">
            <span>{sk.packsSelected(props.enabled.length, props.packs.length)}</span>
            <button type="button" class="btn btn--ghost btn--small" onClick={props.onPacks}>
              {sk.choosePacks}
            </button>
          </div>
        </fieldset>

        {props.error && <p class="error">{props.error}</p>}
        <div class="actions">
          <button type="submit" class="btn btn--primary btn--block">
            {sk.start}
          </button>
        </div>
      </form>
    </div>
  );
}

export function Packs(props: {
  packs: Pack[];
  importedIds: string[];
  enabled: string[];
  /** Questions added since the last visit of this screen, per pack id. */
  fresh: Record<string, number>;
  onToggle: (id: string, on: boolean) => void;
  onSetAll: (on: boolean) => void;
  /** Returns an error message, or null when the pack was added and saved. */
  onImport: (pack: Pack) => string | null;
  onRemoveImported: (id: string) => void;
  onBack: () => void;
}) {
  const [msg, setMsg] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const handleFile = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    const res = await parsePackFile(file.name, await file.text());
    if (res.pack) {
      const err = props.onImport(res.pack);
      if (err && !err.startsWith("!")) setMsg({ ok: false, lines: [sk.importFailed, err] });
      else
        setMsg({
          ok: !err,
          lines: [sk.importOk(res.pack.title, res.pack.questions.length), ...(err ? [err.slice(1)] : []), ...res.warnings],
        });
    } else setMsg({ ok: false, lines: [sk.importFailed, ...res.errors.slice(0, 12)] });
  };

  return (
    <div class="screen screen--packs">
      <TopBar title={sk.packs} onBack={props.onBack} />
      <div class="row">
        <button type="button" class="btn btn--small" onClick={() => props.onSetAll(true)}>
          {sk.allOn}
        </button>
        <button type="button" class="btn btn--small" onClick={() => props.onSetAll(false)}>
          {sk.allOff}
        </button>
      </div>
      <ul class="pack-list">
        {props.packs.map((p) => {
          const on = props.enabled.includes(p.id);
          const imported = props.importedIds.includes(p.id);
          return (
            <li class={`pack${on ? " pack--on" : ""}`} key={p.id}>
              <label class="pack__main" for={`pack-${p.id}`}>
                <span class="pack__title">
                  {p.title}
                  {p.adult && <span class="badge badge--adult">{sk.adult}</span>}
                  {imported && <span class="badge">{sk.imported}</span>}
                  {props.fresh[p.id] > 0 && <span class="badge badge--new">{sk.newBadge(props.fresh[p.id])}</span>}
                </span>
                {p.description && <span class="pack__desc">{p.description}</span>}
                {p.warnings && p.warnings.length > 0 && (
                  <span class="pack__warnings">
                    <span class="visually-hidden">{sk.contentWarnings}: </span>
                    {p.warnings.map((w) => (
                      <span class="badge badge--warning" key={w}>
                        {sk.warningNames[w]}
                      </span>
                    ))}
                  </span>
                )}
                <span class="pack__meta">
                  {sk.questionsCount(p.questions.length)} · {p.lang.toUpperCase()}
                  {p.license !== "CC0-1.0" ? ` · ${p.license}` : ""}
                </span>
              </label>
              <input
                id={`pack-${p.id}`}
                type="checkbox"
                class="toggle"
                checked={on}
                onChange={(e) => props.onToggle(p.id, (e.target as HTMLInputElement).checked)}
              />
              {imported && (
                <button type="button" class="btn btn--ghost btn--small pack__remove" onClick={() => props.onRemoveImported(p.id)}>
                  {sk.remove}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <section class="field">
        <label class="btn btn--block file-btn" for="import-file">
          {sk.importPack}
        </label>
        <input id="import-file" type="file" accept=".yaml,.yml,.json,application/json,text/yaml" class="visually-hidden" onChange={handleFile} />
        <p class="field__hint">{sk.importHint}</p>
        {msg && (
          <div class={msg.ok ? "notice" : "error"} role="status">
            {msg.lines.map((l) => (
              <p>{l}</p>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function SettingsScreen(props: {
  design: string;
  settings: Settings;
  seenCount: number;
  onDesign: (id: string) => void;
  onSettings: (s: Settings) => void;
  onResetSeen: () => void;
  onClearAll: () => void;
  onGallery: () => void;
  onBack: () => void;
}) {
  const [done, setDone] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const s = props.settings ?? DEFAULT_SETTINGS;
  return (
    <div class="screen screen--settings">
      <TopBar title={sk.settings} onBack={props.onBack} />
      <div class="stack">
        <fieldset class="field">
          <legend class="field__label">{sk.design}</legend>
          <ul class="design-list">
            {DESIGNS.map((d) => (
              <li>
                <button
                  type="button"
                  class="design-choice"
                  aria-pressed={d.id === props.design}
                  onClick={() => props.onDesign(d.id)}
                >
                  <span class="design-choice__swatch" style={{ background: d.themeColor }} aria-hidden="true" />
                  <span class="design-choice__name">{d.name}</span>
                  <span class="design-choice__desc">{d.description}</span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" class="btn btn--ghost btn--small" onClick={props.onGallery}>
            {sk.designs} →
          </button>
        </fieldset>

        <Segmented<WipeRule>
          id="wipe"
          label={sk.wipeRule}
          value={s.wipe}
          options={[
            { value: "always", label: sk.wipeAlways },
            { value: "firstFree", label: sk.wipeFirstFree },
          ]}
          onChange={(wipe) => props.onSettings({ ...s, wipe })}
        />

        <Segmented<string>
          id="show-count"
          label={sk.showCorrectCount}
          value={s.showCorrectCount ? "on" : "off"}
          options={[
            { value: "off", label: sk.off },
            { value: "on", label: sk.on },
          ]}
          onChange={(v) => props.onSettings({ ...s, showCorrectCount: v === "on" })}
        />
        <p class="field__hint">{sk.showCorrectCountHint}</p>

        <Segmented<string>
          id="reveal-each"
          label={sk.revealEach}
          value={s.revealEach ? "on" : "off"}
          options={[
            { value: "on", label: sk.revealEachOn },
            { value: "off", label: sk.revealEachOff },
          ]}
          onChange={(v) => props.onSettings({ ...s, revealEach: v === "on" })}
        />
        <p class="field__hint">{sk.revealEachHint}</p>

        <Segmented<string>
          id="haptics"
          label={sk.haptics}
          value={s.haptics ? "on" : "off"}
          options={[
            { value: "on", label: sk.on },
            { value: "off", label: sk.off },
          ]}
          onChange={(v) => props.onSettings({ ...s, haptics: v === "on" })}
        />
        <p class="field__hint">{sk.hapticsHint}</p>

        <Segmented<string>
          id="sound"
          label={sk.sound}
          value={s.sound ? "on" : "off"}
          options={[
            { value: "off", label: sk.off },
            { value: "on", label: sk.on },
          ]}
          onChange={(v) => props.onSettings({ ...s, sound: v === "on" })}
        />

        <fieldset class="field">
          <legend class="field__label">{sk.seenCount(props.seenCount)}</legend>
          <button
            type="button"
            class="btn btn--small"
            onClick={() => {
              props.onResetSeen();
              setDone(true);
            }}
          >
            {sk.resetSeen}
          </button>
          {done && <p class="notice">{sk.resetSeenDone}</p>}
        </fieldset>

        <fieldset class="field">
          <legend class="field__label">{sk.about}</legend>
          <p>{sk.aboutText}</p>
          <p>
            <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
              {sk.sourceCode}
            </a>
            {" · "}
            <a href={REPORT_FORM_URL} target="_blank" rel="noopener noreferrer">
              {sk.reportQuestion}
            </a>
          </p>
          {confirmClear ? (
            <div class="confirm">
              <p>{sk.clearDataConfirm}</p>
              <div class="row">
                <button type="button" class="btn btn--danger btn--small" onClick={props.onClearAll}>
                  {sk.yes}
                </button>
                <button type="button" class="btn btn--small" onClick={() => setConfirmClear(false)}>
                  {sk.no}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" class="btn btn--ghost btn--small" onClick={() => setConfirmClear(true)}>
              {sk.clearData}
            </button>
          )}
        </fieldset>
      </div>
    </div>
  );
}

export function Rules({ onBack }: { onBack: () => void }) {
  return (
    <div class="screen screen--rules">
      <TopBar title={sk.rules} onBack={onBack} />
      <div class="stack rules">
        {sk.rulesSections.map((sec) => (
          <section class="field">
            <h2 class="field__label">{sec.title}</h2>
            {sec.body.map((t) => (
              <p>{t}</p>
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
