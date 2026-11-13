import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import type { Pack } from "../content/types.ts";
import type { Card, ChoiceCard, NumberCard, OrderCard, PickCard } from "../engine/cards.ts";
import { formatNumber } from "../engine/cards.ts";
import {
  currentPlayer,
  isLastTurn,
  scoreCard,
  standings,
  type Action,
  type Answer,
  type GameState,
  type TurnResult,
} from "../engine/game.ts";
import { orderPoints, pickPoints } from "../engine/scoring.ts";
import { ratingsUrl, reportUrl } from "./links.ts";
import { KEYS, load, save } from "./storage.ts";
import { sk } from "./sk.ts";
import { tie } from "./typo.ts";

interface Props {
  state: GameState;
  dispatch: (a: Action) => void;
  onQuit: () => void;
  onPlayAgain: () => void;
  /** Packs in play, to list the game's cards on the game-over screen. */
  packs: Pack[];
}

const Dispatch = createContext<(a: Action) => void>(() => {});

export function Game(props: Props) {
  return (
    <Dispatch.Provider value={props.dispatch}>
      <GameInner {...props} />
    </Dispatch.Provider>
  );
}

function GameInner({ state, dispatch, onQuit, onPlayAgain, packs }: Props) {
  const [confirmQuit, setConfirmQuit] = useState(false);
  const s = state;
  // Close the quit dialog whenever the game moves on.
  useEffect(() => setConfirmQuit(false), [s.phase, s.round, s.turn]);
  const totalRounds = s.settings.target == null ? Math.max(s.round, Math.min(s.settings.rounds, s.deck.length)) : null;

  if (s.phase === "over") return <GameOver state={s} packs={packs} onHome={onQuit} onPlayAgain={onPlayAgain} />;

  if (s.phase === "handover") {
    const name = s.players[currentPlayer(s)].name;
    return (
      <button type="button" class="handover" onClick={() => dispatch({ type: "continue" })}>
        <span class="handover__round">{sk.round(s.round, totalRounds)}</span>
        <span class="handover__label">{sk.passTo}</span>
        <span class="handover__name">{name}</span>
        <span class="handover__hint">{sk.tapToContinue}</span>
      </button>
    );
  }

  return (
    <div class="screen screen--game">
      <header class="topbar">
        <span class="topbar__title">{sk.round(s.round, totalRounds)}</span>
        <ScoreStrip state={s} />
        <button type="button" class="btn btn--ghost btn--small topbar__quit" onClick={() => setConfirmQuit(true)}>
          {sk.quit}
        </button>
      </header>
      {confirmQuit && (
        <div class="confirm" role="alertdialog" aria-label={sk.quitConfirm}>
          <p>{sk.quitConfirm}</p>
          <div class="row">
            <button type="button" class="btn btn--danger" onClick={onQuit}>
              {sk.yes}
            </button>
            <button type="button" class="btn" onClick={() => setConfirmQuit(false)}>
              {sk.no}
            </button>
          </div>
        </div>
      )}
      {s.phase === "reveal" ? <Reveal state={s} dispatch={dispatch} /> : <Turn key={`${s.round}-${s.turn}`} state={s} dispatch={dispatch} />}
    </div>
  );
}

function ScoreStrip({ state }: { state: GameState }) {
  if (state.players.length < 2) return <span class="topbar__meta">{sk.pointsNow(state.players[0].score)}</span>;
  const active = state.phase === "reveal" ? -1 : currentPlayer(state);
  return (
    <ol class="scorestrip" aria-label={sk.scores}>
      {state.players.map((p, i) => (
        <li class={`scorestrip__item${i === active ? " scorestrip__item--active" : ""}`}>
          <span class="scorestrip__name">{p.name}</span>
          <span class="scorestrip__score">{p.score}</span>
        </li>
      ))}
    </ol>
  );
}

function CardHead({ card }: { card: Card }) {
  return (
    <div class="q__meta">
      <span class="q__pack">{card.packTitle}</span>
      {card.type === "choice" && card.compare && <span class="q__kind">{sk.compareLabel(card.compare)}</span>}
      <span class={`q__difficulty q__difficulty--${card.difficulty}`}>{sk.difficultyNames[card.difficulty]}</span>
      {card.asOf && <span class="q__asof">{sk.asOf(card.asOf)}</span>}
    </div>
  );
}

