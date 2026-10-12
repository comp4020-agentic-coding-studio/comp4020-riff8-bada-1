import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_HP, POISON_INTERVAL_MS, REGEN_MS, openStore, type Action, type Store } from "../src/db.ts";

// The store on its own, against a throwaway SQLite file, with the clock
// passed in: game timing is checked here without waiting real seconds. The
// HTTP-level behaviour is in marks.test.ts.
const T0 = Date.UTC(2026, 9, 12, 9, 0, 0);
const file = (): string => join(mkdtempSync(join(tmpdir(), "marks-")), "marks.sqlite");

let tokens = 0;
const token = (): string => `token-${process.pid}-${++tokens}`;

function world(path = file()) {
  const store = openStore(path);
  const note = (who: string, now = T0) => store.insertNote(who, who, `note by ${who}`, null, now).target;
  const play = (who: string, action: Action, target: number, now = T0, t = token()) =>
    store.play(who, action, target, t, now);
  const hp = (id: number) => store.get(id)!.hp;
  return { store, note, play, hp, path };
}

describe("migration", () => {
  it("keeps notes and drawings from a database made before replies and health", () => {
    const path = file();
    const old = new DatabaseSync(path);
    old.exec(`create table marks (id integer primary key autoincrement, visitor_id text not null,
      name text not null, body text not null, created_at text not null)`);
    old.prepare("insert into marks (visitor_id, name, body, created_at) values (?, ?, ?, ?)").run(
      "v1",
      "Old Timer",
      "from the first week",
      new Date(T0).toISOString(),
    );
    old.exec("alter table marks add column drawing text");
    old.prepare("insert into marks (visitor_id, name, body, drawing, created_at) values (?, ?, ?, ?, ?)").run(
      "v2",
      "Sketcher",
      "",
      "[[1,2,3,4]]",
      new Date(T0).toISOString(),
    );
    old.close();

    const store = openStore(path);
    const threads = store.threads();
    expect(threads.map((t) => t.note.name)).toEqual(["Sketcher", "Old Timer"]);
    expect(threads[0].note.drawing).toBe("[[1,2,3,4]]");
    expect(threads[1].note.body).toBe("from the first week");
    for (const t of threads) {
      expect(t.note).toMatchObject({ hp: MAX_HP, shield: 0, poison_ticks: 0, parent_id: null, withdrawn_at: null });
      expect(t.replies).toEqual([]);
    }
    store.close();
    // opening again is a no-op
    expect(openStore(path).threads()).toHaveLength(2);
  });
});

describe("points", () => {
  it("start at 10, cost what the table says, and come back one a minute up to 10", () => {
    const { store, note, play } = world();
    const target = note("them");
    expect(store.points("me", T0)).toEqual({ points: 10, nextInMs: null });
    expect(play("me", "attack", target).ok).toBe(true);
    expect(play("me", "poison", target).ok).toBe(true);
    expect(store.points("me", T0)).toEqual({ points: 7, nextInMs: REGEN_MS });
    expect(store.points("me", T0 + REGEN_MS - 1).points).toBe(7);
    expect(store.points("me", T0 + REGEN_MS)).toEqual({ points: 8, nextInMs: REGEN_MS });
    expect(store.points("me", T0 + 2.5 * REGEN_MS)).toEqual({ points: 9, nextInMs: REGEN_MS / 2 });
    expect(store.points("me", T0 + 60 * REGEN_MS)).toEqual({ points: 10, nextInMs: null });
  });

  it("keep the part-minute already earned when spending again", () => {
    const { store, note, play } = world();
    const target = note("them");
    for (let i = 0; i < 3; i++) play("me", "attack", target);
    // 7 points; 1.5 minutes later it's 8, half way to 9
    expect(play("me", "attack", target, T0 + 1.5 * REGEN_MS).ok).toBe(true);
    expect(store.points("me", T0 + 1.5 * REGEN_MS)).toEqual({ points: 7, nextInMs: REGEN_MS / 2 });
  });

  it("refuse a play that costs more than you have, charging nothing", () => {
    const { store, note, play, hp } = world();
    const a = note("them");
    const b = note("other");
    for (let i = 0; i < 9; i++) play("me", "attack", i % 2 ? a : b);
    expect(store.points("me", T0).points).toBe(1);
    const before = hp(a);
    expect(play("me", "poison", a)).toMatchObject({ ok: false, reason: "points" });
    expect(hp(a)).toBe(before);
    expect(store.points("me", T0).points).toBe(1);
  });

  it("survive a restart", () => {
    const w = world();
    const target = w.note("them");
    w.play("me", "poison", target);
    w.store.close();
    const again = openStore(w.path);
    expect(again.points("me", T0).points).toBe(8);
  });
});

