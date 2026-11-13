import { useState } from "preact/hooks";
import { DESIGNS } from "../designs/index.ts";
import { DEMO_SCREENS, type DemoScreen } from "./demo.ts";
import { sk } from "./sk.ts";

// Gallery: every design side by side, each screen rendered in a phone-sized iframe.

const LABELS: Record<DemoScreen, string> = {
  home: "Domov",
  setup: "Nová hra",
  handover: "Podaj telefón",
  play: "Výber",
  busted: "Vedľa",
  order: "Poradie",
  number: "Číslo",
  choice: "Jedna zo štyroch",
  reveal: "Výsledky kola",
  over: "Koniec",
};

export function Designs({ onBack }: { onBack: () => void }) {
  const [screen, setScreen] = useState<DemoScreen>("play");
  const base = `${location.pathname}`;
  return (
    <div class="gallery">
      <header class="gallery__head">
        <button type="button" class="gallery__back" onClick={onBack}>
          ← {sk.back}
        </button>
        <h1 class="gallery__title">{sk.designs}</h1>
        <div class="gallery__tabs" role="tablist">
          {DEMO_SCREENS.map((s) => (
            <button type="button" role="tab" aria-selected={s === screen} class="gallery__tab" onClick={() => setScreen(s)}>
              {LABELS[s]}
            </button>
          ))}
        </div>
      </header>
      <div class="gallery__grid">
        {DESIGNS.map((d) => (
          <figure class="gallery__item">
            <iframe
              class="gallery__frame"
              title={`${d.name}: ${LABELS[screen]}`}
              src={`${base}?design=${d.id}&demo=${screen}`}
              loading="lazy"
            />
            <figcaption class="gallery__caption">
              <strong>{d.name}</strong>
              <span>{d.description}</span>
              <a href={`${base}?design=${d.id}`} target="_blank" rel="noopener">
                Otvoriť ↗
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}
