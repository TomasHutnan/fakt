import { createContext, type ComponentChildren } from "preact";
import { useContext, useEffect, useMemo, useState } from "preact/hooks";
import type { Card, ChoiceCard, NumberCard, OrderCard, PickCard } from "../engine/cards.ts";
import { formatNumber } from "../engine/cards.ts";
import {
  currentPlayer,
  isLastTurn,
  standings,
  type Action,
  type Answer,
  type GameState,
  type TurnResult,
} from "../engine/game.ts";
import { orderPoints, pickPoints } from "../engine/scoring.ts";
import { sk } from "./sk.ts";
import { tie } from "./typo.ts";

interface Props {
  state: GameState;
  dispatch: (a: Action) => void;
  onQuit: () => void;
  onPlayAgain: () => void;
}

const Dispatch = createContext<(a: Action) => void>(() => {});

export function Game(props: Props) {
  return (
    <Dispatch.Provider value={props.dispatch}>
      <GameInner {...props} />
    </Dispatch.Provider>
  );
}

function GameInner({ state, dispatch, onQuit, onPlayAgain }: Props) {
  const [confirmQuit, setConfirmQuit] = useState(false);
  const s = state;
  // Close the quit dialog whenever the game moves on.
  useEffect(() => setConfirmQuit(false), [s.phase, s.round, s.turn]);
  const totalRounds = s.settings.target == null ? Math.max(s.round, Math.min(s.settings.rounds, s.deck.length)) : null;

  if (s.phase === "over") return <GameOver state={s} onHome={onQuit} onPlayAgain={onPlayAgain} />;

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
      {s.phase === "reveal" ? <Reveal state={s} dispatch={dispatch} /> : <Turn state={s} dispatch={dispatch} />}
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
      <ul class="options">
        {card.options.map((o, i) => {
          const picked = answer.picks.includes(i);
          const cls = picked ? (o.correct ? " opt--correct" : " opt--wrong") : "";
          return (
            <li>
              <button
                type="button"
                class={`opt${cls}`}
                disabled={over || picked}
                aria-pressed={picked}
                onClick={() => dispatch({ type: "pick", option: i })}
              >
                <span class="opt__text">{tie(o.text)}</span>
                {picked && <span class="visually-hidden">{` — ${o.correct ? sk.correctMark : sk.wrongMark}`}</span>}
                {picked && <span class="opt__why">{tie(o.why)}</span>}
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
  const last = isLastTurn(state);
  const dispatch = useContext(Dispatch);
  return (
    <div class="turnend">
      {children}
      <button type="button" class="btn btn--primary btn--block" onClick={() => dispatch({ type: "endTurn" })}>
        {last ? sk.showResults : sk.next}
      </button>
    </div>
  );
}

function OrderTurn({ card, state, dispatch }: { card: OrderCard; state: GameState; dispatch: (a: Action) => void }) {
  const [arr, setArr] = useState(() => card.items.map((_, i) => i));
  useEffect(() => setArr(card.items.map((_, i) => i)), [card.key, state.turn]);
  const move = (pos: number, d: number) => {
    const to = pos + d;
    if (to < 0 || to >= arr.length) return;
    const next = arr.slice();
    [next[pos], next[to]] = [next[to], next[pos]];
    setArr(next);
  };
  if (state.phase === "turnEnd") return <Saved state={state} />;
  return (
    <>
      <p class="q__hint">{sk.orderHint(card.direction)}</p>
      <ol class="order-list">
        {arr.map((item, pos) => (
          <li class="order-item" key={item}>
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
        ))}
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
  useEffect(() => {
    setRaw("");
    setError(false);
  }, [card.key, state.turn]);
  if (state.phase === "turnEnd") return <Saved state={state} />;
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
  if (state.phase === "turnEnd") return <Saved state={state} />;
  return (
    <ul class="options options--choice">
      {card.options.map((o, i) => (
        <li>
          <button type="button" class="opt" onClick={() => dispatch({ type: "submitChoice", option: i })}>
            <span class="opt__text">{tie(o.text)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Saved({ state }: { state: GameState }) {
  return (
    <TurnEnd state={state}>
      <p class="verdict verdict--saved">
        <strong class="verdict__title">{sk.answerSaved}</strong>
        {!isLastTurn(state) && <span class="verdict__detail">{sk.answerSavedHint}</span>}
      </p>
    </TurnEnd>
  );
}

function Reveal({ state, dispatch }: { state: GameState; dispatch: (a: Action) => void }) {
  const s = state;
  const card = s.card;
  const over = useMemo(() => {
    if (s.settings.target != null) return s.players.some((p) => p.score >= s.settings.target!);
    return s.round >= Math.min(s.settings.rounds, s.deck.length);
  }, [s]);
  const names = (pred: (r: TurnResult) => boolean) =>
    s.results.filter(pred).map((r) => s.players[r.player].name);
  const multi = s.players.length > 1;

  return (
    <section class={`q q--reveal q--${card.type}`}>
      <CardHead card={card} />
      <h1 class="q__prompt">{tie(card.prompt)}</h1>

      {card.type === "pick" && (
        <ul class="options options--reveal">
          {card.options.map((o, i) => {
            const who = names((r) => r.answer.type === "pick" && r.answer.picks.includes(i));
            return (
              <li class={`opt opt--static ${o.correct ? "opt--correct" : "opt--wrong"}`}>
                <span class="opt__text">{tie(o.text)}</span>
                <span class="visually-hidden">{` — ${o.correct ? sk.correctMark : sk.wrongMark}`}</span>
                <span class="opt__why">{tie(o.why)}</span>
                {multi && who.length > 0 && <span class="opt__who">{who.join(", ")}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {card.type === "choice" && (
        <ul class="options options--reveal options--choice">
          {card.options.map((o, i) => {
            const who = names((r) => r.answer.type === "choice" && r.answer.option === i);
            return (
              <li class={`opt opt--static ${o.correct ? "opt--correct" : "opt--wrong"}`}>
                <span class="opt__text">{tie(o.text)}</span>
                <span class="visually-hidden">{` — ${o.correct ? sk.correctMark : sk.wrongMark}`}</span>
                <span class="opt__why">{tie(o.why)}</span>
                {who.length > 0 && <span class="opt__who">{who.join(", ")}</span>}
              </li>
            );
          })}
        </ul>
      )}

      {card.type === "order" && (
        <ol class="order-list order-list--reveal">
          {card.solution.map((item, pos) => (
            <li class="order-item">
              <span class="order-item__rank">{pos + 1}</span>
              <span class="order-item__text">{tie(card.items[item].text)}</span>
              <span class="order-item__value">{card.items[item].label}</span>
              {card.items[item].why && <span class="order-item__why">{card.items[item].why}</span>}
            </li>
          ))}
        </ol>
      )}

      {card.type === "number" && (
        <div class="number-reveal">
          <span class="number-reveal__label">{sk.correctAnswer}</span>
          <strong class="number-reveal__value">
            {formatNumber(card.answer)}
            {card.unit ? ` ${card.unit}` : ""}
          </strong>
          <span class="number-reveal__why">{card.why}</span>
        </div>
      )}

      {card.note && <p class="q__note">{card.note}</p>}

      <ul class="results">
        {s.results.map((r) => (
          <li class={`result${r.points > 0 ? " result--scored" : ""}`}>
            <span class="result__name">{s.players[r.player].name}</span>
            <span class="result__detail">{describe(card, r)}</span>
            <span class="result__points">+{r.points}</span>
          </li>
        ))}
      </ul>

      <p class="q__source">
        {sk.source}:{" "}
        {/^https?:\/\//.test(card.source) ? (
          <a href={card.source} target="_blank" rel="noopener noreferrer">
            {prettySource(card.source)}
          </a>
        ) : (
          card.source
        )}
      </p>

      <div class="actions">
        <button type="button" class="btn btn--primary btn--block" onClick={() => dispatch({ type: "nextRound" })}>
          {over ? sk.finalResults : sk.nextRound}
        </button>
      </div>
    </section>
  );
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

function GameOver({ state, onHome, onPlayAgain }: { state: GameState; onHome: () => void; onPlayAgain: () => void }) {
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
