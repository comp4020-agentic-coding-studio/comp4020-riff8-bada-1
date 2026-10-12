import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { marked } from "marked";
import { getCookie, getVisitorId, setCookie } from "./cookies.ts";
import {
  MAX_BODY,
  MAX_NAME,
  drawField,
  escapeHtml,
  howToPlay,
  newToken,
  page,
  pageScript,
  pointsPanel,
  siteHeader,
  wall,
  type ReplyDraft,
} from "./render.ts";
import { parseDrawing } from "./drawing.ts";
import { ACTIONS, MAX_HP, openStore, type Action, type Change, type PlayRefusal, type PlayResult } from "./db.ts";
import { broadcast, openStream } from "./live.ts";

const PORT = Number(process.env.PORT ?? 8080);
// room for a full drawing (see drawing.ts) once it's form-encoded
const MAX_REQUEST_BYTES = 65_536;
const POISON_CHECK_MS = 250;

// One SQLite file on the mounted volume: /data survives a restart or a
// redeploy, nothing else does (see fly.toml). DATA_DIR overrides it for a
// local run, where there's no volume.
const dataDir = process.env.DATA_DIR ?? "/data";
mkdirSync(dataDir, { recursive: true });
const store = openStore(`${dataDir}/marks.sqlite`);

// Who did what, for `flyctl logs`: a short hash names each visitor cookie
// without printing it.
const tag = (visitorId: string): string => createHash("sha256").update(visitorId).digest("hex").slice(0, 8);
function log(visitorId: string, event: string, detail = ""): void {
  console.log(`visitor=${tag(visitorId)} ${event}${detail ? ` ${detail}` : ""}`);
}

function publish(change: Change | null): void {
  if (change) broadcast(store, change);
}

// Poison runs on the server's clock from deadlines in the database, whether
// or not anyone has the page open, and catches up in order after a restart.
function resolvePoison(): void {
  for (const change of store.resolveDue(Date.now())) {
    const mark = store.get(change.target);
    console.log(`poison tick on mark=${change.target} ${change.absorbed ? "absorbed by shield" : `hp=${mark?.hp}`}`);
    publish(change);
  }
}
resolvePoison();
setInterval(resolvePoison, POISON_CHECK_MS);

// `.trim()` only strips whitespace (Unicode `Zs`), not zero-width/format
// characters (`Cf`, e.g. U+200B) — a string made of nothing else survives
// `.trim()` non-empty and reads as blank on the wall.
function hasVisibleContent(s: string): boolean {
  return /[^\s\p{Cf}]/u.test(s);
}

// The body, or null if it's over MAX_REQUEST_BYTES. The rest is read and
// dropped rather than cut off, so the client gets a clean 413.
async function readBody(req: IncomingMessage): Promise<string | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size <= MAX_REQUEST_BYTES) chunks.push(chunk);
  }
  return size > MAX_REQUEST_BYTES ? null : Buffer.concat(chunks).toString("utf8");
}

// Ownership rides on a cookie, so a page on another site mustn't be able to
// post with it. SameSite=Lax already keeps the cookie off cross-site POSTs;
// this refuses them outright. Browsers send Origin (or Sec-Fetch-Site) on
// every POST; a request with neither isn't a browser riding someone's cookie.
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      return new URL(origin).host === req.headers.host;
    } catch {
      return false;
    }
  }
  const site = req.headers["sec-fetch-site"];
  return site === undefined || site === "same-origin" || site === "none";
}

const wantsJson = (req: IncomingMessage): boolean => (req.headers.accept ?? "").includes("application/json");

function text(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: object): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(303, { Location: location });
  res.end();
}

// Outcome codes travel in the redirect URL; only these fixed messages are
// ever shown for them, so nobody can put words on someone else's page.
const NOTICES: Record<string, string> = {
  withdrawn: "Withdrawn. Its content is gone from the wall.",
  "not-yours": "That isn't yours. Only the browser that posted something can withdraw it or heal and shield it.",
  yours: "You can't attack or poison your own marks.",
  missing: "That note isn't on the wall any more.",
  "play-withdrawn": "That was withdrawn, or sits under a withdrawn note, so it can't be played. Nothing was spent.",
  "played-heal": "Healed: one heart back.",
  "played-attack": "Attacked: one heart lost.",
  "played-attack-blocked": "Attacked, but a shield blocked the hit.",
  "played-poison": "Poisoned: one heart now, then two more ticks.",
  "played-poison-blocked": "Poisoned: the shield blocked the first hit, but the poison stays.",
  "played-shield": "Shielded: the next hit will bounce off.",
  duplicate: "Already done: that was a repeat of the same click.",
  full: "Already at full health.",
  resting: "That one's resting at zero hearts. Only its author can heal it back.",
  "already-poisoned": "Already poisoned. Nothing was spent.",
  "already-shielded": "Already shielded. Nothing was spent.",
  points: "Not enough play points for that. Nothing was spent.",
  invalid: "That action didn't make sense. Nothing was spent.",
};