describe("health", () => {
  it("stays between 0 and 10: healing a full mark is refused for free", () => {
    const { store, note, play, hp } = world();
    const mine = note("me");
    expect(play("me", "heal", mine)).toMatchObject({ ok: false, reason: "full" });
    expect(hp(mine)).toBe(MAX_HP);
    expect(store.points("me", T0).points).toBe(10);
  });

  it("goes to zero and rests; resting refuses harm for free and healing revives it", () => {
    const { store, note, play, hp } = world();
    const target = note("them");
    for (let i = 0; i < 10; i++) {
      const who = `attacker-${i % 3}`;
      expect(play(who, "attack", target, T0 + i).ok).toBe(true);
    }
    expect(hp(target)).toBe(0);
    for (const action of ["attack", "poison"] as const) {
      expect(play("attacker-0", action, target)).toMatchObject({ ok: false, reason: "resting" });
    }
    expect(play("them", "shield", target)).toMatchObject({ ok: false, reason: "resting" });
    expect(store.points("them", T0).points).toBe(10);
    expect(store.get(target)!.body).toBe("note by them");

    expect(play("them", "heal", target).ok).toBe(true);
    expect(hp(target)).toBe(1);
    expect(play("attacker-0", "attack", target).ok).toBe(true);
  });

  it("heal and shield only your own; attack and poison only other people's", () => {
    const { note, play } = world();
    const mine = note("me");
    const theirs = note("them");
    expect(play("me", "attack", mine)).toMatchObject({ ok: false, reason: "yours" });
    expect(play("me", "poison", mine)).toMatchObject({ ok: false, reason: "yours" });
    expect(play("me", "shield", theirs)).toMatchObject({ ok: false, reason: "not-yours" });
    play("someone", "attack", theirs);
    expect(play("me", "heal", theirs)).toMatchObject({ ok: false, reason: "not-yours" });
  });
});

describe("shield", () => {
  it("absorbs exactly one hit, leaving hearts unchanged, and can't be stacked", () => {
    const { store, note, play, hp } = world();
    const mine = note("me");
    expect(play("me", "shield", mine).ok).toBe(true);
    expect(play("me", "shield", mine)).toMatchObject({ ok: false, reason: "already-shielded" });
    expect(store.points("me", T0).points).toBe(8);
    const hit = play("them", "attack", mine);
    expect(hit).toMatchObject({ ok: true, change: { absorbed: true } });
    expect(hp(mine)).toBe(10);
    expect(store.get(mine)!.shield).toBe(0);
    expect(play("them", "attack", mine)).toMatchObject({ ok: true, change: { absorbed: false } });
    expect(hp(mine)).toBe(9);
  });

  it("takes the first poison hit, but the poison still lands and ticks", () => {
    const { store, note, play, hp } = world();
    const mine = note("me");
    play("me", "shield", mine);
    expect(play("them", "poison", mine)).toMatchObject({ ok: true, change: { absorbed: true } });
    expect(hp(mine)).toBe(10);
    expect(store.get(mine)!.poison_ticks).toBe(2);
    store.resolveDue(T0 + 2 * POISON_INTERVAL_MS);
    expect(hp(mine)).toBe(8);
  });

  it("takes a poison tick when added after the poison", () => {
    const { store, note, play, hp } = world();
    const mine = note("me");
    play("them", "poison", mine);
    play("me", "shield", mine);
    const ticks = store.resolveDue(T0 + 2 * POISON_INTERVAL_MS);
    expect(ticks.map((c) => c.absorbed)).toEqual([true, false]);
    expect(hp(mine)).toBe(8);
  });
});