function Turn({ state, dispatch }: { state: GameState; dispatch: (a: Action) => void }) {
  const s = state;
  const player = s.players[currentPlayer(s)];
  const solo = s.players.length === 1;
  return (
    <section
      class={`q q--${s.card.type}${s.answer?.type === "pick" && s.answer.status !== "playing" ? ` q--${s.answer.status}` : ""}`}
    >
      <CardHead card={s.card} />
      {!solo && <p class="q__player">{player.name}</p>}
      <h1 class="q__prompt">{tie(s.card.prompt)}</h1>
      {s.card.type === "pick" && s.answer?.type === "pick" && (
        <PickTurn card={s.card} answer={s.answer} state={s} dispatch={dispatch} />
      )}
      {s.card.type === "order" && <OrderTurn card={s.card} state={s} dispatch={dispatch} />}
      {s.card.type === "number" && <NumberTurn card={s.card} state={s} dispatch={dispatch} />}
      {s.card.type === "choice" && <ChoiceTurn card={s.card} state={s} dispatch={dispatch} />}
    </section>
  );
}

function PickTurn({
  card,
  answer,
  state,
  dispatch,
}: {
  card: PickCard;
  answer: Extract<Answer, { type: "pick" }>;
  state: GameState;
  dispatch: (a: Action) => void;
}) {
  const found = answer.picks.filter((i) => card.options[i].correct).length;
  const wrong = answer.picks.length - found;
  const points = wrong && state.settings.wipe === "always" ? 0 : pickPoints(found);
  const over = state.phase === "turnEnd";
  // With per-turn answers the solution is drawn into the same grid the player just used.
  const reveal = over && state.settings.revealEach;
  return (
    <>
      <div class="turnbar">
        <span class="turnbar__points">
          <span class="turnbar__num">{points}</span> <span class="turnbar__unit">{sk.pointsUnit(points)}</span>
        </span>
        {!over && <span class="turnbar__next">{sk.nextPickWorth(found + 1)}</span>}
        {state.settings.showCorrectCount && <span class="turnbar__count">{sk.correctCount(card.correctCount)}</span>}
      </div>
      {!over && answer.picks.length === 0 && <p class="q__hint">{sk.pickHint}</p>}
      <ul class={`options${reveal ? " options--answered" : ""}`}>
        {card.options.map((o, i) => {
          const picked = answer.picks.includes(i);
          const m = optionMark(o.correct, picked, reveal);
          return (
            <li>
              <button
                type="button"
                class={`opt${m.cls}`}
                disabled={over || picked}
                aria-pressed={picked}
                onClick={() => dispatch({ type: "pick", option: i })}
              >
                <span class="opt__text">{tie(o.text)}</span>
                {m.label && <span class="visually-hidden">{` — ${m.label}`}</span>}
                {(picked || reveal) && <span class="opt__why">{tie(o.why)}</span>}
              </button>
            </li>
          );
        })}
      </ul>
      {over ? (
        <TurnEnd state={state}>
          <p class={`verdict verdict--${answer.status}`}>
            <strong class="verdict__title">
              {answer.status === "busted"
                ? sk.busted
                : answer.status === "complete"
                  ? sk.complete
                  : sk.banked(points)}
            </strong>
            {answer.status === "busted" && (
              <span class="verdict__detail">{state.settings.wipe === "always" ? sk.bustedLose : sk.bustedKeep}</span>
            )}
            {answer.status === "complete" && <span class="verdict__detail">{sk.pointsNow(points)}</span>}
          </p>
          {state.settings.revealEach && <CardFoot card={card} />}
        </TurnEnd>
      ) : (
        <div class="actions">
          <button
            type="button"
            class="btn btn--primary btn--block"
            disabled={found === 0}
            onClick={() => dispatch({ type: "bank" })}
          >
            {sk.bank(points)}
          </button>
        </div>
      )}
    </>
  );
}

