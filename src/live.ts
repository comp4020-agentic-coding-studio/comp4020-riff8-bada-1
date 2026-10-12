import type { IncomingMessage, ServerResponse } from "node:http";
import type { Change, Store } from "./db.ts";
import { threadEvent } from "./render.ts";

const PING_MS = 25_000;

interface Connection {
  res: ServerResponse;
  visitorId: string;
}

// fly.toml pins the app to one machine, so every open stream lives in this
// process and an in-memory set is the whole broadcast mechanism. What a
// stream has missed is never kept here: it comes from the change log.
const connections = new Set<Connection>();

// One event per thread: the thread as it is now, with the id of the change
// that prompted it. `change` is null for a replay, which the page applies
// without animating.
function send(store: Store, conn: Connection, id: number, root: number, change: Change | null): void {
  if (conn.res.writableEnded || conn.res.destroyed) return;
  const thread = store.thread(root);
  if (!thread) return;
  const data = threadEvent(thread, conn.visitorId, change, store.points(conn.visitorId, Date.now()));
  conn.res.write(`id: ${id}\ndata: ${data}\n\n`);
}

// The change id to replay after: the Last-Event-ID an EventSource sends when
// it reconnects, or, on the first connect, the cursor the page was rendered
// with (so a change between render and connect isn't lost either). With
// neither, -1: nothing to replay. (Number(null) is 0, which would replay the
// whole history, so the missing case is checked first.)
function resumeFrom(req: IncomingMessage, url: URL): number {
  const raw = req.headers["last-event-id"] ?? url.searchParams.get("after");
  if (typeof raw !== "string" || raw === "") return -1;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id >= 0 ? id : -1;
}

export function openStream(store: Store, req: IncomingMessage, res: ServerResponse, url: URL, visitorId: string): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  res.write(`event: you\ndata: ${JSON.stringify(store.points(visitorId, Date.now()))}\n\n`);

  const conn: Connection = { res, visitorId };
  const after = resumeFrom(req, url);
  if (after >= 0) {
    for (const { root, id } of store.changedSince(after)) send(store, conn, id, root, null);
  }
  // Replay and registration happen in one synchronous run, so no change can
  // land between them.
  connections.add(conn);

  const ping = setInterval(() => res.write(": ping\n\n"), PING_MS);
  res.on("close", () => {
    clearInterval(ping);
    connections.delete(conn);
  });
}

export function broadcast(store: Store, change: Change): void {
  for (const conn of connections) send(store, conn, change.id, change.root, change);
}