const refusalNotice = (reason: PlayRefusal): string => (reason === "withdrawn" ? "play-withdrawn" : reason);

function playMessage(action: Action, result: PlayResult): string {
  if (!result.ok) {
    return NOTICES[refusalNotice(result.reason)] ?? NOTICES.invalid;
  }
  const { mark, change } = result;
  const whose = `${mark.name || "that"}'s ${mark.parent_id === null ? "note" : "reply"}`;
  const hp = `${mark.hp}/${MAX_HP} hearts`;
  if (action === "heal") return `Healed ${whose}: ${hp}.`;
  if (action === "shield") return `Shielded ${whose}.`;
  const hit = change.absorbed ? "the shield blocked the hit" : hp;
  if (action === "attack") return `Attacked ${whose}: ${hit}${mark.hp === 0 ? ", now resting" : ""}.`;
  return `Poisoned ${whose}: ${hit}${mark.poison_ticks ? ", two more ticks to come" : ", now resting"}.`;
}

const refusalStatus: Record<PlayRefusal, number> = {
  invalid: 400,
  missing: 404,
  withdrawn: 409,
  "not-yours": 403,
  yours: 403,
  duplicate: 409,
  full: 409,
  resting: 409,
  "already-poisoned": 409,
  "already-shielded": 409,
  points: 409,
};

interface NoteDraft {
  name: string;
  body: string;
  error: string;
}

