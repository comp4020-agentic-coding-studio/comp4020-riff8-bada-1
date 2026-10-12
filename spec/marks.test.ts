import { randomUUID } from "node:crypto";
import { describe, expect, inject, it } from "vitest";

// The wall over HTTP: notes, replies, withdrawal, play and live updates, each
// from the point of view of one or more visitors. Everything here runs
// against the RUNNING app (see spec/global-setup.ts), same as
// invariants.test.ts. Game timing with a controlled clock is in
// store.test.ts.
const baseUrl = inject("baseUrl");

// A visitor is just a cookie, so a test can be several people at once.
function visitor(id = randomUUID()) {
  const headers = (json: boolean): Record<string, string> => ({
    "Content-Type": "application/x-www-form-urlencoded",
    Cookie: `visitor=${id}`,
    ...(json ? { Accept: "application/json" } : {}),
  });
  const post = (path: string, fields: Record<string, string>, json = false, extra: Record<string, string> = {}) =>
    fetch(new URL(path, baseUrl), {
      method: "POST",
      headers: { ...headers(json), ...extra },
      body: new URLSearchParams(fields).toString(),
      redirect: "manual",
    });
  return {
    id,
    post,
    wall: async () => (await fetch(new URL("/", baseUrl), { headers: { Cookie: `visitor=${id}` } })).text(),
    // the new mark's id, from the redirect to its anchor
    async note(name: string, body: string, drawing?: string): Promise<number> {
      const res = await post("/", drawing === undefined ? { name, body } : { name, body, drawing });
      expect(res.status).toBe(303);
      return Number(res.headers.get("location")!.match(/#m(\d+)$/)![1]);
    },
    async reply(parent: number, name: string, body: string): Promise<number> {
      const res = await post("/reply", { parent: String(parent), name, body });
      expect(res.status, await res.clone().text()).toBe(303);
      return Number(res.headers.get("location")!.match(/#m(\d+)$/)![1]);
    },
    withdraw: (target: number) => post("/withdraw", { target: String(target) }, true),
    async play(action: string, target: number, token = randomUUID()) {
      const res = await post("/play", { action, target: String(target), token }, true);
      return { status: res.status, ...((await res.json()) as { ok: boolean; message: string; you: { points: number } }) };
    },
  };
}

const anon = visitor();

// The HTML of one card, by mark id.
function card(html: string, id: number): string {
  const match = html.match(new RegExp(`<article[^>]*data-mark="${id}"[^]*?</article>`));
  expect(match, `no card for mark ${id}`).not.toBeNull();
  return match![0];
}

const cursorOf = (html: string): number => Number(html.match(/data-cursor="(\d+)"/)![1]);

describe("notes", () => {
  it("a posted note shows up on the wall", async () => {
    const marker = `mark-${randomUUID()}`;
    const id = await anon.note("Test Visitor", marker);
    expect(card(await anon.wall(), id)).toContain(marker);
  });

  it("rejects a note with an empty body, keeping what was typed", async () => {
    // short enough to survive the 40-character name limit intact
    const marker = `empty-${randomUUID().slice(0, 8)}`;
    const res = await anon.post("/", { name: marker, body: "" });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain("Write something or draw something first.");
    expect(html).toContain(`value="${marker}"`);
    expect(await anon.wall()).not.toContain(marker);
  });

  it("rejects a name made only of zero-width characters", async () => {
    const marker = `zwsp-${randomUUID()}`;
    const res = await anon.post("/", { name: "​​​", body: marker });
    expect(res.status).toBe(422);
    expect(await anon.wall()).not.toContain(`<p class="mark-body">${marker}`);
  });

  it("accepts a name that merely contains a zero-width character", async () => {
    const marker = `zwsp-ok-${randomUUID()}`;
    await anon.note(`Jo​hn`, marker);
    expect(await anon.wall()).toContain(marker);
  });

  it("escapes what people type", async () => {
    const id = await anon.note("<b>bold</b>", `<script>alert(1)</script>`);
    const html = card(await anon.wall(), id);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  it("still serves the page when a cookie value is malformed percent-encoding", async () => {
    const res = await fetch(new URL("/", baseUrl), { headers: { Cookie: "visitor=%" } });
    expect(res.status).toBe(200);
  });

  it("issues a fresh visitor cookie per anonymous request, and never prints it", async () => {
    const a = await fetch(new URL("/", baseUrl));
    const b = await fetch(new URL("/", baseUrl));
    const idA = a.headers.get("set-cookie")!.match(/^visitor=([^;]+)/)![1];
    const idB = b.headers.get("set-cookie")!.match(/^visitor=([^;]+)/)![1];
    expect(idA).not.toBe(idB);
    expect(await a.text()).not.toContain(idA);
  });

  it("stores a drawing with its note and renders it as an SVG path", async () => {
    const marker = `drawing-${randomUUID()}`;
    const id = await anon.note("Sketcher", marker, JSON.stringify([[10, 20, 30, 40, 50, 60], [100, 100]]));
    expect(card(await anon.wall(), id)).toContain('<path d="M10 20L30 40L50 60M100 100l0 0"/>');
  });

  it.each([
    ["not JSON", "<svg onload=alert(1)>"],
    ["not an array of strokes", JSON.stringify({ d: "M0 0" })],
    ["a string coordinate", JSON.stringify([["10", 10]])],
    ["a fractional coordinate", JSON.stringify([[10.5, 10]])],
    ["a coordinate off the grid", JSON.stringify([[601, 10]])],
    ["an odd-length stroke", JSON.stringify([[10, 10, 20]])],
    ["too many points", JSON.stringify([Array.from({ length: 3002 }, () => 1)])],
  ])("rejects a drawing that is %s, storing nothing", async (_, drawing) => {
    const marker = `bad-${randomUUID()}`;
    const res = await anon.post("/", { name: "Tamperer", body: marker, drawing });
    expect(res.status).toBe(400);
    expect(await anon.wall()).not.toContain(marker);
  });

  it("rejects an oversized request, storing nothing", async () => {
    const marker = `huge-${randomUUID()}`;
    const res = await anon.post("/", { name: "Tamperer", body: marker, drawing: "[".repeat(70_000) });
    expect(res.status).toBe(413);
    expect(await anon.wall()).not.toContain(marker);
  });

  it("refuses a post from another site", async () => {
    const marker = `csrf-${randomUUID()}`;
    const attempts: Record<string, string>[] = [{ Origin: "https://evil.example" }, { "Sec-Fetch-Site": "cross-site" }];
    for (const extra of attempts) {
      const res = await anon.post("/", { name: "Evil", body: marker }, false, extra);
      expect(res.status).toBe(403);
    }
    expect(await anon.wall()).not.toContain(marker);
  });
});

describe("replies", () => {
  it("sit under their note, oldest first, with author, time and whose they are", async () => {
    const alice = visitor();
    const bob = visitor();
    const note = await alice.note("Alice", `thread-${randomUUID()}`);
    const first = await bob.reply(note, "Bob", "first reply");
    const second = await alice.reply(note, "Alice", "🎉");
    const html = await bob.wall();
    const thread = html.match(new RegExp(`<li class="thread" data-root="${note}">[^]*?</details>\\s*</li>`))![0];
    expect(thread.indexOf(`data-mark="${first}"`)).toBeLessThan(thread.indexOf(`data-mark="${second}"`));
    expect(card(html, first)).toMatch(/Bob<\/span>[^]*<time datetime=[^]*badge">yours/);
    expect(card(html, second)).not.toContain("yours");
    expect(card(html, second)).toContain('<p class="mark-body">🎉</p>');
  });

  it("two visitors with the same name stay distinct", async () => {
    const one = visitor();
    const two = visitor();
    const note = await one.note("Sam", `same-name-${randomUUID()}`);
    const r = await two.reply(note, "Sam", "me too");
    expect(card(await one.wall(), note)).toContain("yours");
    expect(card(await one.wall(), r)).not.toContain("yours");
    expect((await one.withdraw(r)).status).toBe(403);
  });

  it.each([
    ["blank", "   ", "Write a reply or pick an emoji first."],
    ["zero-width only", "​‍", "Write a reply or pick an emoji first."],
  ])("refuses a %s reply, keeping the name and showing why", async (_, body, message) => {
    const note = await anon.note("Host", `refuse-${randomUUID()}`);
    const res = await anon.post("/reply", { parent: String(note), name: "Keeps Name", body });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain(message);
    expect(html).toContain('value="Keeps Name"');
    expect(html).toMatch(new RegExp(`<details class="reply-box" open>[^]*?name="parent" value="${note}"`));
  });

  it("keeps a refused reply's text when its note was withdrawn", async () => {
    const owner = visitor();
    const note = await owner.note("Owner", `closing-${randomUUID()}`);
    await owner.withdraw(note);
    const res = await anon.post("/reply", { parent: String(note), name: "Late", body: "too late now" });
    expect(res.status).toBe(422);
    const html = await res.text();
    expect(html).toContain("That note was withdrawn");
    expect(html).toContain(">too late now</textarea>");
    const json = await anon.post("/reply", { parent: String(note), name: "Late", body: "x" }, true);
    expect(await json.json()).toMatchObject({ ok: false });
  });

  it("refuses a reply to a missing note or to a reply", async () => {
    const note = await anon.note("Host", `nest-${randomUUID()}`);
    const reply = await anon.reply(note, "R", "level one");
    for (const parent of [999_999_999, reply]) {
      const marker = `nested-${randomUUID()}`;
      const res = await anon.post("/reply", { parent: String(parent), name: "N", body: marker });
      expect(res.status).toBe(422);
      expect(await anon.wall()).not.toContain(`<p class="mark-body">${marker}`);
    }
  });

  it("caps a reply at 280 characters and takes no drawing", async () => {
    const note = await anon.note("Host", `cap-${randomUUID()}`);
    const long = "x".repeat(400);
    const id = await anon.reply(note, "Long", long);
    expect(card(await anon.wall(), id)).toContain(`<p class="mark-body">${"x".repeat(280)}</p>`);
    const res = await anon.post("/reply", { parent: String(note), name: "D", body: "hi", drawing: "[[1,1]]" });
    expect(res.status).toBe(400);
  });
});

describe("withdrawal", () => {
  it("only the author's browser sees Withdraw, and only it can withdraw", async () => {
    const author = visitor();
    const other = visitor();
    const marker = `withdraw-${randomUUID()}`;
    const note = await author.note("Author", marker);
    expect(card(await author.wall(), note)).toContain('action="/withdraw"');
    expect(card(await other.wall(), note)).not.toContain('action="/withdraw"');

    const forged = await other.withdraw(note);
    expect(forged.status).toBe(403);
    expect(await anon.wall()).toContain(marker);

    const res = await author.withdraw(note);
    expect(res.status).toBe(200);
    const html = await other.wall();
    expect(html).not.toContain(marker);
    expect(card(html, note)).toContain("This note was withdrawn.");
    // a repeat is harmless
    expect((await author.withdraw(note)).status).toBe(200);
  });

  it("without JavaScript: posts then redirects back with a notice", async () => {
    const author = visitor();
    const note = await author.note("Author", `nojs-${randomUUID()}`);
    const res = await author.post("/withdraw", { target: String(note) });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/?notice=withdrawn#m${note}`);
    const page = await (await fetch(new URL(res.headers.get("location")!, baseUrl))).text();
    expect(page).toContain("Withdrawn. Its content is gone from the wall.");
  });

  it("keeps other people's replies under the placeholder and closes the thread", async () => {
    const author = visitor();
    const friend = visitor();
    const drawing = JSON.stringify([[3, 3, 9, 9]]);
    const note = await author.note("Author", `parent-${randomUUID()}`, drawing);
    const reply = await friend.reply(note, "Friend", "lovely drawing");
    const own = await author.reply(note, "Author", "thanks!");
    await author.withdraw(note);
    const html = await friend.wall();
    expect(html).not.toContain('<path d="M3 3L9 9"/>');
    expect(card(html, reply)).toContain("lovely drawing");
    expect(card(html, own)).toContain("thanks!");
    expect(html).toMatch(new RegExp(`data-root="${note}">[^]*?This thread is closed to new replies.`));

    await author.withdraw(own);
    const after = await friend.wall();
    expect(card(after, own)).toContain("Reply withdrawn.");
    expect(card(after, own)).not.toContain("thanks!");
    expect(card(after, reply)).toContain("lovely drawing");
  });
});

describe("play", () => {
  it("charges points, changes hearts, and shows both tabs the same", async () => {
    const owner = visitor();
    const player = visitor();
    const note = await owner.note("Owner", `play-${randomUUID()}`);
    const hit = await player.play("attack", note);
    expect(hit).toMatchObject({ ok: true, you: { points: 9 } });
    for (const v of [owner, player]) expect(card(await v.wall(), note)).toContain("Health 9 of 10.");
    expect(await player.wall()).toContain("Your play points: <span data-points>9</span>/10");
    expect(await owner.wall()).toContain("Your play points: <span data-points>10</span>/10");

    expect(await owner.play("shield", note)).toMatchObject({ ok: true, you: { points: 8 } });
    expect(card(await player.wall(), note)).toContain("Health 9 of 10, shielded.");
    expect(await player.play("poison", note)).toMatchObject({ ok: true, you: { points: 7 } });
    expect(card(await anon.wall(), note)).toContain("Health 9 of 10, poisoned.");
  });

  it("checks ownership on the server, not by name", async () => {
    const owner = visitor();
    const sameName = visitor();
    const note = await owner.note("Twin", `own-${randomUUID()}`);
    await sameName.play("attack", note);
    const heal = await sameName.play("heal", note);
    expect(heal).toMatchObject({ ok: false, status: 403, you: { points: 9 } });
    expect(await owner.play("attack", note)).toMatchObject({ ok: false, status: 403 });
  });

  it("applies a repeated submission once", async () => {
    const owner = visitor();
    const player = visitor();
    const note = await owner.note("Owner", `dupe-${randomUUID()}`);
    const token = randomUUID();
    const results = await Promise.all([1, 2, 3].map(() => player.play("attack", note, token)));
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(card(await anon.wall(), note)).toContain("Health 9 of 10.");
    expect((await player.play("attack", note)).you.points).toBe(8);
  });

  it("never overspends under concurrent plays", async () => {
    const owner = visitor();
    const player = visitor();
    const notes = [await owner.note("Owner", `burst-a-${randomUUID()}`), await owner.note("Owner", `burst-b-${randomUUID()}`)];
    const results = await Promise.all(Array.from({ length: 16 }, (_, i) => player.play("attack", notes[i % 2])));
    expect(results.filter((r) => r.ok)).toHaveLength(10);
    const wall = await anon.wall();
    const hp = notes.map((n) => Number(card(wall, n).match(/Health (\d+) of 10/)![1]));
    expect(hp[0] + hp[1]).toBe(10);
  });

  it("refuses withdrawn targets for free", async () => {
    const owner = visitor();
    const player = visitor();
    const note = await owner.note("Owner", `gone-${randomUUID()}`);
    const reply = await owner.reply(note, "Owner", "under it");
    await owner.withdraw(note);
    expect(await player.play("attack", reply)).toMatchObject({ ok: false, you: { points: 10 } });
    expect(await owner.play("heal", note)).toMatchObject({ ok: false });
    expect(card(await owner.wall(), reply)).not.toContain('action="/play"');
  });

  it("works without JavaScript through a form post and redirect", async () => {
    const owner = visitor();
    const player = visitor();
    const note = await owner.note("Owner", `nojs-play-${randomUUID()}`);
    const res = await player.post("/play", { action: "attack", target: String(note), token: randomUUID() });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`/?notice=played-attack#m${note}`);
    const html = await (
      await fetch(new URL(res.headers.get("location")!, baseUrl), { headers: { Cookie: `visitor=${player.id}` } })
    ).text();
    expect(html).toContain("Attacked: one heart lost.");
    expect(html).toContain("Your play points: <span data-points>9</span>/10");
  });
});

// Opens /events and resolves with everything read once `until` matches, or
// rejects after `ms`. The stream is aborted either way so Vitest can exit.
async function streamUntil(
  until: (seen: string) => boolean,
  ms: number,
  opts: { headers?: Record<string, string>; query?: string; onOpen?: () => Promise<unknown> } = {},
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  let seen = "";
  try {
    const res = await fetch(new URL(`/events${opts.query ?? ""}`, baseUrl), {
      headers: opts.headers,
      signal: controller.signal,
    });
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const decoder = new TextDecoder();
    let opened = false;
    for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
      seen += decoder.decode(chunk, { stream: true });
      if (!opened && seen.includes(": connected")) {
        opened = true;
        void opts.onOpen?.();
      }
      if (until(seen)) return seen;
    }
    throw new Error("stream ended early");
  } catch (err) {
    if (controller.signal.aborted) throw new Error(`gave up after ${ms} ms; saw: ${seen.slice(0, 2000)}`);
    throw err;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

const events = (seen: string) =>
  [...seen.matchAll(/^id: (\d+)\ndata: (.*)$/gm)].map((m) => ({
    id: Number(m[1]),
    ...(JSON.parse(m[2]) as { root: number; html: string; change: { kind: string; target: number } | null }),
  }));

describe("live updates", () => {
  it("delivers a new note, a reply and a play to an open stream within 1.5 s", async () => {
    const author = visitor();
    const marker = `live-${randomUUID()}`;
    let note = 0;
    const seen = await streamUntil((s) => events(s).some((e) => e.change?.kind === "attack"), 1500, {
      onOpen: async () => {
        note = await author.note("Live", marker);
        await anon.reply(note, "Replier", `reply-${marker}`);
        await anon.play("attack", note);
      },
    });
    const got = events(seen).filter((e) => e.root === note);
    expect(got.map((e) => e.change?.kind)).toEqual(["note", "reply", "attack"]);
    expect(got[1].html).toContain(`reply-${marker}`);
    expect(got[2].html).toContain("Health 9 of 10.");
  });

  it("renders events per viewer and never carries a visitor id", async () => {
    const author = visitor();
    const marker = `who-${randomUUID()}`;
    const seen = await streamUntil((s) => s.includes(marker), 1500, {
      headers: { Cookie: `visitor=${author.id}` },
      onOpen: () => author.note("Me", marker),
    });
    expect(seen).not.toContain(author.id);
    expect(events(seen).at(-1)!.html).toContain("yours");
  });

  it("replays withdrawals as well as additions after a reconnect, once per thread, without withdrawn content", async () => {
    const author = visitor();
    const friend = visitor();
    const secret = `secret-${randomUUID()}`;
    const note = await author.note("Author", secret);
    const cursor = cursorOf(await anon.wall());

    // while "disconnected"
    const reply = await friend.reply(note, "Friend", `kept-${secret}`);
    await friend.play("attack", reply);
    await author.withdraw(note);
    const other = await anon.note("Other", `other-${secret}`);

    const done = (s: string) => events(s).some((e) => e.root === other);
    for (const opts of [{ headers: { "Last-Event-ID": String(cursor) } }, { query: `?after=${cursor}` }]) {
      const seen = await streamUntil(done, 1500, opts);
      const got = events(seen);
      expect(got.filter((e) => e.root === note)).toHaveLength(1);
      const thread = got.find((e) => e.root === note)!;
      expect(thread.change).toBeNull();
      expect(thread.html).toContain("This note was withdrawn.");
      expect(thread.html).toContain(`kept-${secret}`);
      expect(thread.html).not.toContain(`>${secret}<`);
      // ids only go up, so the browser's Last-Event-ID always moves forward
      expect(got.map((e) => e.id)).toEqual([...got.map((e) => e.id)].sort((a, b) => a - b));
    }
  });

  it("replays nothing to a stream with no cursor", async () => {
    await anon.note("Before", `before-${randomUUID()}`);
    const marker = `after-${randomUUID()}`;
    const seen = await streamUntil((s) => s.includes(marker), 1500, { onOpen: () => anon.note("After", marker) });
    // only live events: a replay would carry a null change
    expect(events(seen).every((e) => e.change !== null)).toBe(true);
  });
});
