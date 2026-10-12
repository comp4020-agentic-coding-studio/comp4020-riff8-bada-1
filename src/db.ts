import { DatabaseSync } from "node:sqlite";

// Everything the wall knows lives in one SQLite file: marks, the change log
// that live updates replay from, play points and spent action tokens. Every
// function takes `now` (ms since the epoch) instead of reading the clock, so
// tests can drive time; the server passes Date.now().

export const MAX_HP = 10;
export const MAX_PLAY_POINTS = 10;
export const REGEN_MS = 60_000;
export const POISON_INTERVAL_MS = 10_000;
// ticks after the initial hit
export const POISON_TICKS = 2;

export type Action = "heal" | "attack" | "poison" | "shield";
// `own`: whether the action targets your own marks (true) or other people's
export const ACTIONS: Record<Action, { cost: number; own: boolean }> = {
  heal: { cost: 1, own: true },
  attack: { cost: 1, own: false },
  poison: { cost: 2, own: false },
  shield: { cost: 2, own: true },
};

export interface Mark {
  id: number;
  visitor_id: string;
  name: string;
  body: string;
  created_at: string;
  // validated stroke JSON (see drawing.ts), or null for a text-only mark
  drawing: string | null;
  // the note a reply belongs to; null for a note
  parent_id: number | null;
  withdrawn_at: string | null;
  hp: number;
  shield: number;
  // poison ticks still to come, and when the next one is due
  poison_ticks: number;
  poison_next_at: number | null;
}

export interface Thread {
  note: Mark;
  // oldest first
  replies: Mark[];
}

export type ChangeKind = "note" | "reply" | "withdraw" | Action | "tick";

// One row of the change log. It records what happened, never content: replay
// renders each thread from its current state, so nothing withdrawn can leak
// back out of the log.
export interface Change {
  id: number;
  root: number;
  target: number;
  kind: ChangeKind;
  // a shield took the hit
  absorbed: boolean;
}

export type PlayRefusal =
  | "invalid"
  | "missing"
  | "withdrawn"
  | "not-yours"
  | "yours"
  | "duplicate"
  | "full"
  | "resting"
  | "already-poisoned"
  | "already-shielded"
  | "points";

export type PlayResult =
  | { ok: true; change: Change; mark: Mark }
  | { ok: false; reason: PlayRefusal; mark?: Mark };

export interface Points {
  points: number;
  // until the next point comes back, or null when full
  nextInMs: number | null;
}

export type Store = ReturnType<typeof openStore>;

function addColumn(db: DatabaseSync, column: string, definition: string): void {
  const columns = db.prepare("pragma table_info(marks)").all() as unknown as { name: string }[];
  if (!columns.some((c) => c.name === column)) db.exec(`alter table marks add column ${column} ${definition}`);
}

