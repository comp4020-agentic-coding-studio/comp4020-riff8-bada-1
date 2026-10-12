import { randomBytes } from "node:crypto";
import { ACTIONS, MAX_HP, MAX_PLAY_POINTS, type Action, type Mark, type Points, type Thread } from "./db.ts";
import { DRAW_HEIGHT, DRAW_WIDTH, MAX_POINTS, drawingPath, parseDrawing } from "./drawing.ts";

export const MAX_NAME = 40;
export const MAX_BODY = 280;

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

const timeFormat = new Intl.DateTimeFormat("en-AU", {
  timeZone: "Australia/Sydney",
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatTime(iso: string): string {
  return timeFormat.format(new Date(iso));
}

// A fresh single-use token for each rendered play form. Nothing is stored
// until it's spent (see `play` in db.ts), so rendering costs nothing.
export const newToken = (): string => randomBytes(12).toString("base64url");

// A small heart outline, for decoration; always hidden from assistive tech.
const heartIcon = (cls = "deco-heart"): string =>
  `<svg class="${cls}" viewBox="0 0 16 14" aria-hidden="true" focusable="false"><path d="M8 13.2 1.9 7.4A3.9 3.9 0 0 1 8 2.6a3.9 3.9 0 0 1 6.1 4.8Z"/></svg>`;

const shieldIcon = `<svg class="shield-icon" viewBox="0 0 12 14" aria-hidden="true" focusable="false"><path d="M6 .8 11 2.6v4.1c0 3-2.1 5.3-5 6.5C3.1 12 1 9.7 1 6.7V2.6Z"/></svg>`;

// The pixel heart: an original 8 x 7 silhouette (wide shoulders, a notch,
// a two-step point), drawn once as a symbol. Each pixel class takes its
// colour from custom properties, so one symbol draws full, empty and
// poisoned hearts.
const HEART_PIXELS = [
  ".oo..oo.",
  "ohfoofso",
  "offffffo",
  "offfffso",
  ".offfso.",
  "..ofso..",
  "...oo...",
];
const heartSymbol = (() => {
  const cls: Record<string, string> = { o: "px-o", f: "px-f", h: "px-h", s: "px-s" };
  const rects: string[] = [];
  HEART_PIXELS.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (cls[c]) rects.push(`<rect class="${cls[c]}" x="${x}" y="${y}" width="1.02" height="1.02"/>`);
    }),
  );
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><symbol id="px-heart" viewBox="0 0 8 7">${rects.join("")}</symbol></svg>`;
})();

const CSS = `
  :root {
    color-scheme: light;
    --blush: #fbe8ee;
    --blush-deep: #f6d6e0;
    --cream: #fffaf7;
    --petal: #fff0f3;
    --rose: #b3294f;
    --rose-dark: #8f1d3e;
    --rose-soft: #f2b8c8;
    --plum: #3b1730;
    --plum-soft: #6a4560;
    --line: #ecc5d2;
    --shadow: 0 1px 2px rgb(91 26 58 / 0.08), 0 4px 14px rgb(91 26 58 / 0.07);
    --radius: 1rem;
    --focus: 0 0 0 3px var(--cream), 0 0 0 5px var(--rose-dark);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font: 1rem/1.55 system-ui, -apple-system, "Segoe UI", sans-serif;
    color: var(--plum);
    background:
      radial-gradient(circle at 12% 0%, #fff4f7 0, transparent 28rem),
      var(--blush);
    overflow-wrap: anywhere;
  }
  a { color: var(--rose-dark); text-underline-offset: 0.15em; }
  a:hover { color: var(--rose); }
  :focus-visible { outline: none; box-shadow: var(--focus); border-radius: 0.4rem; }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
  }
  .site-header, .layout, .readme { max-width: 72rem; margin: 0 auto; padding: 0 1rem; }
  .site-header { padding-top: 1.75rem; padding-bottom: 1rem; }
  .site-header h1 {
    display: flex; align-items: center; gap: 0.5rem;
    margin: 0; font-size: clamp(1.9rem, 5vw, 2.6rem); letter-spacing: -0.02em; line-height: 1.1;
  }
  .site-header h1 a { color: inherit; text-decoration: none; }
  .site-header p { margin: 0.35rem 0 0; color: var(--plum-soft); max-width: 40rem; }
  .deco-heart { width: 0.8em; height: 0.7em; fill: var(--rose); flex: none; }
  .site-header .deco-heart:nth-of-type(2) { width: 0.5em; fill: var(--rose-soft); align-self: flex-start; }
  h2 { font-size: 1.15rem; margin: 0 0 0.75rem; letter-spacing: -0.01em; }
  .panel {
    background: var(--cream);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 1rem 1.1rem;
  }
  .layout { display: grid; gap: 1.25rem; padding-bottom: 3rem; grid-template-areas: "composer" "points" "how" "wall"; }
  .composer { grid-area: composer; }
  .points { grid-area: points; }
  .how { grid-area: how; }
  .wall { grid-area: wall; min-width: 0; }
  @media (min-width: 60rem) {
    .layout {
      grid-template-columns: minmax(19rem, 23rem) minmax(0, 1fr);
      grid-template-areas: "composer wall" "points wall" "how wall";
      grid-template-rows: auto auto 1fr;
      align-items: start;
      column-gap: 2rem;
    }
  }
  @media (max-width: 59.99rem) {
    .points { position: sticky; top: 0.5rem; z-index: 2; }
  }
  form { margin: 0; }
  .field { margin: 0 0 0.75rem; }
  label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
  input[type="text"], input:not([type]), textarea {
    width: 100%; font: inherit; color: inherit;
    padding: 0.6rem 0.7rem; min-height: 2.75rem;
    background: #fff; border: 1.5px solid var(--line); border-radius: 0.65rem;
  }
  input:focus-visible, textarea:focus-visible { border-color: var(--rose); border-radius: 0.65rem; }
  textarea { resize: vertical; }
  button, .button {
    font: inherit; cursor: pointer; min-height: 2.75rem;
    display: inline-flex; align-items: center; justify-content: center; gap: 0.35rem;
    padding: 0.5rem 1.1rem; border-radius: 999px;
    border: 1.5px solid var(--rose); background: var(--rose); color: #fff; font-weight: 600;
    text-decoration: none;
  }
  button:hover { background: var(--rose-dark); border-color: var(--rose-dark); }
  button:disabled { opacity: 0.55; cursor: default; }
  .quiet {
    background: transparent; color: var(--plum-soft); border-color: var(--line); font-weight: 500;
  }
  .quiet:hover { background: var(--petal); color: var(--plum); border-color: var(--rose-soft); }
  .hint { font-size: 0.875rem; color: var(--plum-soft); margin: 0.5rem 0 0; }
  .form-error {
    margin: 0 0 0.75rem; padding: 0.5rem 0.75rem; border-radius: 0.6rem;
    background: #fde2e7; border: 1px solid #e79aae; color: #7a1631; font-weight: 600;
  }
  .notice {
    max-width: 72rem; margin: 0 auto 1rem; padding: 0 1rem;
  }
  .notice p {
    margin: 0; padding: 0.6rem 0.9rem; border-radius: 0.75rem;
    background: var(--cream); border: 1px solid var(--rose-soft); box-shadow: var(--shadow);
  }
  .draw-label { font-weight: 600; margin: 0 0 0.25rem; }
  .draw canvas {
    display: block; width: 100%;
    aspect-ratio: ${DRAW_WIDTH} / ${DRAW_HEIGHT};
    background: #fff; color: var(--plum);
    border: 1.5px dashed var(--rose-soft); border-radius: 0.65rem;
    touch-action: none; cursor: crosshair;
  }
  .draw canvas.has-drawing { border-style: solid; border-color: var(--rose); }
  .draw-controls { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem 0.75rem; margin: 0.5rem 0 0.75rem; }
  .draw-status { font-size: 0.875rem; color: var(--plum-soft); }

  .points h2 { margin: 0 0 0.35rem; }
  .points p { margin: 0; font-size: 0.9rem; color: var(--plum-soft); }
  .pips { display: flex; gap: 3px; margin: 0.25rem 0 0.5rem; }
  .pips i { width: 100%; max-width: 1.4rem; height: 0.5rem; border-radius: 99px; background: var(--blush-deep); }
  .pips i.on { background: var(--rose); }
  .how summary { font-weight: 700; cursor: pointer; min-height: 2rem; display: flex; align-items: center; gap: 0.4rem; }
  .how table { width: 100%; border-collapse: collapse; font-size: 0.85rem; margin-top: 0.75rem; }
  .how th, .how td { text-align: left; vertical-align: top; padding: 0.4rem 0.3rem; border-top: 1px solid var(--line); }
  .how ul { padding-left: 1.1rem; font-size: 0.875rem; margin: 0.75rem 0 0; }

  .wall-head { display: flex; align-items: baseline; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
  .wall-head p { margin: 0 0 0.75rem; font-size: 0.875rem; color: var(--plum-soft); }
  ol.threads, ol.replies { list-style: none; margin: 0; padding: 0; }
  ol.threads { display: grid; gap: 1.25rem; }
  .card {
    position: relative;
    background: var(--cream);
    border: 1px solid var(--line);
    border-radius: var(--radius);
    box-shadow: var(--shadow);
    padding: 0.9rem 1rem;
  }
  .card:focus-visible { border-radius: var(--radius); }
  .card.mine { border-color: var(--rose-soft); box-shadow: inset 4px 0 0 var(--rose), var(--shadow); }
  .card.resting { background: #f8eef1; }
  .card.withdrawn {
    background: transparent; box-shadow: none; border-style: dashed; color: var(--plum-soft);
    padding: 0.55rem 0.9rem;
  }
  .mark-body { margin: 0 0 0.4rem; white-space: pre-wrap; font-size: 1.05rem; }
  .mark-meta { margin: 0; font-size: 0.85rem; color: var(--plum-soft); display: flex; flex-wrap: wrap; gap: 0 0.4rem; align-items: center; }
  .author { font-weight: 700; color: var(--plum); }
  .badge {
    display: inline-flex; align-items: center; gap: 0.25em;
    font-size: 0.75rem; font-weight: 600; line-height: 1.6;
    border-radius: 99px; padding: 0 0.55em; background: var(--petal); border: 1px solid var(--rose-soft); color: var(--rose-dark);
  }
  .placeholder { margin: 0; font-style: italic; }
  .mark-drawing {
    display: block; width: 100%; max-width: 34rem; height: auto; margin: 0 0 0.5rem;
    background: #fff; border-radius: 0.6rem;
    fill: none; stroke: var(--plum); stroke-width: 4; stroke-linecap: round; stroke-linejoin: round;
  }
  ol.replies { margin: 0.6rem 0 0 1rem; padding-left: 0.9rem; border-left: 2px solid var(--rose-soft); display: grid; gap: 0.6rem; }
  ol.replies:empty { display: none; }
  ol.replies .card { padding: 0.7rem 0.85rem; background: var(--petal); }
  ol.replies .card.withdrawn { background: transparent; }
  ol.replies .mark-body { font-size: 1rem; }

  .health { display: flex; flex-wrap: wrap; align-items: center; gap: 0.35rem 0.5rem; margin: 0.6rem 0 0; font-size: 0.8rem; }
  .hearts { display: inline-flex; flex-wrap: wrap; gap: 2px; padding: 3px 4px; border: 2px solid transparent; border-radius: 6px; }
  .hearts svg { width: 20px; height: 17.5px; display: block; shape-rendering: crispEdges; }
  .heart { --o: #4a1832; --f: #e2456f; --h: #ffc1d1; --s: #a8234a; }
  .heart.empty { --o: #b58899; --f: #f7e4ea; --h: #f7e4ea; --s: #f7e4ea; }
  .poisoned .heart:not(.empty) { --o: #1f4a26; --f: #3f9b4b; --h: #b5e8b0; --s: #276b32; }
  .px-o { fill: var(--o); } .px-f { fill: var(--f); } .px-h { fill: var(--h); } .px-s { fill: var(--s); }
  .hp-count { font-weight: 700; font-variant-numeric: tabular-nums; }
  .status-badge { font-size: 0.75rem; font-weight: 700; padding: 0 0.5em; border-radius: 99px; line-height: 1.6; }
  .status-badge.poison { background: #e1f3dc; color: #1f5a29; border: 1px solid #8ccf86; }
  .status-badge.shield { background: #e9edf1; color: #39424c; border: 1px solid #9aa4ae; display: inline-flex; gap: 0.2em; align-items: center; }
  .status-badge.resting { background: #efe3ea; color: var(--plum); border: 1px solid #c9a9bb; }
  .shield-icon { width: 0.8em; height: 0.95em; fill: #8b96a1; stroke: #4c5660; stroke-width: 1; }
  .shielded .hearts {
    position: relative;
    border-color: #9aa4ae;
    background:
      radial-gradient(circle, #eef1f4 0 1px, #69737d 1.5px 2px, transparent 2.5px) left 1px top 1px / 6px 6px no-repeat,
      radial-gradient(circle, #eef1f4 0 1px, #69737d 1.5px 2px, transparent 2.5px) right 1px top 1px / 6px 6px no-repeat,
      radial-gradient(circle, #eef1f4 0 1px, #69737d 1.5px 2px, transparent 2.5px) left 1px bottom 1px / 6px 6px no-repeat,
      radial-gradient(circle, #eef1f4 0 1px, #69737d 1.5px 2px, transparent 2.5px) right 1px bottom 1px / 6px 6px no-repeat,
      linear-gradient(#f7f8fa, #d5dbe1);
    box-shadow: inset 1px 1px 0 #fff, inset -1px -1px 0 #7f8993, 0 0 0 1px #c3cad1;
    padding: 3px 8px;
  }

  .card-actions { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 0.5rem; margin-top: 0.6rem; }
  .play { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .play button {
    min-height: 2.75rem; padding: 0.3rem 0.75rem; font-size: 0.875rem;
    background: #fff; color: var(--plum); border-color: var(--rose-soft); font-weight: 600;
  }
  .play button:hover { background: var(--petal); border-color: var(--rose); color: var(--plum); }
  .play .cost { font-weight: 500; color: var(--plum-soft); font-size: 0.8rem; }
  details.withdraw { margin-left: auto; }
  details.withdraw > summary {
    list-style: none; cursor: pointer; font-size: 0.85rem; color: var(--plum-soft);
    min-height: 2.75rem; display: inline-flex; align-items: center; padding: 0 0.4rem;
    text-decoration: underline; text-underline-offset: 0.15em;
  }
  details.withdraw > summary::-webkit-details-marker { display: none; }
  details.withdraw[open] { flex-basis: 100%; }
  .confirm {
    margin-top: 0.25rem; padding: 0.75rem; border-radius: 0.75rem;
    background: #fff; border: 1px solid var(--line); font-size: 0.9rem;
  }
  .confirm p { margin: 0 0 0.6rem; }
  .confirm form { display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center; }
  .confirm .button.quiet { min-height: 2.75rem; }

  details.reply-box { margin: 0.6rem 0 0 1rem; }
  details.reply-box > summary {
    list-style: none; cursor: pointer; display: inline-flex; align-items: center; gap: 0.35rem;
    min-height: 2.75rem; padding: 0.35rem 1rem; border-radius: 999px;
    border: 1.5px solid var(--rose-soft); background: var(--cream); font-weight: 600; color: var(--rose-dark);
  }
  details.reply-box > summary::-webkit-details-marker { display: none; }
  details.reply-box > summary:hover { border-color: var(--rose); }
  details.reply-box[open] > summary { border-bottom-left-radius: 0.4rem; }
  .reply-form { margin-top: 0.5rem; padding: 0.85rem; border-radius: var(--radius); background: var(--cream); border: 1px solid var(--rose-soft); }
  .replying-to { margin: 0 0 0.6rem; font-size: 0.875rem; color: var(--plum-soft); padding: 0.4rem 0.6rem; border-left: 3px solid var(--rose-soft); background: var(--petal); border-radius: 0 0.4rem 0.4rem 0; }
  .emoji-picker { display: none; flex-wrap: wrap; gap: 0.35rem; margin: 0 0 0.75rem; }
  .js .emoji-picker { display: flex; }
  .emoji-picker button { min-width: 2.75rem; padding: 0.2rem 0.5rem; background: #fff; border-color: var(--line); font-size: 1.15rem; }
  .emoji-picker button:hover { background: var(--petal); border-color: var(--rose-soft); }
  .thread-closed { margin: 0.5rem 0 0 1rem; font-size: 0.85rem; color: var(--plum-soft); font-style: italic; }
  .wall-empty { text-align: center; padding: 2rem 1rem; color: var(--plum-soft); }
  .wall-empty .deco-heart { width: 2.5rem; height: 2.2rem; display: block; margin: 0 auto 0.5rem; fill: var(--rose-soft); }

  .thread.arrive > .card, li.arrive > .card { animation: arrive 1.2s ease-out; }
  @keyframes arrive { from { box-shadow: 0 0 0 3px var(--rose-soft), var(--shadow); } }
  .fx {
    position: absolute; right: 0.75rem; top: 0.5rem; pointer-events: none;
    font-weight: 800; font-size: 0.95rem; color: var(--rose-dark);
    display: flex; gap: 2px; align-items: center;
    animation: fx-rise 1.1s ease-out forwards;
  }
  .fx .deco-heart { width: 0.8rem; height: 0.7rem; }
  .fx.minus { color: #7a1631; }
  .fx.poison { color: #1f5a29; }
  .fx.poison i { width: 0.6rem; height: 0.6rem; border-radius: 50%; background: #9bd88f; border: 1px solid #3f9b4b; display: inline-block; }
  .fx.absorb { color: #39424c; }
  @keyframes fx-rise { from { opacity: 0; transform: translateY(0.6rem); } 25% { opacity: 1; } to { opacity: 0; transform: translateY(-1.1rem); } }
  .card.wobble { animation: wobble 0.4s ease-in-out; }
  @keyframes wobble { 25% { transform: rotate(-1deg); } 75% { transform: rotate(1deg); } }
  .heart.lost { animation: lost 0.8s steps(2) 2; }
  @keyframes lost { 50% { opacity: 0.25; } }
  .shielded.closing .hearts { animation: shield-close 0.45s ease-out; }
  @keyframes shield-close { from { box-shadow: 0 0 0 5px rgb(154 164 174 / 0.5); border-color: transparent; } }
  .crack {
    position: absolute; inset: -2px; border: 2px solid #9aa4ae; border-radius: 6px; pointer-events: none;
    background: linear-gradient(115deg, transparent 46%, #69737d 47% 49%, transparent 50%);
    animation: crack 0.7s ease-out forwards;
  }
  .hearts { position: relative; }
  @keyframes crack { from { opacity: 1; } to { opacity: 0; transform: scale(1.05); } }
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
    .fx { opacity: 1; }
    .crack { opacity: 0.8; }
  }

  .readme { max-width: 46rem; padding-bottom: 3rem; }
  .readme article { padding: 1.25rem 1.5rem; }
  .readme table { width: 100%; border-collapse: collapse; font-size: 0.9rem; display: block; overflow-x: auto; }
  .readme th, .readme td { text-align: left; padding: 0.4rem 0.5rem; border-top: 1px solid var(--line); vertical-align: top; }
  .readme h2 { margin-top: 1.75rem; font-size: 1.3rem; }
  footer { max-width: 72rem; margin: 0 auto; padding: 0 1rem 2rem; font-size: 0.85rem; color: var(--plum-soft); }
`;

export function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${CSS}</style>
</head>
<body>
${heartSymbol}
${body}
</body>
</html>
`;
}

export function siteHeader(tagline: string): string {
  return `<header class="site-header">
  <h1><a href="/">Marks</a> ${heartIcon()}${heartIcon()}</h1>
  <p>${tagline}</p>
</header>`;
}

const ACTION_UI: Record<Action, { emoji: string; label: string; does: string }> = {
  heal: { emoji: "👍", label: "Heal", does: "restore 1 heart" },
  attack: { emoji: "👎", label: "Attack", does: "deal 1 damage" },
  poison: { emoji: "🤮", label: "Poison", does: "1 damage now, then 1 after 10 and 20 seconds" },
  shield: { emoji: "😍", label: "Shield", does: "absorb the next damaging hit" },
};

const pts = (n: number): string => `${n} ${n === 1 ? "pt" : "pts"}`;

// Ten decorative hearts plus one text summary for assistive tech, and
// visible text for every state so colour is never the only signal.
export function healthDisplay(mark: Mark): string {
  const poisoned = mark.poison_ticks > 0;
  const resting = mark.hp === 0;
  const hearts = Array.from(
    { length: MAX_HP },
    (_, i) =>
      `<svg class="heart${i < mark.hp ? "" : " empty"}" viewBox="0 0 8 7"><use href="#px-heart"/></svg>`,
  ).join("");
  const summary = [
    `Health ${mark.hp} of ${MAX_HP}`,
    resting ? "resting" : "",
    poisoned ? "poisoned" : "",
    mark.shield ? "shielded" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return `<div class="health${poisoned ? " poisoned" : ""}${mark.shield ? " shielded" : ""}" data-hp="${mark.hp}">
    <span class="sr-only">${summary}.</span>
    <span class="hearts" aria-hidden="true">${hearts}</span>
    <span class="hp-count" aria-hidden="true">${mark.hp}/${MAX_HP}</span>${
      resting ? `\n    <span class="status-badge resting" aria-hidden="true">Resting</span>` : ""
    }${poisoned ? `\n    <span class="status-badge poison" aria-hidden="true">Poisoned</span>` : ""}${
      mark.shield ? `\n    <span class="status-badge shield" aria-hidden="true">${shieldIcon}Shield</span>` : ""
    }
  </div>`;
}

function playForm(mark: Mark, mine: boolean): string {
  const actions = (Object.keys(ACTIONS) as Action[]).filter((a) => ACTIONS[a].own === mine);
  const buttons = actions
    .map((a) => {
      const { emoji, label, does } = ACTION_UI[a];
      const cost = ACTIONS[a].cost;
      return `<button type="submit" name="action" value="${a}" data-key="${a}" aria-label="${label}, ${cost} ${cost === 1 ? "point" : "points"}: ${does}" title="${label} (${pts(cost)}): ${does}"><span aria-hidden="true">${emoji}</span>${a === "shield" ? shieldIcon : ""} ${label} <span class="cost">${pts(cost)}</span></button>`;
    })
    .join("\n      ");
  return `<form class="play" method="post" action="/play" data-enhance="play">
      <input type="hidden" name="target" value="${mark.id}">
      <input type="hidden" name="token" value="${newToken()}">
      ${buttons}
    </form>`;
}

function withdrawControl(mark: Mark): string {
  const what = mark.parent_id === null ? "note" : "reply";
  const result =
    what === "note"
      ? "Its words and drawing are deleted for good, replies from other people stay, and the thread closes."
      : "Its words are deleted for good and a small placeholder stays.";
  return `<details class="withdraw">
      <summary data-key="withdraw">Withdraw<span class="sr-only"> this ${what}</span></summary>
      <div class="confirm">
        <p>Withdraw this ${what}? ${result} You can't undo it. Only this browser can withdraw it: it's tied to this browser's cookie, not your name.</p>
        <form method="post" action="/withdraw" data-enhance="withdraw">
          <input type="hidden" name="target" value="${mark.id}">
          <button type="submit" data-key="withdraw-confirm">Withdraw ${what}</button>
          <a class="button quiet cancel" href="/#m${mark.id}" data-key="withdraw-cancel">Cancel</a>
        </form>
      </div>
    </details>`;
}

// One note or reply. `playable` is false under a withdrawn note.
export function markCard(mark: Mark, visitorId: string, playable: boolean): string {
  const kind = mark.parent_id === null ? "note" : "reply";
  if (mark.withdrawn_at) {
    return `<article class="card ${kind} withdrawn" id="m${mark.id}" data-mark="${mark.id}" tabindex="-1">
    <p class="placeholder">${kind === "note" ? "This note was withdrawn." : "Reply withdrawn."}</p>
  </article>`;
  }
  const mine = mark.visitor_id === visitorId;
  const drawing = mark.drawing ? parseDrawing(mark.drawing) : null;
  const svg = drawing
    ? `<svg class="mark-drawing" viewBox="0 0 ${DRAW_WIDTH} ${DRAW_HEIGHT}" role="img" aria-label="Drawing by ${escapeHtml(mark.name)}"><path d="${drawingPath(drawing)}"/></svg>\n    `
    : "";
  const body = mark.body ? `<p class="mark-body">${escapeHtml(mark.body)}</p>\n    ` : "";
  const classes = ["card", kind, mine ? "mine" : "", mark.hp === 0 ? "resting" : ""].filter(Boolean).join(" ");
  const controls = [playable ? playForm(mark, mine) : "", mine ? withdrawControl(mark) : ""].filter(Boolean);
  return `<article class="${classes}" id="m${mark.id}" data-mark="${mark.id}" tabindex="-1">
    ${svg}${body}<p class="mark-meta"><span class="author">${escapeHtml(mark.name)}</span><span aria-hidden="true">·</span><time datetime="${mark.created_at}">${formatTime(mark.created_at)}</time>${
      mine ? `<span class="badge">yours</span>` : ""
    }</p>
    ${healthDisplay(mark)}${controls.length ? `\n    <div class="card-actions">\n    ${controls.join("\n    ")}\n    </div>` : ""}
  </article>`;
}

const EMOJI = [
  ["❤️", "heart"],
  ["😊", "smile"],
  ["🤗", "hug"],
  ["✨", "sparkle"],
  ["🎉", "celebration"],
];

export interface ReplyDraft {
  parent: number;
  name: string;
  body: string;
  error: string;
}

function replyBox(note: Mark, name: string, draft: ReplyDraft | undefined): string {
  const id = note.id;
  const mine = draft?.parent === id ? draft : undefined;
  if (note.withdrawn_at) {
    // a reply refused because the thread closed meanwhile: keep its text
    // on screen so it isn't lost
    const kept = mine
      ? `
  <div class="reply-form">
    <p class="form-error" role="alert">${escapeHtml(mine.error)}</p>
    <label for="r${id}-body">Your reply (not sent)</label>
    <textarea id="r${id}-body" readonly rows="2">${escapeHtml(mine.body)}</textarea>
  </div>`
      : "";
    return `<p class="thread-closed">This thread is closed to new replies.</p>${kept}`;
  }
  const excerpt = note.body
    ? `“${escapeHtml(note.body.length > 90 ? `${note.body.slice(0, 90)}…` : note.body)}”`
    : "their drawing";
  return `<details class="reply-box"${mine ? " open" : ""}>
    <summary data-key="reply">${heartIcon()}Reply<span class="sr-only"> to ${escapeHtml(note.name)}</span></summary>
    <form class="reply-form" method="post" action="/reply#m${id}" data-enhance="reply">
      <input type="hidden" name="parent" value="${id}">
      <p class="replying-to">Replying to <strong>${escapeHtml(note.name)}</strong>: ${excerpt}</p>
      ${mine?.error ? `<p class="form-error" role="alert">${escapeHtml(mine.error)}</p>` : `<p class="form-error" role="alert" hidden></p>`}
      <div class="field">
        <label for="r${id}-name">Your name</label>
        <input id="r${id}-name" name="name" required maxlength="${MAX_NAME}" autocomplete="name" value="${escapeHtml(mine?.name ?? name)}">
      </div>
      <div class="field">
        <label for="r${id}-body">Your reply</label>
        <textarea id="r${id}-body" name="body" required maxlength="${MAX_BODY}" rows="2">${escapeHtml(mine?.body ?? "")}</textarea>
      </div>
      <div class="emoji-picker" role="group" aria-label="Add an emoji to your reply">
        ${EMOJI.map(([e, label]) => `<button type="button" data-emoji="${e}" aria-label="Insert ${label}" title="${label}">${e}</button>`).join("")}
      </div>
      <button type="submit">Send reply</button>
    </form>
  </details>`;
}

export function threadItem(thread: Thread, visitorId: string, name = "", draft?: ReplyDraft): string {
  const { note, replies } = thread;
  const playable = !note.withdrawn_at;
  return `<li class="thread" data-root="${note.id}">
  ${markCard(note, visitorId, playable)}
  <ol class="replies">${replies
    .map((r) => `\n    <li>${markCard(r, visitorId, playable)}</li>`)
    .join("")}</ol>
  ${replyBox(note, name, draft)}
</li>`;
}

export function wall(threads: Thread[], visitorId: string, cursor: number, name: string, draft?: ReplyDraft): string {
  const list = threads.length
    ? `<ol class="threads">\n${threads.map((t) => threadItem(t, visitorId, name, draft)).join("\n")}\n</ol>`
    : `<ol class="threads"></ol>
  <div class="wall-empty panel">${heartIcon()}<p>The wall is empty for now. Leave the first note.</p></div>`;
  return `<section class="wall" aria-labelledby="wall-title" data-cursor="${cursor}">
  <div class="wall-head">
    <h2 id="wall-title">The wall</h2>
    <p>Newest first. “yours” marks what this browser left.</p>
  </div>
  ${list}
</section>`;
}

export function pointsPanel(p: Points): string {
  const pips = Array.from({ length: MAX_PLAY_POINTS }, (_, i) => `<i${i < p.points ? ' class="on"' : ""}></i>`).join("");
  const next = p.nextInMs === null ? "Full." : `Next point in ${Math.ceil(p.nextInMs / 1000)} s.`;
  return `<section class="points panel" aria-labelledby="points-title" data-next-ms="${p.nextInMs ?? ""}">
  <h2 id="points-title">Your play points: <span data-points>${p.points}</span>/${MAX_PLAY_POINTS}</h2>
  <div class="pips" aria-hidden="true">${pips}</div>
  <p><span data-next>${next}</span> One comes back every minute, up to ${MAX_PLAY_POINTS}. Posting and replying are free. <a href="#how-to-play">How to play</a></p>
</section>`;
}

export const howToPlay = `<details class="how panel" id="how-to-play">
  <summary>${heartIcon()}How to play</summary>
  <p class="hint">Every note and reply has ten hearts. Spend play points on them:</p>
  <table>
    <thead><tr><th scope="col">Action</th><th scope="col">Cost</th><th scope="col">Effect</th></tr></thead>
    <tbody>
      <tr><td>👍 Heal</td><td>1</td><td>Restore 1 heart, up to 10. Pink hearts rise.</td></tr>
      <tr><td>👎 Attack</td><td>1</td><td>Deal 1 damage. The card wobbles.</td></tr>
      <tr><td>🤮 Poison</td><td>2</td><td>1 damage now, then 1 after 10 s and 1 after 20 s. Hearts turn green.</td></tr>
      <tr><td>😍 ${shieldIcon} Shield</td><td>2</td><td>Absorbs the next damaging hit. A steel frame closes round the hearts.</td></tr>
    </tbody>
  </table>
  <ul>
    <li>Heal and shield your own; attack and poison other people's.</li>
    <li>One shield and one poison at a time. Healing doesn't cure poison.</li>
    <li>At zero hearts a mark is Resting: nobody can hurt it until its author heals it.</li>
    <li>Health never removes anything. Emoji typed in a reply don't play.</li>
  </ul>
</details>`;

// What a live event carries: the whole thread rendered for this one
// connection, so ownership controls are right per viewer and no visitor id
// ever leaves the server, plus what just happened (for the animation) and
// this viewer's own points.
export function threadEvent(
  thread: Thread,
  visitorId: string,
  change: { target: number; kind: string; absorbed: boolean } | null,
  you: Points,
): string {
  return JSON.stringify({
    root: thread.note.id,
    html: threadItem(thread, visitorId),
    change,
    you,
  });
}

// The canvas part of the posting form. It ships hidden: the page script
// reveals it, so with JavaScript off the form is exactly the text-only one.
export const drawField = `<div class="draw" role="group" aria-labelledby="draw-label" hidden>
    <p class="draw-label" id="draw-label">Or draw something</p>
    <canvas aria-label="Drawing area: draw with a mouse, finger or pen"></canvas>
    <div class="draw-controls">
      <button type="button" class="draw-clear quiet" disabled>Clear drawing</button>
      <span class="draw-status" aria-live="polite">No drawing yet.</span>
    </div>
    <input type="hidden" name="drawing" value="">
  </div>`;

// The one script on the page. It enhances a page that already works without
// it: the canvas fills a hidden form field, reply, play and withdraw forms
// post in place, and live events update the wall. Live events carry HTML the
// server rendered and escaped, the same as the page itself; nothing typed
// in the browser is ever inserted as HTML.
export const pageScript = `<script>
(() => {
  document.documentElement.classList.add("js");
  const W = ${DRAW_WIDTH}, H = ${DRAW_HEIGHT}, MAX_POINTS = ${MAX_POINTS}, MAX_PLAY = ${MAX_PLAY_POINTS};
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const announcer = document.getElementById("announcer");
  const announce = (text) => {
    announcer.textContent = "";
    setTimeout(() => { announcer.textContent = text; }, 50);
  };

  const draw = document.querySelector(".draw");
  if (draw) {
    const canvas = draw.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const field = draw.querySelector('input[name="drawing"]');
    const status = draw.querySelector(".draw-status");
    const clear = draw.querySelector(".draw-clear");
    const body = document.getElementById("body");
    const strokes = [];
    let current = null, pointer = null, points = 0;
    draw.hidden = false;

    const redraw = () => {
      const scale = canvas.width / W;
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.lineWidth = 4;
      ctx.lineCap = ctx.lineJoin = "round";
      ctx.strokeStyle = getComputedStyle(canvas).color;
      ctx.beginPath();
      for (const s of strokes) {
        ctx.moveTo(s[0], s[1]);
        if (s.length === 2) ctx.lineTo(s[0], s[1]);
        for (let i = 2; i < s.length; i += 2) ctx.lineTo(s[i], s[i + 1]);
      }
      ctx.stroke();
    };
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      redraw();
    };
    const update = () => {
      const has = strokes.length > 0;
      field.value = has ? JSON.stringify(strokes) : "";
      body.required = !has;
      clear.disabled = !has;
      canvas.classList.toggle("has-drawing", has);
      status.textContent = !has ? "No drawing yet."
        : points >= MAX_POINTS ? "Drawing is full. It will be included with your mark."
        : "Drawing will be included with your mark.";
    };
    // inside the border, which the bounding box includes
    const at = (e) => {
      const box = canvas.getBoundingClientRect();
      const x = Math.round(((e.clientX - box.left - canvas.clientLeft) / canvas.clientWidth) * W);
      const y = Math.round(((e.clientY - box.top - canvas.clientTop) / canvas.clientHeight) * H);
      return [Math.min(W, Math.max(0, x)), Math.min(H, Math.max(0, y))];
    };

    canvas.addEventListener("pointerdown", (e) => {
      if (pointer !== null || points >= MAX_POINTS || e.button !== 0) return;
      e.preventDefault();
      pointer = e.pointerId;
      // a failed capture shouldn't cost the stroke itself
      try { canvas.setPointerCapture(pointer); } catch {}
      current = at(e);
      strokes.push(current);
      points++;
      redraw();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (e.pointerId !== pointer) return;
      const coalesced = e.getCoalescedEvents?.() ?? [];
      for (const ev of coalesced.length ? coalesced : [e]) {
        if (points >= MAX_POINTS) break;
        const [x, y] = at(ev), n = current.length;
        if (Math.hypot(x - current[n - 2], y - current[n - 1]) < 3) continue;
        current.push(x, y);
        points++;
      }
      redraw();
    });
    const end = (e) => {
      if (e.pointerId !== pointer) return;
      pointer = current = null;
      update();
    };
    canvas.addEventListener("pointerup", end);
    canvas.addEventListener("pointercancel", end);
    canvas.addEventListener("lostpointercapture", end);
    clear.addEventListener("click", () => {
      strokes.length = 0;
      points = 0;
      redraw();
      update();
    });
    new ResizeObserver(resize).observe(canvas);
  }

  // Play points: the server's count, ticked up locally between events.
  const panel = document.querySelector(".points");
  let pointsNow = 0, nextAt = null;
  const renderPoints = () => {
    if (!panel) return;
    panel.querySelector("[data-points]").textContent = String(pointsNow);
    panel.querySelectorAll(".pips i").forEach((pip, i) => pip.classList.toggle("on", i < pointsNow));
    panel.querySelector("[data-next]").textContent = nextAt === null ? "Full."
      : "Next point in " + Math.max(1, Math.ceil((nextAt - Date.now()) / 1000)) + " s.";
  };
  const setPoints = (you) => {
    pointsNow = you.points;
    nextAt = you.nextInMs === null ? null : Date.now() + you.nextInMs;
    renderPoints();
  };
  if (panel) {
    const ms = panel.dataset.nextMs;
    setPoints({ points: Number(panel.querySelector("[data-points]").textContent), nextInMs: ms === "" ? null : Number(ms) });
    setInterval(() => {
      if (nextAt === null) return;
      if (Date.now() >= nextAt) {
        pointsNow = Math.min(MAX_PLAY, pointsNow + 1);
        nextAt = pointsNow >= MAX_PLAY ? null : nextAt + 60000;
      }
      renderPoints();
    }, 1000);
  }

  const mainName = document.getElementById("name");
  const rememberName = (value) => {
    if (!value) return;
    if (mainName && !mainName.value) mainName.value = value;
    document.querySelectorAll('.reply-form input[name="name"]').forEach((input) => { if (!input.value) input.value = value; });
  };

  // Replace a card's contents without losing what the reader is doing in
  // it: open confirmations stay open and focus returns to the same control.
  const morph = (old, fresh) => {
    const active = old.contains(document.activeElement) ? document.activeElement : null;
    const focusKey = active ? (active === old ? "self" : active.dataset.key) : null;
    const open = [...old.querySelectorAll("details[open]")].map((d) => d.className);
    old.className = fresh.className;
    old.innerHTML = fresh.innerHTML;
    for (const cls of open) old.querySelector("details." + cls.split(" ")[0])?.setAttribute("open", "");
    if (focusKey === "self") old.focus({ preventScroll: true });
    else if (focusKey) (old.querySelector('[data-key="' + focusKey + '"]') ?? old).focus({ preventScroll: true });
  };

  const effect = (card, change) => {
    const health = card.querySelector(".health");
    const fx = (cls, html) => {
      const el = document.createElement("span");
      el.className = "fx " + cls;
      el.setAttribute("aria-hidden", "true");
      el.innerHTML = html;
      card.append(el);
      setTimeout(() => el.remove(), reduced.matches ? 1800 : 1200);
    };
    const heart = '<svg class="deco-heart" viewBox="0 0 16 14"><path d="M8 13.2 1.9 7.4A3.9 3.9 0 0 1 8 2.6a3.9 3.9 0 0 1 6.1 4.8Z"/></svg>';
    const lose = () => {
      if (!health) return;
      const hp = Number(health.dataset.hp);
      health.querySelectorAll(".heart")[hp]?.classList.add("lost");
    };
    const crack = () => {
      const hearts = health?.querySelector(".hearts");
      if (!hearts) return;
      const el = document.createElement("span");
      el.className = "crack";
      hearts.append(el);
      setTimeout(() => el.remove(), 800);
    };
    const { kind, absorbed } = change;
    if (kind === "heal") fx("plus", heart + heart + "+1");
    else if (kind === "shield") {
      card.querySelector(".health")?.classList.add("closing");
      fx("absorb", "Shield");
    } else if (kind === "attack" || kind === "poison" || kind === "tick") {
      if (kind === "attack") card.classList.add("wobble");
      if (kind === "poison") fx("poison", "<i></i><i></i><i></i>");
      if (absorbed) { crack(); fx("absorb", "Blocked"); }
      else { lose(); fx(kind === "attack" ? "minus" : "minus poison", "-1"); }
      setTimeout(() => card.classList.remove("wobble"), 500);
    }
  };

  const insertThread = (list, li) => {
    const id = Number(li.dataset.root);
    const before = [...list.children].find((other) => Number(other.dataset.root) < id);
    list.insertBefore(li, before ?? null);
  };

  const apply = (data, live) => {
    const tpl = document.createElement("template");
    tpl.innerHTML = data.html.trim();
    const fresh = tpl.content.firstElementChild;
    const existing = document.querySelector('.thread[data-root="' + data.root + '"]');
    if (!existing) {
      const list = document.querySelector("ol.threads");
      document.querySelector(".wall .wall-empty")?.remove();
      if (live) fresh.classList.add("arrive");
      insertThread(list, fresh);
      rememberName(mainName?.value);
      return;
    }
    const replies = existing.querySelector("ol.replies");
    for (const card of fresh.querySelectorAll("[data-mark]")) {
      const old = existing.querySelector('[data-mark="' + card.dataset.mark + '"]');
      if (old) morph(old, card);
      else {
        const li = card.parentElement;
        if (live) li.classList.add("arrive");
        replies.append(li);
      }
    }
    // A thread that just closed: drop the reply box, unless someone is
    // halfway through a reply there, which stays readable but can't send.
    const closed = fresh.querySelector(".thread-closed");
    const box = existing.querySelector("details.reply-box");
    if (closed && box) {
      const text = box.querySelector("textarea");
      if (text && text.value.trim()) {
        box.querySelector('button[type="submit"]').disabled = true;
        if (!box.querySelector(".thread-closed")) box.append(closed.cloneNode(true));
      } else box.replaceWith(closed.cloneNode(true));
    }
    if (live && data.change) {
      const target = existing.querySelector('[data-mark="' + data.change.target + '"]');
      if (target) effect(target, data.change);
    }
  };

  // Forms marked data-enhance post with fetch and stay on the page; without
  // the script they're ordinary posts that redirect back.
  document.addEventListener("submit", async (e) => {
    const form = e.target;
    const kind = form.dataset.enhance;
    if (!kind) return;
    e.preventDefault();
    if (form.dataset.busy) return;
    form.dataset.busy = "1";
    const fields = new URLSearchParams(new FormData(form, e.submitter));
    let data;
    try {
      const res = await fetch(form.getAttribute("action").split("#")[0], {
        method: "POST",
        body: fields,
        headers: { Accept: "application/json" },
      });
      data = await res.json();
    } catch {
      data = { ok: false, message: "Couldn't reach the wall. Check your connection and try again." };
    } finally {
      delete form.dataset.busy;
    }
    if (data.you) setPoints(data.you);
    if (kind === "reply") {
      const error = form.querySelector(".form-error");
      if (data.ok) {
        rememberName(fields.get("name"));
        form.querySelector("textarea").value = "";
        error.hidden = true;
        const box = form.closest("details");
        box.open = false;
        box.querySelector("summary").focus();
        announce("Reply sent.");
      } else {
        error.textContent = data.message;
        error.hidden = false;
        form.querySelector("textarea").focus();
      }
      return;
    }
    if (kind === "play" && data.token) {
      const token = form.querySelector('input[name="token"]');
      if (token) token.value = data.token;
    }
    if (kind === "withdraw" && data.ok) {
      const card = document.querySelector('[data-mark="' + fields.get("target") + '"]');
      card?.focus();
    }
    announce(data.message);
  });

  document.addEventListener("click", (e) => {
    const emoji = e.target.closest("[data-emoji]");
    if (emoji) {
      const text = emoji.closest("form").querySelector("textarea");
      const start = text.selectionStart ?? text.value.length, end = text.selectionEnd ?? start;
      text.setRangeText(emoji.dataset.emoji, start, end, "end");
      text.focus();
      return;
    }
    const cancel = e.target.closest(".cancel");
    if (cancel) {
      e.preventDefault();
      const box = cancel.closest("details");
      box.open = false;
      box.querySelector("summary").focus();
    }
  });

  // Live updates. The cursor is the newest change the page knows about; a
  // reconnect asks for everything after it. An EventSource retries network
  // drops itself (sending Last-Event-ID) but gives up for good on an error
  // answer, such as a proxy's 502 mid-deploy, so this reopens it.
  const wallEl = document.querySelector("[data-cursor]");
  if (!wallEl) return;
  let cursor = wallEl.dataset.cursor, source, retry = 1000;
  const connect = () => {
    source = new EventSource("/events?after=" + cursor);
    source.onopen = () => { retry = 1000; };
    source.onmessage = (event) => {
      if (event.lastEventId) cursor = event.lastEventId;
      const data = JSON.parse(event.data);
      if (data.you) setPoints(data.you);
      apply(data, data.change !== null);
    };
    source.addEventListener("you", (event) => setPoints(JSON.parse(event.data)));
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) return;
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 30000);
    };
  };
  connect();
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && source.readyState === EventSource.CLOSED) connect();
  });
})();
</script>`;