function homePage(visitorId: string, lastName: string, notice = "", note?: NoteDraft, reply?: ReplyDraft): string {
  return page(
    "Marks",
    `${siteHeader(`A warm little wall for friends. Leave a note or a drawing, reply with a word or an emoji, and look after each other's hearts. <a href="/readme/">What this is for</a>.`)}
${notice ? `<div class="notice" role="status"><p>${escapeHtml(notice)}</p></div>` : ""}
<main class="layout">
<section class="composer panel" aria-labelledby="compose-title">
  <h2 id="compose-title">Leave a note</h2>
  <form method="post" action="/">
    ${note?.error ? `<p class="form-error" role="alert">${escapeHtml(note.error)}</p>` : ""}
    <div class="field">
      <label for="name">Your name</label>
      <input id="name" name="name" required maxlength="${MAX_NAME}" autocomplete="name" value="${escapeHtml(note?.name ?? lastName)}">
    </div>
    <div class="field">
      <label for="body">Your note</label>
      <textarea id="body" name="body" required maxlength="${MAX_BODY}" rows="3">${escapeHtml(note?.body ?? "")}</textarea>
    </div>
    ${drawField}
    <button type="submit">Pin it to the wall</button>
  </form>
  <p class="hint">What you post is tied to this browser's cookie, not your name: only this browser can withdraw it.</p>
</section>
${pointsPanel(store.points(visitorId, Date.now()))}
${howToPlay}
${wall(store.threads(), visitorId, store.cursor(), lastName, reply)}
</main>
<div id="announcer" class="sr-only" aria-live="polite"></div>
${pageScript}`,
  );
}

function sendHome(res: ServerResponse, status: number, html: string): void {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

const idParam = (params: URLSearchParams, key: string): number => {
  const n = Number(params.get(key));
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};

const server = createServer((req, res) => {
  void (async () => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const visitorId = getVisitorId(req, res);

      if (req.method === "GET" && url.pathname === "/") {
        resolvePoison();
        const notice = NOTICES[url.searchParams.get("notice") ?? ""] ?? "";
        sendHome(res, 200, homePage(visitorId, getCookie(req, "name") ?? "", notice));
        return;
      }

      if (req.method === "GET" && url.pathname === "/events") {
        openStream(store, req, res, url, visitorId);
        return;
      }

      if (req.method === "GET" && url.pathname === "/readme/") {
        const md = readFileSync("README.md", "utf8");
        const html = await marked.parse(md);
        sendHome(
          res,
          200,
          page(
            "About Marks",
            `${siteHeader(`What this wall is for, and how it works. <a href="/">Back to the wall</a>.`)}
<main class="readme"><article class="panel">${html}</article></main>`,
          ),
        );
        return;
      }

      if (req.method === "POST" && ["/", "/reply", "/withdraw", "/play"].includes(url.pathname)) {
        if (!sameOrigin(req)) {
          log(visitorId, "refused cross-origin post", `path=${url.pathname} origin=${req.headers.origin ?? "-"}`);
          text(res, 403, "cross-origin posts aren't accepted");
          return;
        }
        const raw = await readBody(req);
        if (raw === null) {
          text(res, 413, "that mark is too large");
          return;
        }
        const params = new URLSearchParams(raw);
        const lastName = getCookie(req, "name") ?? "";
        const name = (params.get("name") ?? "").trim().slice(0, MAX_NAME);
        const trimmed = (params.get("body") ?? "").trim().slice(0, MAX_BODY);
        const body = hasVisibleContent(trimmed) ? trimmed : "";

        if (url.pathname === "/") {
          // Only the canvas script fills this field, so anything that doesn't
          // parse is tampering or a bug: refuse the whole mark, don't drop the
          // drawing quietly.
          const drawingRaw = params.get("drawing") ?? "";
          const drawing = drawingRaw === "" ? null : parseDrawing(drawingRaw);
          if (drawingRaw !== "" && drawing === null) {
            text(res, 400, "that drawing isn't one this wall can show");
            return;
          }
          // a mark is a name plus some text, a drawing, or both
          const error = !hasVisibleContent(name)
            ? "Add a name so friends know who left this."
            : !body && !drawing
              ? "Write something or draw something first."
              : "";
          if (error) {
            sendHome(res, 422, homePage(visitorId, lastName, "", { name, body: trimmed, error }));
            return;
          }
          const change = store.insertNote(visitorId, name, body, drawing && JSON.stringify(drawing), Date.now());
          log(visitorId, "posted note", `mark=${change.target} name=${JSON.stringify(name)}${drawing ? " with drawing" : ""}`);
          publish(change);
          setCookie(res, "name", name);
          redirect(res, `/#m${change.target}`);
          return;
        }

        if (url.pathname === "/reply") {
          const parent = idParam(params, "parent");
          if (params.has("drawing")) {
            text(res, 400, "replies can't carry drawings");
            return;
          }
          let error = !hasVisibleContent(name)
            ? "Add a name so friends know who replied."
            : !body
              ? "Write a reply or pick an emoji first."
              : "";
          if (!error) {
            const result = store.insertReply(visitorId, parent, name, body, Date.now());
            if (result.ok) {
              log(visitorId, "replied", `mark=${result.change.target} to=${parent} name=${JSON.stringify(name)}`);
              publish(result.change);
              setCookie(res, "name", name);
              if (wantsJson(req)) json(res, 200, { ok: true });
              else redirect(res, `/#m${result.change.target}`);
              return;
            }
            error =
              result.reason === "withdrawn"
                ? "That note was withdrawn, so its thread is closed to new replies."
                : "That note isn't on the wall any more.";
          }
          log(visitorId, "reply refused", `to=${parent} reason=${JSON.stringify(error)}`);
          if (wantsJson(req)) json(res, 422, { ok: false, message: error });
          // a missing note has no thread to show the error in, so it goes up top
          else {
            const notice = store.thread(parent) ? "" : error;
            sendHome(res, 422, homePage(visitorId, lastName, notice, undefined, { parent, name, body: trimmed, error }));
          }
          return;
        }

        if (url.pathname === "/withdraw") {
          const target = idParam(params, "target");
          const result = store.withdraw(visitorId, target, Date.now());
          if (!result.ok) {
            log(visitorId, "withdraw refused", `mark=${target} reason=${result.reason}`);
            const status = result.reason === "missing" ? 404 : 403;
            if (wantsJson(req)) json(res, status, { ok: false, message: NOTICES[result.reason] });
            else redirect(res, `/?notice=${result.reason}#m${target}`);
            return;
          }
          log(visitorId, "withdrew", `mark=${target}${result.change ? "" : " (already withdrawn)"}`);
          publish(result.change);
          if (wantsJson(req)) json(res, 200, { ok: true, message: NOTICES.withdrawn });
          else redirect(res, `/?notice=withdrawn#m${target}`);
          return;
        }

        // /play
        const target = idParam(params, "target");
        const action = (params.get("action") ?? "") as Action;
        const valid = Object.hasOwn(ACTIONS, action);
        const result: PlayResult = valid
          ? store.play(visitorId, action, target, params.get("token") ?? "", Date.now())
          : { ok: false, reason: "invalid" };
        const message = valid ? playMessage(action, result) : NOTICES.invalid;
        const you = store.points(visitorId, Date.now());
        if (result.ok) {
          log(
            visitorId,
            `played ${action}`,
            `mark=${target} hp=${result.mark.hp}${result.change.absorbed ? " absorbed" : ""} points=${you.points}`,
          );
          publish(result.change);
        } else {
          log(visitorId, `${valid ? action : "play"} refused`, `mark=${target} reason=${result.reason}`);
        }
        if (wantsJson(req)) {
          json(res, result.ok ? 200 : refusalStatus[result.reason], { ok: result.ok, message, you, token: newToken() });
        } else {
          const notice = result.ok
            ? `played-${action}${result.change.absorbed ? "-blocked" : ""}`
            : refusalNotice(result.reason);
          redirect(res, `/?notice=${notice}#m${target}`);
        }
        return;
      }

      text(res, 404, "not found");
    } catch (err) {
      console.error(err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end("something went wrong");
    }
  })();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`listening on :${PORT}`);
});