describe("poison", () => {
  it("hits now, then once at 10 s and once at 20 s", () => {
    const { store, note, play, hp } = world();
    const target = note("them");
    play("me", "poison", target);
    expect(hp(target)).toBe(9);
    expect(store.resolveDue(T0 + POISON_INTERVAL_MS - 1)).toEqual([]);
    expect(store.resolveDue(T0 + POISON_INTERVAL_MS)).toHaveLength(1);
    expect(hp(target)).toBe(8);
    expect(store.resolveDue(T0 + 2 * POISON_INTERVAL_MS)).toHaveLength(1);
    expect(hp(target)).toBe(7);
    expect(store.get(target)).toMatchObject({ poison_ticks: 0, poison_next_at: null });
    expect(store.resolveDue(T0 + 100 * POISON_INTERVAL_MS)).toEqual([]);
  });

  it("can't be stacked; a refused second dose costs nothing and doesn't extend it", () => {
    const { store, note, play } = world();
    const target = note("them");
    play("me", "poison", target);
    const due = store.get(target)!.poison_next_at;
    expect(play("other", "poison", target, T0 + 5000)).toMatchObject({ ok: false, reason: "already-poisoned" });
    expect(store.points("other", T0).points).toBe(10);
    expect(store.get(target)!.poison_next_at).toBe(due);
  });

  it("isn't cured by healing", () => {
    const { store, note, play, hp } = world();
    const mine = note("me");
    play("them", "poison", mine);
    play("me", "heal", mine);
    expect(hp(mine)).toBe(10);
    expect(store.get(mine)!.poison_ticks).toBe(2);
    store.resolveDue(T0 + 2 * POISON_INTERVAL_MS);
    expect(hp(mine)).toBe(8);
  });

  it("clears at zero hearts", () => {
    const { store, note, play, hp } = world();
    const target = note("them");
    for (let i = 0; i < 8; i++) play(`a${i}`, "attack", target);
    play("p", "poison", target);
    expect(hp(target)).toBe(1);
    store.resolveDue(T0 + POISON_INTERVAL_MS);
    expect(hp(target)).toBe(0);
    expect(store.get(target)).toMatchObject({ poison_ticks: 0, poison_next_at: null });
    expect(store.resolveDue(T0 + 10 * POISON_INTERVAL_MS)).toEqual([]);
  });

  it("catches up in order after a restart, without ticking twice", () => {
    const w = world();
    const first = w.note("them");
    const second = w.note("other");
    w.play("me", "poison", first, T0);
    w.play("me", "poison", second, T0 + 5000);
    w.store.close();

    // the server was down for a minute
    const again = openStore(w.path);
    const ticks = again.resolveDue(T0 + 60_000);
    expect(ticks.map((c) => c.target)).toEqual([first, second, first, second]);
    expect(again.get(first)!.hp).toBe(7);
    expect(again.get(second)!.hp).toBe(7);
    again.close();

    const third = openStore(w.path);
    expect(third.resolveDue(T0 + 120_000)).toEqual([]);
    expect(third.get(first)!.hp).toBe(7);
  });
});

describe("action tokens", () => {
  it("apply a submission once, however often it's repeated", () => {
    const { store, note, play, hp } = world();
    const target = note("them");
    const t = token();
    expect(play("me", "attack", target, T0, t).ok).toBe(true);
    expect(play("me", "attack", target, T0, t)).toMatchObject({ ok: false, reason: "duplicate" });
    expect(play("me", "attack", target, T0 + 1000, t)).toMatchObject({ ok: false, reason: "duplicate" });
    expect(hp(target)).toBe(9);
    expect(store.points("me", T0).points).toBe(9);
  });

  it("aren't spent by a refused play, so the same click can be retried", () => {
    const { note, play } = world();
    const mine = note("me");
    const t = token();
    expect(play("me", "heal", mine, T0, t)).toMatchObject({ ok: false, reason: "full" });
    play("them", "attack", mine);
    expect(play("me", "heal", mine, T0, t).ok).toBe(true);
  });
});

