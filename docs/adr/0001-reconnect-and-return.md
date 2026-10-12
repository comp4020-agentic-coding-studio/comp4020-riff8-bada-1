# 1. Reconnect and return: replay what changed, from a change log

Status: accepted (revised when replies, withdrawal and play arrived)

## Context

Marks is live: whatever happens on the wall appears in every open session
within about a second, pushed over Server-Sent Events from `GET /events`.
Live delivery only covers the time someone is connected, though. A laptop
lid closes, a phone drops off the wifi, a Fly redeploy restarts the one
machine and every open stream drops with it. So the question is what
someone sees when their connection drops and comes back, or when they come
back the next day.

The first version of this decision leaned on marks being permanent: each
event's id was the mark's row id, and "every mark newer than id N" described
everything someone could have missed. That stopped being true once the wall
gained replies, withdrawal and hearts. A reply to an old note, a withdrawn
note and a poison tick are all changes to things that already existed, and
none of them gets a new mark id. Withdrawal adds a second constraint:
whatever replay sends must never bring back text someone has taken down.

[README.md](../../README.md) still sets the terms. This is a wall for a
small room, and a missed change is a missed contribution from someone you
know. A tab that looks connected but is quietly wrong is the failure a
small room is least likely to notice and most likely to be hurt by.

## Options

**Replay a log of changes, rendered from current state.** Every change
(a note, a reply, a withdrawal, a play, a poison tick) appends a row to a
`changes` table in the same SQLite file: a monotonic id, the thread it
touched, the mark and the kind. No content. On reconnect the server sends
every thread with a change newer than the client's cursor, rendered as it
is *now*.

**Replay stored event snapshots.** Log each event's full payload and send
the missed ones back in order. It reproduces exactly what a connected tab
saw, animation by animation, but the log would hold copies of text that has
since been withdrawn, which then either leaks on replay or needs scrubbing
from history on every withdrawal.

**Keep the old mark-id replay and ask people to reload for the rest.** The
cheapest change, but a tab that was away during a withdrawal would go on
showing the withdrawn note until a reload, which is the quiet wrongness
this decision exists to prevent.

## Decision

Replay from the change log, rendered from current state.

- The SSE `id:` is the change id. The page is rendered with the newest
  change id as its cursor (`data-cursor`), and its first connect sends it as
  `?after=`, which covers anything that lands between render and connect.
  After that the browser's own `Last-Event-ID` carries the cursor across
  reconnects. A connect with neither replays nothing.
- Replay sends each changed thread once, as it is now, ordered by the
  thread's latest change. A tab that drops partway through a replay has
  seen every thread whose latest change is at or before the last id it got,
  so resuming from that id misses nothing and repeats nothing. The page
  updates threads in place by id, so a thread it already has is updated,
  never duplicated.
- Events carry the whole thread rendered by the server for that one
  connection. That keeps ownership controls right per viewer, and no
  visitor id ever leaves the server. Because the HTML comes from current
  rows, and withdrawal blanks the row itself, replay can't reveal anything
  withdrawn.
- A replayed event has no `change`, so the page applies it without
  animation: someone returning to a thread that took twenty hits sees its
  current hearts, not twenty wobbles.
- A browser `EventSource` retries network drops itself but gives up for
  good on an error answer, such as a proxy's 502 while the machine
  restarts. The page reopens it with backoff from its newest cursor, and
  straight away when the tab becomes visible again.
- Poison runs from deadlines stored on each mark and is resolved on the
  server's clock (every 250 ms, and on each page load), oldest first, so
  ticks missed while the machine was stopped land in order when it starts.
  Each tick is a change like any other, so a returning tab catches up on
  those too.

Coming back the next day is the same case with a longer gap: the page load
renders the whole wall from SQLite, and the first connect replays anything
newer than what it was rendered with.

## Withdrawal

Withdrawing blanks the mark's name, text and drawing in the database and
records a `withdraw` change. A withdrawn note renders as a placeholder;
replies other people left under it stay, and the thread closes to new
replies and to play. A withdrawn reply becomes a small placeholder. A repeat
withdrawal succeeds and records nothing. Only the visitor cookie that
posted a mark can withdraw it, checked on the server for every request.

## Consequences

- The `changes` table grows with every play. At a dozen people it's a few
  thousand small rows a week; if it ever matters, rows older than any
  plausible cursor can be dropped, at the cost of those clients doing a
  full reload's worth of replay.
- A long absence replays a burst of whole threads. They're applied in place
  without animation, so the burst changes what's on screen but doesn't
  shake it.
- Live updates replace a card's contents but never the reply box under a
  thread, and they put back focus and any open withdraw confirmation, so
  someone halfway through a reply loses nothing. If the thread closes
  while they're typing, their text stays on screen and the send button
  disables.
- A replayed change looks the same as current state. Someone can't tell
  "this just happened" from "this happened while you were away".
- In-process broadcast assumes one machine, which `fly.toml` pins. A second
  machine would split the room in two until something shared carried events
  between them.
