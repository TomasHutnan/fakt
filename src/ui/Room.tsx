import qrcode from "qrcode-generator";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Card } from "../engine/cards.ts";
import type { TurnResult } from "../engine/game.ts";
import { nextPickWorth, pickPoints } from "../engine/scoring.ts";
import type { ClientAction, HiddenCard, MyAnswer, PlayerView, RoomView } from "../engine/room.ts";
import { timerShare } from "./timer.ts";
import { CONNECT_TIMEOUT_MS, type ClientState, type RoomClient } from "../net/client.ts";
import { CardAnswer, CardFoot, CardHead, describe, NumberInput, OrderInput } from "./Game.tsx";
import { QuickSettings } from "./QuickSettings.tsx";
import { PackPicker, SocialList, TitleList } from "./Comeback.tsx";
import { sk } from "./sk.ts";
import { tie } from "./typo.ts";

// Screens of a room: everyone on their own phone, plus an optional big screen.
// RoomBody is pure (view in, actions out), so the design gallery can show it without a server.

/** Fixed player colours, readable with white text in light and dark designs. */
export const PLAYER_COLORS = ["#2f6db5", "#c0571c", "#2c8a4b", "#8b47a8", "#b8324f", "#0f8a8a", "#a37a00", "#5a5fc2", "#c2408f", "#4f7a1f", "#7a5230", "#3b6f8f"];

export interface RoomBodyProps {
  view: RoomView;
  status: ClientState["status"];
  send: (a: ClientAction) => void;
  /** Server time now. */
  now: () => number;
  onLeave: () => void;
  /** Read-only big screen. */
  screen?: boolean;
}