describe("replies and withdrawal", () => {
  it("keeps one level of replies, oldest first, and refuses a missing parent", () => {
    const { store, note } = world();
    const root = note("me");
    const first = store.insertReply("them", root, "Them", "first", T0);
    const second = store.insertReply("me", root, "Me", "🎉", T0 + 1);
    expect(first.ok && second.ok).toBe(true);
    expect(store.thread(root)!.replies.map((r) => r.body)).toEqual(["first", "🎉"]);
    expect(store.insertReply("them", 9999, "Them", "hello?", T0)).toEqual({ ok: false, reason: "missing" });
    if (!first.ok) throw new Error("unreachable");
    expect(store.insertReply("them", first.change.target, "Them", "nested", T0)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("only lets the author withdraw, removes content from storage, keeps others' replies and closes the thread", () => {
    const { store, note, play } = world();
    const root = store.insertNote("me", "Me", "secret words", "[[1,1,2,2]]", T0).target;
    const reply = store.insertReply("them", root, "Them", "still mine", T0);
    if (!reply.ok) throw new Error("reply refused");
    play("me", "shield", root);

    expect(store.withdraw("them", root, T0)).toEqual({ ok: false, reason: "not-yours" });
    expect(store.get(root)!.body).toBe("secret words");

    const done = store.withdraw("me", root, T0);
    expect(done.ok && done.change?.kind).toBe("withdraw");
    expect(store.get(root)).toMatchObject({ name: "", body: "", drawing: null, shield: 0 });
    expect(store.thread(root)!.replies.map((r) => r.body)).toEqual(["still mine"]);
    expect(store.insertReply("other", root, "Other", "too late", T0)).toEqual({ ok: false, reason: "withdrawn" });

    // repeating is harmless and records nothing
    const again = store.withdraw("me", root, T0 + 1);
    expect(again).toMatchObject({ ok: true, change: null });
  });

  it("refuses play on withdrawn marks and anything under a withdrawn note, for free", () => {
    const { store, note, play } = world();
    const root = note("me");
    const reply = store.insertReply("them", root, "Them", "hi", T0);
    if (!reply.ok) throw new Error("reply refused");
    const replyId = reply.change.target;
    play("other", "poison", replyId);
    store.withdraw("me", root, T0);
    expect(play("other", "attack", root)).toMatchObject({ ok: false, reason: "withdrawn" });
    expect(play("me", "heal", root)).toMatchObject({ ok: false, reason: "withdrawn" });
    expect(play("other", "attack", replyId)).toMatchObject({ ok: false, reason: "withdrawn" });
    expect(play("them", "heal", replyId)).toMatchObject({ ok: false, reason: "withdrawn" });
    expect(store.points("other", T0).points).toBe(8);
    // the reply's poison ended with the thread
    expect(store.resolveDue(T0 + 60_000)).toEqual([]);

    const own = note("them");
    play("me", "attack", own);
    store.withdraw("them", own, T0);
    expect(play("them", "heal", own)).toMatchObject({ ok: false, reason: "withdrawn" });
  });
});

describe("change log", () => {
  it("replays each changed thread once, in order of its latest change, after a cursor", () => {
    const { store, note, play } = world();
    const a = note("me");
    const cursor = store.cursor();
    const b = note("them");
    store.insertReply("them", a, "Them", "hi", T0);
    play("me", "attack", b);
    expect(store.changedSince(cursor).map((c) => c.root)).toEqual([a, b]);
    store.withdraw("me", a, T0);
    const replay = store.changedSince(cursor);
    expect(replay.map((c) => c.root)).toEqual([b, a]);
    expect(replay.at(-1)!.id).toBe(store.cursor());
    expect(store.changedSince(store.cursor())).toEqual([]);
  });

  it("stores what happened, never the content", () => {
    const w = world();
    w.store.insertNote("me", "Me", "words to forget", null, T0);
    w.store.close();
    const db = new DatabaseSync(w.path);
    const columns = (db.prepare("pragma table_info(changes)").all() as unknown as { name: string }[]).map((c) => c.name);
    expect(columns).toEqual(["id", "root_id", "mark_id", "kind", "absorbed", "created_at"]);
  });
});

it("never overspends under a burst of plays", () => {
  const { store, note, play } = world();
  const targets = [note("a"), note("b")];
  const results = Array.from({ length: 15 }, (_, i) => play("me", "attack", targets[i % 2]));
  expect(results.filter((r) => r.ok)).toHaveLength(10);
  expect(results.filter((r) => !r.ok).every((r) => !r.ok && r.reason === "points")).toBe(true);
  expect(store.points("me", T0).points).toBe(0);
});