export function openStore(file: string) {
  const db = new DatabaseSync(file);

  db.exec(`
    create table if not exists marks (
      id integer primary key autoincrement,
      visitor_id text not null,
      name text not null,
      body text not null,
      created_at text not null
    )
  `);
  // Older databases get each column added in place; existing marks keep
  // their text and drawing and start at full health.
  addColumn(db, "drawing", "text");
  addColumn(db, "parent_id", "integer references marks(id)");
  addColumn(db, "withdrawn_at", "text");
  addColumn(db, "hp", `integer not null default ${MAX_HP}`);
  addColumn(db, "shield", "integer not null default 0");
  addColumn(db, "poison_ticks", "integer not null default 0");
  addColumn(db, "poison_next_at", "integer");
  db.exec(`
    create index if not exists marks_parent on marks (parent_id);
    create index if not exists marks_poison on marks (poison_next_at) where poison_next_at is not null;
    create table if not exists changes (
      id integer primary key autoincrement,
      root_id integer not null,
      mark_id integer not null,
      kind text not null,
      absorbed integer not null default 0,
      created_at integer not null
    );
    create table if not exists visitors (
      id text primary key,
      points integer not null,
      -- when \`points\` was last true; regeneration counts from here
      updated_at integer not null
    );
    create table if not exists action_tokens (
      token text primary key,
      visitor_id text not null,
      created_at integer not null
    );
  `);

  const q = {
    insert: db.prepare(
      "insert into marks (visitor_id, name, body, drawing, parent_id, created_at) values (?, ?, ?, ?, ?, ?)",
    ),
    get: db.prepare("select * from marks where id = ?"),
    notes: db.prepare("select * from marks where parent_id is null order by id desc"),
    allReplies: db.prepare("select * from marks where parent_id is not null order by id asc"),
    replies: db.prepare("select * from marks where parent_id = ? order by id asc"),
    withdraw: db.prepare(
      `update marks set name = '', body = '', drawing = null, withdrawn_at = ?,
         shield = 0, poison_ticks = 0, poison_next_at = null where id = ?`,
    ),
    // a withdrawn note's thread is out of play, replies included
    endThreadEffects: db.prepare("update marks set shield = 0, poison_ticks = 0, poison_next_at = null where parent_id = ?"),
    health: db.prepare("update marks set hp = ?, shield = ?, poison_ticks = ?, poison_next_at = ? where id = ?"),
    nextDue: db.prepare(
      "select * from marks where poison_next_at is not null and poison_next_at <= ? order by poison_next_at, id limit 1",
    ),
    change: db.prepare("insert into changes (root_id, mark_id, kind, absorbed, created_at) values (?, ?, ?, ?, ?)"),
    cursor: db.prepare("select coalesce(max(id), 0) as id from changes"),
    since: db.prepare("select root_id as root, max(id) as id from changes where id > ? group by root_id order by id"),
    visitor: db.prepare("select points, updated_at from visitors where id = ?"),
    saveVisitor: db.prepare(
      "insert into visitors (id, points, updated_at) values (?, ?, ?) on conflict (id) do update set points = excluded.points, updated_at = excluded.updated_at",
    ),
    token: db.prepare("select 1 from action_tokens where token = ?"),
    spendToken: db.prepare("insert into action_tokens (token, visitor_id, created_at) values (?, ?, ?)"),
  };

  const get = (id: number): Mark | undefined => q.get.get(id) as unknown as Mark | undefined;

  // node:sqlite is synchronous and the server is one process, so nothing
  // interleaves inside fn; the transaction makes each step all-or-nothing
  // on disk, so a crash can't charge points without applying the effect.
  function tx<T>(fn: () => T): T {
    db.exec("begin immediate");
    try {
      const out = fn();
      db.exec("commit");
      return out;
    } catch (err) {
      db.exec("rollback");
      throw err;
    }
  }

  function record(mark: Mark, kind: ChangeKind, absorbed: boolean, now: number): Change {
    const root = mark.parent_id ?? mark.id;
    const { lastInsertRowid } = q.change.run(root, mark.id, kind, absorbed ? 1 : 0, now);
    return { id: Number(lastInsertRowid), root, target: mark.id, kind, absorbed };
  }

  function saveHealth(m: Mark): void {
    q.health.run(m.hp, m.shield, m.poison_ticks, m.poison_next_at, m.id);
  }

  // One damaging hit: a shield takes it and is used up, otherwise a heart
  // goes. At zero the mark rests, which ends any poison.
  function damage(m: Mark): boolean {
    if (m.shield) {
      m.shield = 0;
      return true;
    }
    m.hp = Math.max(0, m.hp - 1);
    if (m.hp === 0) {
      m.poison_ticks = 0;
      m.poison_next_at = null;
    }
    return false;
  }

  // Points as of `now`, plus the moment regeneration counts from, so a
  // spend keeps the part-minute already earned towards the next point.
  function pointsAt(visitorId: string, now: number): { points: number; since: number } {
    const row = q.visitor.get(visitorId) as unknown as { points: number; updated_at: number } | undefined;
    if (!row) return { points: MAX_PLAY_POINTS, since: now };
    const earned = Math.max(0, Math.floor((now - row.updated_at) / REGEN_MS));
    const points = Math.min(MAX_PLAY_POINTS, row.points + earned);
    return { points, since: points === MAX_PLAY_POINTS ? now : row.updated_at + earned * REGEN_MS };
  }

  function rootOf(m: Mark): Mark {
    return m.parent_id === null ? m : (get(m.parent_id) as Mark);
  }

  return {
    close: () => db.close(),

    get,

    insertNote(visitorId: string, name: string, body: string, drawing: string | null, now: number): Change {
      return tx(() => {
        const { lastInsertRowid } = q.insert.run(visitorId, name, body, drawing, null, new Date(now).toISOString());
        return record(get(Number(lastInsertRowid)) as Mark, "note", false, now);
      });
    },

    insertReply(
      visitorId: string,
      parentId: number,
      name: string,
      body: string,
      now: number,
    ): { ok: true; change: Change } | { ok: false; reason: "missing" | "withdrawn" } {
      return tx(() => {
        const parent = get(parentId);
        // one level of replies: a reply's parent has to be a note
        if (!parent || parent.parent_id !== null) return { ok: false as const, reason: "missing" as const };
        if (parent.withdrawn_at) return { ok: false as const, reason: "withdrawn" as const };
        const { lastInsertRowid } = q.insert.run(visitorId, name, body, null, parentId, new Date(now).toISOString());
        return { ok: true as const, change: record(get(Number(lastInsertRowid)) as Mark, "reply", false, now) };
      });
    },

    // Only the mark's own visitor may withdraw it. A repeat is a no-op that
    // still succeeds, with no change to broadcast.
    withdraw(
      visitorId: string,
      id: number,
      now: number,
    ): { ok: true; change: Change | null; mark: Mark } | { ok: false; reason: "missing" | "not-yours" } {
      return tx(() => {
        const mark = get(id);
        if (!mark) return { ok: false as const, reason: "missing" as const };
        if (mark.visitor_id !== visitorId) return { ok: false as const, reason: "not-yours" as const };
        if (mark.withdrawn_at) return { ok: true as const, change: null, mark };
        q.withdraw.run(new Date(now).toISOString(), id);
        if (mark.parent_id === null) q.endThreadEffects.run(id);
        return { ok: true as const, change: record(mark, "withdraw", false, now), mark };
      });
    },

    play(visitorId: string, action: Action, targetId: number, token: string, now: number): PlayResult {
      return tx((): PlayResult => {
        if (!(action in ACTIONS) || !/^[A-Za-z0-9_-]{8,64}$/.test(token)) return { ok: false, reason: "invalid" };
        if (q.token.get(token)) return { ok: false, reason: "duplicate" };
        const mark = get(targetId);
        if (!mark) return { ok: false, reason: "missing" };
        if (mark.withdrawn_at || rootOf(mark).withdrawn_at) return { ok: false, reason: "withdrawn", mark };
        const { cost, own } = ACTIONS[action];
        const mine = mark.visitor_id === visitorId;
        if (own && !mine) return { ok: false, reason: "not-yours", mark };
        if (!own && mine) return { ok: false, reason: "yours", mark };
        if (action === "heal" && mark.hp >= MAX_HP) return { ok: false, reason: "full", mark };
        if (action !== "heal" && mark.hp === 0) return { ok: false, reason: "resting", mark };
        if (action === "poison" && mark.poison_ticks > 0) return { ok: false, reason: "already-poisoned", mark };
        if (action === "shield" && mark.shield) return { ok: false, reason: "already-shielded", mark };
        const wallet = pointsAt(visitorId, now);
        if (wallet.points < cost) return { ok: false, reason: "points", mark };

        let absorbed = false;
        if (action === "heal") mark.hp += 1;
        if (action === "shield") mark.shield = 1;
        if (action === "attack") absorbed = damage(mark);
        if (action === "poison") {
          absorbed = damage(mark);
          // a hit that took the last heart leaves nothing to poison
          if (mark.hp > 0) {
            mark.poison_ticks = POISON_TICKS;
            mark.poison_next_at = now + POISON_INTERVAL_MS;
          }
        }
        saveHealth(mark);
        q.saveVisitor.run(visitorId, wallet.points - cost, wallet.since);
        q.spendToken.run(token, visitorId, now);
        return { ok: true, change: record(mark, action, absorbed, now), mark };
      });
    },

    // Applies every poison tick due by `now`, oldest first, so ticks missed
    // while the server was down land in the order they would have. Each is
    // logged at its due time, and applying one moves the deadline on, so
    // running this twice can't tick twice.
    resolveDue(now: number): Change[] {
      const out: Change[] = [];
      for (;;) {
        const mark = q.nextDue.get(now) as unknown as Mark | undefined;
        if (!mark) return out;
        out.push(
          tx(() => {
            const due = mark.poison_next_at as number;
            const absorbed = damage(mark);
            if (mark.hp > 0) {
              mark.poison_ticks -= 1;
              mark.poison_next_at = mark.poison_ticks > 0 ? due + POISON_INTERVAL_MS : null;
            }
            saveHealth(mark);
            return record(mark, "tick", absorbed, due);
          }),
        );
      }
    },

    points(visitorId: string, now: number): Points {
      const { points, since } = pointsAt(visitorId, now);
      return { points, nextInMs: points >= MAX_PLAY_POINTS ? null : since + REGEN_MS - now };
    },

    // Notes newest first, each with its replies oldest first.
    threads(): Thread[] {
      const replies = new Map<number, Mark[]>();
      for (const r of q.allReplies.all() as unknown as Mark[]) {
        const list = replies.get(r.parent_id as number) ?? [];
        list.push(r);
        replies.set(r.parent_id as number, list);
      }
      return (q.notes.all() as unknown as Mark[]).map((note) => ({ note, replies: replies.get(note.id) ?? [] }));
    },

    thread(root: number): Thread | undefined {
      const note = get(root);
      if (!note || note.parent_id !== null) return undefined;
      return { note, replies: q.replies.all(root) as unknown as Mark[] };
    },

    // The newest change id: the cursor a freshly rendered page starts from.
    cursor(): number {
      return (q.cursor.get() as unknown as { id: number }).id;
    },

    // Every thread touched after `after`, once each, ordered by its latest
    // change. A client that stops partway through has seen every thread
    // whose latest change is at or before the last id it got, so resuming
    // from that id misses nothing and repeats nothing.
    changedSince(after: number): { root: number; id: number }[] {
      return q.since.all(after) as unknown as { root: number; id: number }[];
    },
  };
}