/** Live room: subscribes to the client and keeps the screen awake. */
export function RoomScreen({ client, onLeave, onBack }: { client: RoomClient; onLeave: () => void; onBack: () => void }) {
  const [state, setState] = useState<ClientState>(client.state);
  useEffect(() => client.subscribe(setState), [client]);
  // A first connection that never opens: offer a retry instead of waiting forever.
  const [stuck, setStuck] = useState(false);
  const waiting = !state.view && !state.error;
  useEffect(() => {
    if (!waiting || stuck) return;
    const t = setTimeout(() => setStuck(true), CONNECT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [waiting, stuck, client]);
  useWakeLock();
  const screen = state.you == null && state.view != null && state.view.you == null;

  if (!state.view) {
    if (state.error) {
      return (
        <div class="screen screen--room">
          <p class="error" role="alert">
            {sk.roomErrors[state.error] ?? sk.roomErrors.invalid}
          </p>
          <div class="actions">
            <button type="button" class="btn btn--primary btn--block" onClick={onBack}>
              {sk.back}
            </button>
          </div>
        </div>
      );
    }
    if (stuck) {
      return (
        <div class="screen screen--room">
          <p class="error" role="alert">
            {sk.connectTimeout}
          </p>
          <div class="actions">
            <button type="button" class="btn btn--primary btn--block" onClick={() => (setStuck(false), client.reconnect())}>
              {sk.tryAgain}
            </button>
            <button type="button" class="btn btn--block" onClick={onBack}>
              {sk.back}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div class="screen screen--loading">
        <p class="loading">{sk.connecting}</p>
      </div>
    );
  }
  return (
    <>
      {state.error && LOST_SEAT.includes(state.error) ? (
        <div class="screen screen--room">
          <p class="error" role="alert">
            {state.error === "needName" ? sk.seatLost : sk.roomErrors[state.error]}
          </p>
          <div class="actions">
            <button type="button" class="btn btn--primary btn--block" onClick={onLeave}>
              {sk.home}
            </button>
          </div>
        </div>
      ) : (
        <RoomBody view={state.view} status={state.status} send={(a) => client.send(a)} now={() => client.now()} onLeave={onLeave} screen={screen} />
      )}
    </>
  );
}

/** Errors after which this device is no longer in the room (an action refused as invalid is not one). */
const LOST_SEAT: string[] = ["kicked", "expired", "noRoom", "needName", "full", "nameTaken", "badName", "proto", "busy"];

export function RoomBody(props: RoomBodyProps) {
  const { view } = props;
  const banner = props.status !== "open" && <p class="notice room-banner" role="status">{sk.reconnecting}</p>;
  if (props.screen) return <TvBody {...props} banner={banner} />;
  switch (view.phase) {
    case "lobby":
      return <Lobby {...props} banner={banner} />;
    case "choosePack":
      return <RoomPackPick {...props} banner={banner} />;
    case "question":
      return <Question {...props} banner={banner} />;
    case "reveal":
      return <RoomReveal {...props} banner={banner} />;
    case "over":
      return <RoomOver {...props} banner={banner} />;
  }
}

type Inner = RoomBodyProps & { banner: preact.ComponentChildren };

function isController(v: RoomView): boolean {
  return v.you != null && v.you === v.controller;
}

function joinUrl(code: string): string {
  return `${location.origin}${location.pathname}?r=${code}`;
}

function tvUrl(code: string): string {
  return `${location.host}${location.pathname.replace(/\/$/, "")}/?tv=${code}`;
}

function summary(v: RoomView): string {
  const s = v.settings;
  const length = s.target != null ? sk.target(s.target) : sk.rounds(s.rounds);
  const pace = s.pace === "none" ? sk.paceNone : s.pace === "calm" ? sk.paceCalm : sk.paceFast;
  return sk.roomSummary(s.mode === "mix" ? sk.modeMix : sk.modeClassic, length, pace, s.packCount);
}

export function Avatar({ player, dim }: { player: Pick<PlayerView, "name" | "color">; dim?: boolean }) {
  return (
    <span class={`avatar${dim ? " avatar--waiting" : ""}`} style={dim ? undefined : { background: PLAYER_COLORS[player.color % PLAYER_COLORS.length] }} aria-hidden="true">
      {initial(player.name)}
    </span>
  );
}

function initial(name: string): string {
  return [...name.trim()][0]?.toLocaleUpperCase("sk") ?? "?";
}

/** QR code of a link as inline SVG (dark modules on white, so phones can always scan it). */
export function Qr({ text, label }: { text: string; label: string }) {
  const path = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 4} ${r + 4}h1v1h-1z`;
    return { d, size: n + 8 };
  }, [text]);
  return (
    <svg class="qr" viewBox={`0 0 ${path.size} ${path.size}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={path.size} height={path.size} fill="#fff" />
      <path d={path.d} fill="#000" />
    </svg>
  );
}

function Leave({ onLeave }: { onLeave: () => void }) {
  const [ask, setAsk] = useState(false);
  return (
    <>
      <button type="button" class="btn btn--ghost btn--small topbar__quit" onClick={() => setAsk(true)}>
        {sk.leaveRoom}
      </button>
      {ask && (
        <div class="confirm" role="alertdialog" aria-label={sk.leaveConfirm}>
          <p>{sk.leaveConfirm}</p>
          <div class="row">
            <button type="button" class="btn btn--danger" onClick={onLeave}>
              {sk.leaveYes}
            </button>
            <button type="button" class="btn" onClick={() => setAsk(false)}>
              {sk.no}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function Lobby({ view, send, onLeave, banner }: Inner) {
  const [hint, setHint] = useState<string | null>(null);
  const url = joinUrl(view.code);
  const ctrl = isController(view);
  const controller = view.players.find((p) => p.id === view.controller);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setHint(sk.linkCopied);
    } catch {
      // No clipboard (e.g. not a secure page): show the link to copy by hand.
      setHint(url);
    }
  };
  return (
    <div class="screen screen--room screen--lobby">
      <header class="topbar">
        <span class="topbar__title">{sk.roomCode}</span>
        <QuickSettings />
        <Leave onLeave={onLeave} />
      </header>
      {banner}
      <div class="room-code" aria-label={`${sk.roomCode} ${view.code.split("").join(" ")}`}>
        {view.code}
      </div>
      <Qr text={url} label={sk.roomScan(location.host)} />
      <p class="field__hint room-center">{sk.roomScan(location.host)}</p>
      <div class="room-row">
        <button type="button" class="btn btn--small" onClick={copy}>
          {sk.shareLink}
        </button>
        <button type="button" class="btn btn--small" aria-expanded={hint === "tv"} onClick={() => setHint(hint === "tv" ? null : "tv")}>
          {sk.bigScreen}
        </button>
      </div>
      {hint && <p class="notice">{hint === "tv" ? sk.bigScreenHint(tvUrl(view.code)) : hint}</p>}
      <fieldset class="field">
        <legend class="field__label">{sk.inRoom(view.players.length)}</legend>
        <PlayerList view={view} kick={ctrl ? (id) => send({ type: "kick", id }) : undefined} />
      </fieldset>
      <p class="field__hint">{summary(view)}</p>
      <div class="actions">
        {ctrl ? (
          <button type="button" class="btn btn--primary btn--block" onClick={() => send({ type: "start" })}>
            {sk.start}
          </button>
        ) : (
          <p class="notice room-center">{sk.waitForHost(controller?.name ?? "")}</p>
        )}
      </div>
    </div>
  );
}

function PlayerList({ view, kick }: { view: RoomView; kick?: (id: string) => void }) {
  return (
    <ul class="room-players">
      {view.players.map((p) => (
        <li class={`room-player${p.connected ? "" : " room-player--away"}`} key={p.id}>
          <Avatar player={p} />
          <span class="room-player__name">{p.name}</span>
          <span class="room-player__tag">
            {[p.id === view.you && sk.youTag, p.id === view.hostId && sk.hostTag, !p.connected && sk.offlineTag].filter(Boolean).join(" · ")}
          </span>
          {kick && p.id !== view.you && (
            <button type="button" class="btn btn--icon" aria-label={sk.kick(p.name)} onClick={() => kick(p.id)}>
              ×
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Seconds left, re-rendered several times a second. */
function useSecondsLeft(deadline: number | null, now: () => number): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (deadline == null) return;
    const t = setInterval(() => tick((n) => n + 1), 250);
    return () => clearInterval(t);
  }, [deadline]);
  return deadline == null ? null : Math.max(0, Math.ceil((deadline - now()) / 1000));
}

function Timer({ view, now }: { view: RoomView; now: () => number }) {
  const left = useSecondsLeft(view.deadline, now);
  const total = useRef<number | null>(null);
  // Fallback when the server sent no full length: the first value seen for this deadline.
  const key = useRef<number | null>(null);
  if (key.current !== view.deadline) {
    key.current = view.deadline;
    total.current = left;
  }
  if (left == null) return <span class="topbar__meta">{sk.noLimit}</span>;
  const share = timerShare(view.deadline!, view.span, now(), total.current);
  return (
    <span class={`timer${left <= 5 ? " timer--low" : ""}`} role="timer" aria-label={sk.timeLeft(left)}>
      <span class="timer__bar" aria-hidden="true">
        <span class="timer__fill" style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
      <span class="timer__text">{sk.timeLeft(left)}</span>
    </span>
  );
}

function playerName(view: RoomView, id: string | null): string {
  return view.players.find((p) => p.id === id)?.name ?? "?";
}

function roundLabel(view: RoomView): string {
  return view.tiebreak ? sk.tiebreakRound : sk.round(view.round, view.totalRounds);
}

/** Players who answer the current card: everyone, or the tied leaders in a tie-break. */
function answering(view: RoomView, id: string | null): boolean {
  return !view.tiebreak || (id != null && view.tiebreak.includes(id));
}

/** Notes above a card: who chose the pack, who plays the tie-break. */
function CardNotes({ view }: { view: RoomView }) {
  return (
    <>
      {view.pickedBy && <p class="q__picked">{sk.pickedBy(playerName(view, view.pickedBy))}</p>}
      {view.tiebreak && <p class="q__tiebreak">{sk.tiebreakNote(sk.names(view.tiebreak.map((id) => playerName(view, id))))}</p>}
    </>
  );
}

function RoomPackPick({ view, send, now, onLeave, banner }: Inner) {
  const choice = view.packChoice!;
  const chooser = view.players.find((p) => p.id === choice.chooser);
  const mine = choice.chooser === view.you;
  const stand = !mine && isController(view) && !chooser?.connected;
  const name = chooser?.name ?? "?";
  return (
    <div class="screen screen--game screen--room">
      <header class="topbar topbar--sticky">
        <span class="topbar__title">{roundLabel(view)}</span>
        <Timer view={view} now={now} />
        <QuickSettings />
        <Leave onLeave={onLeave} />
      </header>
      {banner}
      <PackPicker
        options={choice.options}
        lead={mine ? sk.packPickYou : sk.packPickWait(name)}
        canChoose={mine || stand}
        onChoose={(packId) => send({ type: "choosePack", packId })}
        hint={stand ? sk.packPickAway(name) : view.deadline != null ? sk.packPickTimeout : undefined}
      />
    </div>
  );
}

/** Sends the phone's unsent answer to the room shortly after it stops changing, so time running out still counts it. */
function useDraft(send: (a: ClientAction) => void): (a: ClientAction) => void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(send);
  latest.current = send;
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return (a) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => latest.current(a), 300);
  };
}

function Question({ view, send, now, onLeave, banner }: Inner) {
  const card = view.card!;
  const mine = view.mine;
  const draft = useDraft(send);
  return (
    <div class="screen screen--game screen--room">
      <header class="topbar topbar--sticky">
        <span class="topbar__title">{roundLabel(view)}</span>
        <Timer view={view} now={now} />
        <QuickSettings />
        <Leave onLeave={onLeave} />
      </header>
      {banner}
      <section class={`q q--${card.type}${mine?.type === "pick" && mine.status !== "playing" ? ` q--${mine.status}` : ""}`}>
        <CardHead card={card} />
        <CardNotes view={view} />
        <h1 class="q__prompt">{tie(card.prompt)}</h1>
        {!answering(view, view.you) ? (
          <p class="notice" role="status">{sk.tiebreakWatch}</p>
        ) : (
          <>
            {card.type === "pick" && <PickInput card={card} mine={mine?.type === "pick" ? mine : null} send={send} />}
            {card.type === "order" &&
              (mine ? <Sent /> : <OrderInput items={card.items} direction={card.direction} onSubmit={(arrangement) => send({ type: "submitOrder", arrangement })} onDraft={(arrangement) => draft({ type: "draft", arrangement })} />)}
            {card.type === "number" &&
              (mine ? <Sent /> : <NumberInput unit={card.unit} decimals={card.decimals} onSubmit={(value) => send({ type: "submitNumber", value })} onDraft={(value) => draft({ type: "draft", value })} />)}
            {card.type === "choice" && <ChoiceInput card={card} mine={mine} send={send} />}
          </>
        )}
      </section>
      <Progress view={view} />
      {isController(view) && (
        <button type="button" class="btn btn--ghost btn--small" onClick={() => send({ type: "close" })}>
          {sk.closeRound}
        </button>
      )}
    </div>
  );
}

function Sent() {
  return (
    <p class="notice" role="status">
      {sk.answerSent} {sk.waitingOthers}
    </p>
  );
}

function PickInput({
  card,
  mine,
  send,
}: {
  card: Extract<HiddenCard, { type: "pick" }>;
  mine: Extract<MyAnswer, { type: "pick" }> | null;
  send: (a: ClientAction) => void;
}) {
  const picks = mine?.picks ?? [];
  const found = picks.filter((p) => p.correct).length;
  const points = mine?.points ?? 0;
  const over = mine != null && mine.status !== "playing";
  return (
    <>
      <div class="turnbar">
        <span class="turnbar__points">
          <span class="turnbar__num">{points}</span> <span class="turnbar__unit">{sk.pointsUnit(points)}</span>
        </span>
        {!over && <span class="turnbar__next">{sk.nextPickWorth(nextPickWorth(found))}</span>}
        {card.correctCount != null && <span class="turnbar__count">{sk.correctCount(card.correctCount)}</span>}
      </div>
      {!over && picks.length === 0 && <p class="q__hint">{sk.pickHint}</p>}
      <ul class="options">
        {card.options.map((o, i) => {
          const p = picks.find((x) => x.option === i);
          const cls = p ? (p.correct ? " opt--correct" : " opt--wrong") : "";
          return (
            <li>
              <button type="button" class={`opt${cls}`} disabled={over || !!p} aria-pressed={!!p} onClick={() => send({ type: "pick", option: i })}>
                <span class="opt__text">{tie(o.text)}</span>
                {p && <span class="visually-hidden">{` — ${p.correct ? sk.correctMark : sk.wrongMark}`}</span>}
                {p && <span class="opt__why">{tie(p.why)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {over ? (
        <div class="turnend">
          <p class={`verdict verdict--${mine!.status}`}>
            <strong class="verdict__title">
              {mine!.status === "busted" ? sk.busted : mine!.status === "complete" ? sk.complete : sk.banked(points)}
            </strong>
            <span class="verdict__detail">{sk.waitingOthers}</span>
          </p>
        </div>
      ) : (
        <div class="actions">
          <button type="button" class="btn btn--primary btn--block" disabled={found === 0} onClick={() => send({ type: "bank" })}>
            {sk.bank(points)}
          </button>
        </div>
      )}
    </>
  );
}

function ChoiceInput({ card, mine, send }: { card: Extract<HiddenCard, { type: "choice" }>; mine: MyAnswer | null; send: (a: ClientAction) => void }) {
  const chosen = mine?.type === "choice" ? mine.option : -1;
  return (
    <>
      {card.compare && <p class="q__hint">{sk.compareHint(card.compare)}</p>}
      <ul class={`options options--choice${card.compare ? " options--compare" : ""}`}>
        {card.options.map((o, i) => (
          <li>
            <button type="button" class="opt" disabled={chosen >= 0} aria-pressed={i === chosen} onClick={() => send({ type: "submitChoice", option: i })}>
              <span class="opt__text">{tie(o.text)}</span>
            </button>
          </li>
        ))}
      </ul>
      {chosen >= 0 && <Sent />}
    </>
  );
}

/** Who has answered (never what), plus pick-card drama: who banked, who busted. */
function Progress({ view }: { view: RoomView }) {
  const live = view.players.filter((p) => p.connected && (view.phase !== "question" || answering(view, p.id)));
  const done = live.filter((p) => p.done).length;
  const news = view.players.filter((p) => p.id !== view.you && p.pick && p.pick.status !== "playing");
  return (
    <div class="room-progress" aria-live="polite">
      <span class="room-progress__avatars">
        {view.players.map((p) => (
          <Avatar player={p} dim={!p.done} key={p.id} />
        ))}
      </span>
      <span class="room-progress__text">
        {view.phase === "question" ? sk.answered(done, live.length) : sk.readyCount(done, live.length)}
        {news.length > 0 && ` · ${news.map((p) => `${p.name} ${sk.pickStatus[p.pick!.status]}`).join(" · ")}`}
      </span>
    </div>
  );
}

function asTurns(view: RoomView): { turns: TurnResult[]; names: (r: TurnResult) => string } {
  const turns = view.results.map((r) => ({ player: view.players.findIndex((p) => p.id === r.playerId), answer: r.answer, points: r.points }));
  return { turns, names: (r) => view.players[r.player]?.name ?? "?" };
}

function RoomReveal({ view, send, now, onLeave, banner }: Inner) {
  const card = view.full!;
  const { turns, names } = asTurns(view);
  const me = view.players.find((p) => p.id === view.you);
  const ready = me?.done ?? false;
  return (
    <div class="screen screen--game screen--room">
      <header class="topbar topbar--sticky">
        <span class="topbar__title">{roundLabel(view)}</span>
        {view.paused ? <span class="topbar__meta paused">{sk.paused}</span> : view.deadline != null && <Timer view={view} now={now} />}
        {isController(view) && <PauseButton view={view} send={send} />}
        <QuickSettings />
        <Leave onLeave={onLeave} />
      </header>
      {banner}
      {view.paused && !isController(view) && <p class="notice" role="status">{sk.pausedBy(playerName(view, view.controller))}</p>}
      <section class={`q q--reveal q--${card.type}`}>
        <CardHead card={card} />
        <CardNotes view={view} />
        <h1 class="q__prompt">{tie(card.prompt)}</h1>
        <CardAnswer card={card} results={turns} names={names} />
        <RoundResults view={view} card={card} turns={turns} />
        <SocialList lines={view.social} name={(i) => view.players[i]?.name ?? "?"} />
        {!view.screens && view.players.length > 1 && (
          <section class="standings-now" aria-label={sk.standingsNow}>
            <h2 class="field__label">{sk.standingsNow}</h2>
            <Standings view={view} gains />
          </section>
        )}
        {view.screens ? me && view.players.length > 1 && <p class="standings-line" role="status">{sk.yourPlace(rankOf(view, me), me.score)}</p> : null}
        <CardFoot card={card} />
        <div class="actions">
          <button type="button" class="btn btn--primary btn--block" disabled={ready} onClick={() => send({ type: "ready" })}>
            {ready ? (view.paused ? sk.paused : sk.waitingOthers) : view.lastRound ? (toTiebreak(view) && view.canTiebreak ? sk.toTiebreak : sk.finalResults) : sk.nextRound}
          </button>
          <Progress view={view} />
          {isController(view) && ready && (
            <button type="button" class="btn btn--ghost btn--small" onClick={() => send({ type: "next" })}>
              {sk.nextForAll}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** The host holds the answers on show (no countdown, nobody moves on) to talk them through. */
function PauseButton({ view, send }: { view: RoomView; send: (a: ClientAction) => void }) {
  const label = view.paused ? sk.unpause : sk.pause;
  return (
    <button type="button" class="btn btn--ghost btn--small topbar__pause" aria-pressed={view.paused} aria-label={label} title={label} onClick={() => send({ type: view.paused ? "resume" : "pause" })}>
      {view.paused ? "\u25B6\uFE0E" : "\u23F8\uFE0E"}
    </button>
  );
}

function RoundResults({ view, card, turns }: { view: RoomView; card: Card; turns: TurnResult[] }) {
  const byPlayer = new Map(turns.map((t) => [t.player, t]));
  return (
    <ul class="results">
      {view.players.map((p, i) => {
        // In a tie-break only the tied leaders played.
        if (!answering(view, p.id)) return null;
        const t = byPlayer.get(i);
        return (
          <li class={`result${t && t.points > 0 ? " result--scored" : ""}${p.id === view.you ? " result--you" : ""}`} key={p.id}>
            <span class="result__name">
              <Avatar player={p} /> {p.name}
            </span>
            <span class="result__detail">{t ? describe(card, t) : sk.noAnswer}</span>
            <span class="result__points">+{t?.points ?? 0}</span>
          </li>
        );
      })}
    </ul>
  );
}

function rankOf(view: RoomView, p: PlayerView): number {
  return view.players.filter((o) => o.score > p.score).length + 1;
}

/** The ranking; with `gains`, each row also shows what this card was worth. */
function Standings({ view, gains }: { view: RoomView; gains?: boolean }) {
  const gained = new Map(view.results.map((r) => [r.playerId, r.points]));
  const sorted = view.players.slice().sort((a, b) => b.score - a.score);
  return (
    <ol class="scoreboard">
      {sorted.map((p) => {
        const rank = sorted.filter((o) => o.score > p.score).length + 1;
        return (
          <li class={`score-row${rank === 1 ? " score-row--leader" : ""}`} key={p.id}>
            <span class="score-row__rank">{rank}.</span>
            <span class="score-row__name">
              <Avatar player={p} /> <span class="score-row__text">{p.name}</span>
            </span>
            <span class="score-row__score">
              {gains && (gained.get(p.id) ?? 0) > 0 && <span class="score-row__gain">+{gained.get(p.id)} </span>}
              {p.score}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** The last card is done and the lead is shared: a tie-break comes next. */
function toTiebreak(view: RoomView): boolean {
  if (view.tiebreak || view.players.length < 2) return false;
  const top = Math.max(...view.players.map((p) => p.score));
  return view.players.filter((p) => p.score === top).length > 1;
}

function winnerTitle(view: RoomView): string {
  const top = Math.max(...view.players.map((p) => p.score));
  const winners = view.players.filter((p) => p.score === top);
  if (view.players.length === 1) return sk.pointsNow(top);
  return winners.length > 1 ? sk.tie : sk.winner(winners[0].name);
}

function TiebreakNote({ view }: { view: RoomView }) {
  if (!view.tiebreak) return null;
  const top = Math.max(...view.players.map((p) => p.score));
  const still = view.players.filter((p) => p.score === top).length > 1;
  return <p class="over__note">{still ? sk.tiebreakStillTied : sk.tiebreakDecided}</p>;
}

function RoomOver({ view, send, onLeave, banner }: Inner) {
  return (
    <div class="screen screen--over screen--room">
      {banner}
      <header class="over__head">
        <span class="over__label">{sk.gameOver}</span>
        <h1 class="over__title">{winnerTitle(view)}</h1>
        <TiebreakNote view={view} />
      </header>
      <Standings view={view} />
      <TitleList titles={view.titles} name={(i) => view.players[i]?.name ?? "?"} />
      <div class="actions">
        {isController(view) && (
          <button type="button" class="btn btn--primary btn--block" onClick={() => send({ type: "again" })}>
            {sk.again}
          </button>
        )}
        <button type="button" class="btn btn--block" onClick={onLeave}>
          {sk.home}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Big screen: read-only, large type, the shared drama.

/** Zoom that scales the big screen's column to the window, and the page height in zoomed pixels. */
function useTvFit(): { zoom: number; height: number } {
  const calc = () => {
    const zoom = Math.max(1, Math.min(2.4, Math.min(window.innerWidth / 720, window.innerHeight / 560)));
    return { zoom, height: window.innerHeight / zoom };
  };
  const [fit, setFit] = useState(calc);
  useEffect(() => {
    const on = () => setFit(calc());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return fit;
}

/** Pixels per second, and the pause at each end, of the big screen's slow scrolling. */
const SCROLL_SPEED = 28;
const SCROLL_HOLD_MS = 3500;

/**
 * A region of the big screen that never needs a hand on the mouse: when its content is
 * taller than the space, it scrolls down slowly, holds, goes back up and starts over.
 * With reduced motion it flips between the top and the bottom instead.
 */
function AutoScroll({ class: cls, children }: { class?: string; children: preact.ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let pos = 0;
    let dir = 1;
    let last = performance.now();
    let holdUntil = last + SCROLL_HOLD_MS;
    let raf = 0;
    const step = (t: number) => {
      const dt = Math.min(100, t - last);
      last = t;
      const max = el.scrollHeight - el.clientHeight;
      if (max <= 2) {
        pos = 0;
        el.scrollTop = 0;
        holdUntil = t + SCROLL_HOLD_MS;
      } else if (t >= holdUntil) {
        if (reduced) {
          pos = dir > 0 ? max : 0;
          dir = -dir;
          holdUntil = t + SCROLL_HOLD_MS * 2;
        } else {
          // Back up three times as fast as down.
          pos += dir * SCROLL_SPEED * (dir > 0 ? 1 : 3) * (dt / 1000);
          if (pos >= max || pos <= 0) {
            pos = Math.max(0, Math.min(max, pos));
            dir = -dir;
            holdUntil = t + SCROLL_HOLD_MS;
          }
        }
        el.scrollTop = pos;
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div ref={ref} class={`autoscroll${cls ? ` ${cls}` : ""}`}>
      {children}
    </div>
  );
}

/** Corner buttons of the big screen: full screen (where the browser allows it) and leave. */
function TvTools({ onLeave }: { onLeave: () => void }) {
  const [full, setFull] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const on = () => setFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };
  return (
    <div class="tv-tools">
      {document.fullscreenEnabled && (
        <button type="button" class="btn btn--ghost btn--small" onClick={toggle}>
          {full ? sk.fullscreenOff : sk.fullscreenOn}
        </button>
      )}
      <button
        type="button"
        class="btn btn--ghost btn--small"
        onClick={() => {
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
          onLeave();
        }}
      >
        {sk.tvClose}
      </button>
    </div>
  );
}

function TvBody({ view, now, onLeave, banner }: Inner) {
  const { zoom, height } = useTvFit();
  const host = view.players.find((p) => p.id === view.controller);
  const clock = view.paused ? <span class="topbar__meta paused">{sk.paused}</span> : view.deadline != null && <Timer view={view} now={now} />;
  let body;
  if (view.phase === "lobby") {
    body = (
      <div class="tv-lobby">
        <Qr text={joinUrl(view.code)} label={sk.tvJoinAt(location.host)} />
        <AutoScroll class="tv-lobby__side">
          <div class="stack">
            <span class="field__label">{sk.tvJoinAt(location.host)}</span>
            <div class="room-code">{view.code}</div>
            {view.players.length ? <PlayerList view={view} /> : <p class="field__hint">{sk.tvWaiting}</p>}
            <p class="field__hint">{sk.tvStartedBy(host?.name ?? "")}</p>
          </div>
        </AutoScroll>
      </div>
    );
  } else if (view.phase === "choosePack") {
    const choice = view.packChoice!;
    body = (
      <>
        <header class="topbar">
          <span class="topbar__title">{roundLabel(view)}</span>
          {clock}
        </header>
        <AutoScroll class="tv-fill">
          <PackPicker options={choice.options} lead={sk.packPickWait(playerName(view, choice.chooser))} canChoose={false} onChoose={() => {}} />
        </AutoScroll>
      </>
    );
  } else if (view.phase === "question") {
    const card = view.card!;
    body = (
      <>
        <header class="topbar">
          <span class="topbar__title">{roundLabel(view)}</span>
          {clock}
        </header>
        <section class={`q q--${card.type} tv-card`}>
          <CardHead card={card} />
          <CardNotes view={view} />
          <h1 class="q__prompt">{tie(card.prompt)}</h1>
          <AutoScroll class="tv-fill">
            {(card.type === "pick" || card.type === "choice") && (
              <ul class={`options${card.type === "choice" ? " options--choice" : ""}`}>
                {card.options.map((o) => (
                  <li class="opt opt--static">
                    <span class="opt__text">{tie(o.text)}</span>
                  </li>
                ))}
              </ul>
            )}
            {card.type === "choice" && card.compare && <p class="q__hint">{sk.compareHint(card.compare)}</p>}
            {card.type === "order" && <p class="q__hint">{sk.orderHint(card.direction)}</p>}
            {card.type === "order" && (
              <ul class="order-list">
                {card.items.map((it) => (
                  <li class="order-item order-item--static">
                    <span class="order-item__text">{tie(it.text)}</span>
                  </li>
                ))}
              </ul>
            )}
            {card.type === "number" && card.unit && <p class="q__hint">{card.unit}</p>}
          </AutoScroll>
        </section>
        <Progress view={view} />
      </>
    );
  } else if (view.phase === "reveal") {
    const card = view.full!;
    const { turns, names } = asTurns(view);
    body = (
      <>
        <header class="topbar">
          <span class="topbar__title">{roundLabel(view)}</span>
          {clock}
        </header>
        <section class={`q q--reveal q--${card.type} tv-card`}>
          <CardHead card={card} />
          <CardNotes view={view} />
          <h1 class="q__prompt">{tie(card.prompt)}</h1>
          <div class="tv-cols">
            <AutoScroll key={`a-${view.round}`}>
              <CardAnswer card={card} results={turns} names={names} />
            </AutoScroll>
            <AutoScroll key={`r-${view.round}`}>
              <div class="stack">
                <RoundResults view={view} card={card} turns={turns} />
                {view.players.length > 1 && (
                  <section class="standings-now" aria-label={sk.standingsNow}>
                    <h2 class="field__label">{sk.standingsNow}</h2>
                    <Standings view={view} gains />
                  </section>
                )}
                <SocialList lines={view.social} name={(i) => view.players[i]?.name ?? "?"} />
              </div>
            </AutoScroll>
          </div>
        </section>
      </>
    );
  } else {
    body = (
      <>
        <header class="over__head">
          <span class="over__label">{sk.gameOver}</span>
          <h1 class="over__title">{winnerTitle(view)}</h1>
          <TiebreakNote view={view} />
        </header>
        <div class="tv-cols">
          <AutoScroll>
            <Standings view={view} />
          </AutoScroll>
          <AutoScroll>
            <TitleList titles={view.titles} name={(i) => view.players[i]?.name ?? "?"} />
          </AutoScroll>
        </div>
      </>
    );
  }
  return (
    <div class={`screen screen--tv screen--tv-${view.phase}`} style={{ zoom, height: `${height}px` }}>
      <TvTools onLeave={onLeave} />
      {banner}
      {body}
    </div>
  );
}

/** Keeps the phone screen on while in a room (where supported; iOS PWAs may ignore it). */
function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let done = false;
    const get = async () => {
      try {
        if (!done && document.visibilityState === "visible" && "wakeLock" in navigator) lock = await navigator.wakeLock.request("screen");
      } catch {
        /* not allowed or unsupported */
      }
    };
    void get();
    const on = () => void get();
    document.addEventListener("visibilitychange", on);
    return () => {
      done = true;
      document.removeEventListener("visibilitychange", on);
      void lock?.release().catch(() => {});
    };
  }, []);
}

/** Code and name; connects and hands the client over once the room gave a seat. */
export function JoinScreen({
  initialCode,
  initialName,
  makeClient,
  onJoined,
  onWatch,
  onBack,
}: {
  initialCode: string;
  initialName: string;
  makeClient: (code: string, name: string) => RoomClient;
  onJoined: (client: RoomClient, name: string) => void;
  /** Open the room as a big screen instead (the same link works for the TV). */
  onWatch: (code: string) => void;
  onBack: () => void;
}) {
  const [code, setCode] = useState(initialCode);
  const [name, setName] = useState(initialName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const client = useRef<RoomClient | null>(null);
  useEffect(() => () => client.current?.close(), []);

  const cleanCode = () => code.toUpperCase().replace(/[^A-Z]/g, "");
  const watch = () => {
    const c = cleanCode();
    if (c.length !== 4) return setError(sk.roomErrors.noRoom);
    client.current?.close();
    client.current = null;
    onWatch(c);
  };
  const submit = (e: Event) => {
    e.preventDefault();
    const c = cleanCode();
    if (c.length !== 4) return setError(sk.roomErrors.noRoom);
    if (!name.trim()) return setError(sk.roomErrors.badName);
    client.current?.close();
    setBusy(true);
    setError(null);
    setTimedOut(false);
    const rc = makeClient(c, name.trim());
    client.current = rc;
    // The socket may never open (bad network, server down): stop waiting and let the user retry.
    const timer = setTimeout(() => {
      off();
      rc.close();
      if (client.current === rc) client.current = null;
      setBusy(false);
      setError(sk.connectTimeout);
      setTimedOut(true);
    }, CONNECT_TIMEOUT_MS);
    const off = rc.subscribe((st) => {
      if (st.you || st.error) clearTimeout(timer);
      if (st.you) {
        off();
        client.current = null;
        onJoined(rc, name.trim());
      } else if (st.error) {
        off();
        rc.close();
        client.current = null;
        setBusy(false);
        setError(sk.roomErrors[st.error] ?? sk.roomErrors.invalid);
      }
    });
  };

  return (
    <div class="screen screen--setup screen--join">
      <header class="topbar topbar--sticky">
        <button type="button" class="btn btn--ghost btn--small topbar__back" onClick={onBack}>
          ← {sk.back}
        </button>
        <h1 class="topbar__title">{sk.joinTitle}</h1>
      </header>
      <form class="stack" onSubmit={submit}>
        <label class="field">
          <span class="field__label">{sk.roomCode}</span>
          <input
            id="join-code"
            class="input room-code-input"
            value={code}
            maxLength={4}
            autoCapitalize="characters"
            autoComplete="off"
            spellcheck={false}
            placeholder={sk.codePlaceholder}
            onInput={(e) => setCode((e.target as HTMLInputElement).value.toUpperCase())}
          />
        </label>
        <label class="field">
          <span class="field__label">{sk.yourName}</span>
          <input
            id="join-name"
            class="input"
            value={name}
            maxLength={24}
            autoComplete="nickname"
            placeholder={sk.yourNamePlaceholder}
            onInput={(e) => setName((e.target as HTMLInputElement).value)}
          />
        </label>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <p class="field__hint">{sk.privacy}</p>
        <div class="actions">
          <button type="submit" class="btn btn--primary btn--block" disabled={busy}>
            {busy ? sk.connecting : timedOut ? sk.tryAgain : sk.enter}
          </button>
        </div>
        <div class="stack join-watch">
          <button type="button" class="btn btn--block" disabled={busy} onClick={watch}>
            {sk.watchHere}
          </button>
          <p class="field__hint">{sk.watchHereHint}</p>
        </div>
      </form>
    </div>
  );
}