function TurnEnd({ state, children }: { state: GameState; children?: ComponentChildren }) {
  const dispatch = useContext(Dispatch);
  // Alone with per-turn answers the round summary is skipped (see advance() in game.ts).
  const label = !isLastTurn(state)
    ? sk.next
    : state.players.length === 1 && state.settings.revealEach
      ? isFinalRound(state)
        ? sk.finalResults
        : sk.nextRound
      : sk.showResults;
  return (
    <div class="turnend">
      {children}
      <button type="button" class="btn btn--primary btn--block" onClick={() => dispatch({ type: "endTurn" })}>
        {label}
      </button>
    </div>
  );
}

function OrderTurn({ card, state, dispatch }: { card: OrderCard; state: GameState; dispatch: (a: Action) => void }) {
  const [arr, setArr] = useState(() => card.items.map((_, i) => i));
  const [drag, setDrag] = useState<{ item: number; y: number } | null>(null);
  const list = useRef<HTMLOListElement>(null);
  const grab = useRef(0);
  // Latest arrangement for pointer handlers that fire before a re-render.
  const live = useRef(arr);
  live.current = arr;
  const items = () => Array.from(list.current?.children ?? []) as HTMLElement[];
  // Place the dragged row under the finger; runs after the DOM has the new order.
  useLayoutEffect(() => {
    for (const el of items()) el.style.transform = "";
    if (!drag) return;
    const el = items()[arr.indexOf(drag.item)];
    if (el) el.style.transform = `translateY(${drag.y - el.offsetTop}px)`;
  });
  if (state.phase === "turnEnd") return <TurnReveal state={state} />;

  const move = (pos: number, d: number) => {
    const to = pos + d;
    if (to < 0 || to >= arr.length) return;
    const next = arr.slice();
    [next[pos], next[to]] = [next[to], next[pos]];
    setArr(next);
  };

  // Pointer drag (mouse and touch). The dragged row follows the finger;
  // the others reorder as its centre crosses their midpoints.
  const onDown = (e: PointerEvent, item: number) => {
    if (drag || !e.isPrimary || e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const el = e.currentTarget as HTMLElement;
    const top = list.current!.getBoundingClientRect().top;
    grab.current = e.clientY - top - el.offsetTop;
    el.setPointerCapture(e.pointerId);
    setDrag({ item, y: el.offsetTop });
  };
  const onMove = (e: PointerEvent) => {
    if (!drag || !e.isPrimary || !list.current) return;
    const y = e.clientY - list.current.getBoundingClientRect().top - grab.current;
    const els = items();
    const cur = live.current;
    const from = cur.indexOf(drag.item);
    const h = els[from]?.offsetHeight ?? 0;
    const centre = y + h / 2;
    let to = 0;
    els.forEach((el, i) => {
      if (i !== from && el.offsetTop + el.offsetHeight / 2 < centre) to++;
    });
    if (to !== from) {
      const next = cur.filter((x) => x !== drag.item);
      next.splice(to, 0, drag.item);
      live.current = next;
      setArr(next);
    }
    setDrag({ item: drag.item, y });
  };
  const onUp = (e: PointerEvent) => {
    if (e.isPrimary) setDrag(null);
  };

  return (
    <>
      <p class="q__hint">
        {sk.orderHint(card.direction)} {sk.dragHint}
      </p>
      <ol class={`order-list${drag ? " order-list--dragging" : ""}`} ref={list}>
        {arr.map((item, pos) => {
          const dragging = drag?.item === item;
          return (
            <li
              class={`order-item order-item--draggable${dragging ? " order-item--drag" : ""}`}
              key={item}
              onPointerDown={(e) => onDown(e, item)}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
            >
              <span class="order-item__rank">{pos + 1}</span>
              <span class="order-item__text">{tie(card.items[item].text)}</span>
              <span class="order-item__controls">
                <button type="button" class="btn btn--icon" aria-label={`${sk.moveUp}: ${card.items[item].text}`} disabled={pos === 0} onClick={() => move(pos, -1)}>
                  ↑
                </button>
                <button
                  type="button"
                  class="btn btn--icon"
                  aria-label={`${sk.moveDown}: ${card.items[item].text}`}
                  disabled={pos === arr.length - 1}
                  onClick={() => move(pos, 1)}
                >
                  ↓
                </button>
              </span>
            </li>
          );
        })}
      </ol>
      <div class="actions">
        <button type="button" class="btn btn--primary btn--block" onClick={() => dispatch({ type: "submitOrder", arrangement: arr })}>
          {sk.submit}
        </button>
      </div>
    </>
  );
}

export function parseNumber(raw: string): number {
  const cleaned = raw.replace(/[\s  ]/g, "").replace(",", ".");
  if (!/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

function NumberTurn({ card, state, dispatch }: { card: NumberCard; state: GameState; dispatch: (a: Action) => void }) {
  const [raw, setRaw] = useState("");
  const [error, setError] = useState(false);
  if (state.phase === "turnEnd") return <TurnReveal state={state} />;
  const submit = (e: Event) => {
    e.preventDefault();
    const v = parseNumber(raw);
    if (!Number.isFinite(v)) return setError(true);
    dispatch({ type: "submitNumber", value: v });
  };
  return (
    <form class="number-input" onSubmit={submit}>
      <label class="number-input__row">
        <input
          id="number-guess"
          class="input number-input__field"
          inputMode="decimal"
          autoComplete="off"
          placeholder={sk.numberPlaceholder}
          aria-label={card.unit ? `${sk.numberPlaceholder} (${card.unit})` : sk.numberPlaceholder}
          value={raw}
          onInput={(e) => {
            setRaw((e.target as HTMLInputElement).value);
            setError(false);
          }}
        />
        {card.unit && <span class="number-input__unit">{card.unit}</span>}
      </label>
      {error && <p class="error">{sk.numberInvalid}</p>}
      <div class="actions">
        <button type="submit" class="btn btn--primary btn--block">
          {sk.submit}
        </button>
      </div>
    </form>
  );
}

function ChoiceTurn({ card, state, dispatch }: { card: ChoiceCard; state: GameState; dispatch: (a: Action) => void }) {
  if (state.phase === "turnEnd") return <TurnReveal state={state} />;
  return (
    <>
    {card.compare && <p class="q__hint">{sk.compareHint(card.compare)}</p>}
    <ul class={`options options--choice${card.compare ? " options--compare" : ""}`}>
      {card.options.map((o, i) => (
        <li>
          <button type="button" class="opt" onClick={() => dispatch({ type: "submitChoice", option: i })}>
            <span class="opt__text">{tie(o.text)}</span>
          </button>
        </li>
      ))}
    </ul>
    </>
  );
}

/** Turn end for order, number and choice when answers are shown to each player. */
function TurnReveal({ state }: { state: GameState }) {
  const s = state;
  // Only reachable with revealEach off from a game saved before that setting existed: show nothing.
  if (!s.settings.revealEach) return <TurnEnd state={s} />;
  const r = s.results[s.results.length - 1];
  if (!r) return <TurnEnd state={s} />;
  // Ranked number scoring needs everyone's guess, so points come after the round.
  const points = s.card.type === "number" && s.players.length > 1 ? null : scoreCard(s.card, [r], s.settings.wipe, 1)[0];
  const title =
    s.card.type === "choice"
      ? points
        ? sk.correctTitle
        : sk.busted
      : s.card.type === "order"
        ? describe(s.card, r)
        : s.card.type === "number"
          ? sk.yourGuess(describe(s.card, r))
          : "";
  return (
    <>
      <InPlaceAnswer card={s.card} result={r} />
      <TurnEnd state={s}>
        <p class={`verdict verdict--${points ? "complete" : points === 0 ? "busted" : "saved"}`}>
          <strong class="verdict__title">{title}</strong>
          <span class="verdict__detail">{points == null ? sk.pointsAfterRound : `+${sk.pointsNow(points)}`}</span>
        </p>
        <CardFoot card={s.card} />
      </TurnEnd>
    </>
  );
}

/** How an option looks once answered: picked right/wrong, missed right, or a wrong one left alone. */
function optionMark(correct: boolean, picked: boolean, reveal: boolean): { cls: string; label: string | null } {
  if (picked) return correct ? { cls: " opt--correct", label: sk.correctMark } : { cls: " opt--wrong", label: sk.wrongMark };
  if (!reveal) return { cls: "", label: null };
  return correct ? { cls: " opt--correct opt--missed", label: sk.missedMark } : { cls: " opt--rest", label: sk.restMark };
}

/** One player's answer drawn on the layout they answered in (same grid, same order). */
function InPlaceAnswer({ card, result }: { card: Card; result: TurnResult }) {
  const a = result.answer;
  switch (card.type) {
    case "pick":
      return null; // PickTurn draws its own grid
    case "choice": {
      const chosen = a.type === "choice" ? a.option : -1;
      return (
        <ul class={`options options--choice options--answered${card.compare ? " options--compare" : ""}`}>
          {card.options.map((o, i) => {
            const m = optionMark(o.correct, i === chosen, true);
            return (
              <li>
                <button type="button" class={`opt${m.cls}`} disabled>
                  <span class="opt__text">{tie(o.text)}</span>
                  {m.label && <span class="visually-hidden">{` — ${m.label}`}</span>}
                  <span class="opt__why">{tie(o.why)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      );
    }
    case "order": {
      const arr = a.type === "order" ? a.arrangement : card.solution;
      return (
        <ol class="order-list order-list--answered">
          {arr.map((item, pos) => {
            const right = card.solution[pos] === item;
            const should = card.solution.indexOf(item) + 1;
            return (
              <li class={`order-item ${right ? "order-item--right" : "order-item--off"}`}>
                <span class="order-item__rank">{pos + 1}</span>
                <span class="order-item__text">
                  <span class="order-item__mark" aria-hidden="true">{right ? "✓ " : "✗ "}</span>
                  {tie(card.items[item].text)}
                  <span class="visually-hidden">{` — ${right ? sk.correctMark : sk.shouldBe(should)}`}</span>
                </span>
                <span class="order-item__value">{card.items[item].label}</span>
                {!right && (
                  <span class="order-item__should" aria-hidden="true">
                    {sk.shouldBe(should)}
                  </span>
                )}
                {card.items[item].why && <span class="order-item__why">{tie(card.items[item].why!)}</span>}
              </li>
            );
          })}
        </ol>
      );
    }
    case "number":
      return (
        <>
          <div class="number-input">
            <div class="number-input__row">
              <input
                class="input number-input__field"
                readOnly
                aria-label={card.unit ? `${sk.numberPlaceholder} (${card.unit})` : sk.numberPlaceholder}
                value={a.type === "number" && a.value != null ? formatNumber(a.value) : ""}
              />
              {card.unit && <span class="number-input__unit">{card.unit}</span>}
            </div>
          </div>
          <CardAnswer card={card} results={[]} names={() => ""} />
        </>
      );
  }
}

/** The solution of a card; `names` labels who chose each option. */
function CardAnswer({ card, results, names }: { card: Card; results: TurnResult[]; names: (r: TurnResult) => string }) {
  const who = (pred: (r: TurnResult) => boolean) => results.filter(pred).map(names);
  switch (card.type) {
    case "pick":
    case "choice":
      return (
        <ul class={`options options--reveal${card.type === "choice" ? " options--choice" : ""}`}>
          {card.options.map((o, i) => {
            const w = who((r) =>
              r.answer.type === "pick" ? r.answer.picks.includes(i) : r.answer.type === "choice" && r.answer.option === i,
            );
            return (
              <li class={`opt opt--static ${o.correct ? "opt--correct" : "opt--wrong"}`}>
                <span class="opt__text">{tie(o.text)}</span>
                <span class="visually-hidden">{` — ${o.correct ? sk.correctMark : sk.wrongMark}`}</span>
                <span class="opt__why">{tie(o.why)}</span>
                {w.length > 0 && <span class="opt__who">{w.join(", ")}</span>}
              </li>
            );
          })}
        </ul>
      );
    case "order":
      return (
        <ol class="order-list order-list--reveal">
          {card.solution.map((item, pos) => {
            const w = who((r) => r.answer.type === "order" && r.answer.arrangement[pos] === item);
            return (
              <li class="order-item">
                <span class="order-item__rank">{pos + 1}</span>
                <span class="order-item__text">{tie(card.items[item].text)}</span>
                <span class="order-item__value">{card.items[item].label}</span>
                {card.items[item].why && <span class="order-item__why">{tie(card.items[item].why!)}</span>}
                {w.length > 0 && <span class="opt__who">{w.join(", ")} ✓</span>}
              </li>
            );
          })}
        </ol>
      );
    case "number":
      return (
        <div class="number-reveal">
          <span class="number-reveal__label">{sk.correctAnswer}</span>
          <strong class="number-reveal__value">
            {formatNumber(card.answer)}
            {card.unit ? ` ${card.unit}` : ""}
          </strong>
          <span class="number-reveal__why">{tie(card.why)}</span>
        </div>
      );
  }
}

function CardFoot({ card }: { card: Card }) {
  return (
    <>
      {card.note && <p class="q__note">{tie(card.note)}</p>}
      <p class="q__source">
        {sk.source}:{" "}
        {/^https?:\/\//.test(card.source) ? (
          <a href={card.source} target="_blank" rel="noopener noreferrer">
            {prettySource(card.source)}
          </a>
        ) : (
          card.source
        )}
        {" · "}
        <a href={reportUrl(card)} target="_blank" rel="noopener noreferrer">
          {sk.reportCard}
        </a>
      </p>
    </>
  );
}

function Reveal({ state, dispatch }: { state: GameState; dispatch: (a: Action) => void }) {
  const s = state;
  const card = s.card;
  const over = useMemo(() => isFinalRound(s), [s]);
  const multi = s.players.length > 1;
  // Each player already saw the answer on their turn: the round ends with scores only.
  const full = !s.settings.revealEach;

  return (
    <section class={`q q--reveal q--${card.type}`}>
      <CardHead card={card} />
      <h1 class="q__prompt">{tie(card.prompt)}</h1>

      {full && (
        <CardAnswer
          card={card}
          results={card.type === "pick" && !multi ? [] : s.results}
          names={(r) => s.players[r.player].name}
        />
      )}

      {!full && <h2 class="q__results-title">{sk.results}</h2>}
      <ul class="results">
        {s.results.map((r) => (
          <li class={`result${r.points > 0 ? " result--scored" : ""}`}>
            <span class="result__name">{s.players[r.player].name}</span>
            <span class="result__detail">{describe(card, r)}</span>
            <span class="result__points">+{r.points}</span>
          </li>
        ))}
      </ul>

      {full && <CardFoot card={card} />}

      <div class="actions">
        <button type="button" class="btn btn--primary btn--block" onClick={() => dispatch({ type: "nextRound" })}>
          {over ? sk.finalResults : sk.nextRound}
        </button>
      </div>
    </section>
  );
}

/** Whether the current round is the last one (scores so far plus this card's points for a target game). */
function isFinalRound(s: GameState): boolean {
  if (s.settings.target != null) {
    if (s.deckPos >= s.deck.length - 1) return true;
    if (s.phase === "reveal") return s.players.some((p) => p.score >= s.settings.target!);
    const pending = scoreCard(s.card, s.results, s.settings.wipe, s.players.length);
    return s.players.some((p, i) => p.score + s.results.reduce((n, r, j) => n + (r.player === i ? pending[j] : 0), 0) >= s.settings.target!);
  }
  return s.round >= Math.min(s.settings.rounds, s.deck.length);
}

function describe(card: Card, r: TurnResult): string {
  const a = r.answer;
  if (card.type === "pick" && a.type === "pick") {
    const good = a.picks.filter((i) => card.options[i].correct).length;
    if (a.status === "busted") return `${sk.busted} (${good} ✓)`;
    return `${good} ✓`;
  }
  if (card.type === "order" && a.type === "order") {
    return sk.positions(orderPoints(card, a.arrangement).correctPositions, card.solution.length);
  }
  if (card.type === "number" && a.type === "number") return sk.numberGuess(a.value == null ? "–" : formatNumber(a.value));
  if (card.type === "choice" && a.type === "choice") return card.options[a.option]?.text ?? sk.noAnswer;
  return "";
}

function prettySource(url: string): string {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.hostname.replace(/^www\./, "") + u.pathname).replace(/\/$/, "");
  } catch {
    return url;
  }
}

const DEMO = new URLSearchParams(location.search).has("demo");

type Rating = "up" | "down" | "flag";
interface StoredRating {
  rating: Rating;
  /** Pack version when rated, so later fixes can be told apart. */
  version?: number;
}
const RATINGS: { value: Rating; icon: string; label: string }[] = [
  { value: "up", icon: "👍", label: sk.reviewUp },
  { value: "down", icon: "👎", label: sk.reviewDown },
  { value: "flag", icon: "⚠️", label: sk.reviewFlag },
];

/** Cards of the finished game, rated 👍 / 👎 / ⚠️; ratings stay on the device and can be sent as one issue. */
function Review({ state, packs }: { state: GameState; packs: Pack[] }) {
  const cards = useMemo(
    () =>
      state.played.flatMap((key) => {
        const [packId, qid] = key.split("/");
        const pack = packs.find((p) => p.id === packId);
        const q = pack?.questions.find((x) => x.id === qid);
        return pack && q ? [{ key, prompt: q.prompt, version: pack.version }] : [];
      }),
    [state.played, packs],
  );
  const [ratings, setRatings] = useState<Record<string, StoredRating>>(() => {
    const r = load<unknown>(KEYS.ratings, {});
    if (!r || typeof r !== "object" || Array.isArray(r)) return {};
    // Keep only well-formed entries: storage may hold data from another build.
    return Object.fromEntries(
      Object.entries(r as Record<string, unknown>).filter(([, v]) =>
        RATINGS.some((x) => x.value === (v as StoredRating | null)?.rating),
      ),
    ) as Record<string, StoredRating>;
  });
  if (cards.length === 0) return null;
  const rate = (key: string, version: number, rating: Rating) => {
    const next = { ...ratings };
    if (next[key]?.rating === rating) delete next[key];
    else next[key] = { rating, version };
    setRatings(next);
    // The design gallery (?demo=) must not touch real data.
    if (!DEMO) save(KEYS.ratings, next);
  };
  const rated = cards.filter((c) => ratings[c.key]);
  const lines = rated.map(
    (c) => `${RATINGS.find((r) => r.value === ratings[c.key].rating)!.icon} ${c.key} (v${ratings[c.key].version ?? c.version}): ${c.prompt}`,
  );
  return (
    <section class="review" aria-labelledby="review-title">
      <h2 class="review__title" id="review-title">
        {sk.reviewTitle}
      </h2>
      <ol class="review__list">
        {cards.map((c) => (
          <li class="review__item" key={c.key}>
            <span class="review__prompt">{tie(c.prompt)}</span>
            <span class="review__buttons" role="group" aria-label={c.prompt}>
              {RATINGS.map((r) => (
                <button
                  type="button"
                  class="btn btn--icon review__btn"
                  aria-pressed={ratings[c.key]?.rating === r.value}
                  aria-label={r.label}
                  title={r.label}
                  onClick={() => rate(c.key, c.version, r.value)}
                >
                  {r.icon}
                </button>
              ))}
            </span>
          </li>
        ))}
      </ol>
      <p class="field__hint">{sk.reviewHint}</p>
      {rated.length > 0 && (
        <a
          class="btn btn--small"
          href={ratingsUrl(lines)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {sk.reviewSend(rated.length)}
        </a>
      )}
    </section>
  );
}

function GameOver({
  state,
  packs,
  onHome,
  onPlayAgain,
}: {
  state: GameState;
  packs: Pack[];
  onHome: () => void;
  onPlayAgain: () => void;
}) {
  const table = standings(state.players);
  const winners = table.filter((e) => e.rank === 1);
  return (
    <div class="screen screen--over">
      <header class="over__head">
        <span class="over__label">{sk.gameOver}</span>
        <h1 class="over__title">
          {state.players.length === 1
            ? sk.pointsNow(state.players[0].score)
            : winners.length > 1
              ? sk.tie
              : sk.winner(winners[0].player.name)}
        </h1>
      </header>
      {state.players.length > 1 && (
        <ol class="scoreboard">
          {table.map((e) => (
            <li class={`score-row${e.rank === 1 ? " score-row--leader" : ""}`}>
              <span class="score-row__rank">{e.rank}.</span>
              <span class="score-row__name">{e.player.name}</span>
              <span class="score-row__score">{e.player.score}</span>
            </li>
          ))}
        </ol>
      )}
      <Review state={state} packs={packs} />
      <div class="actions">
        <button type="button" class="btn btn--primary btn--block" onClick={onPlayAgain}>
          {sk.playAgain}
        </button>
        <button type="button" class="btn btn--block" onClick={onHome}>
          {sk.home}
        </button>
      </div>
    </div>
  );
}
