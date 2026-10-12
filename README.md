# Marks

Marks is a warm, shared noticeboard for a small, specific room: my crit
group, and whoever else visits this repo. Type a name and a short line,
sketch something, or both, and it joins everyone else's on the wall ---
visible the moment you post it, and still there the next time you're back.
Anyone can answer a note with a short reply or an emoji, and every note and
reply carries ten little hearts that friends can heal, poke, poison or
shield.

## What good means here

Good, for this app, isn't "used by many people." [Robin Sloan's *An App Can
Be a Home-Cooked Meal*](https://www.robinsloan.com/notes/home-cooked-app/)
argues that software doesn't need scale or a business model to be worth
building --- it can be made, like a meal, for people you actually know, and
judged by whether it serves them rather than whether it grows. Marks is built
the same way: for a room of maybe a dozen people at most, not a public feed.
[Ink & Switch's *Malleable
Software*](https://www.inkandswitch.com/essay/malleable-software/) frames the
same idea at a different scale --- a luthier's workshop, tools built and
rearranged for exactly the work in front of them --- and that's the standard
I'm holding the schema to: the smallest shape that carries the interactions
the room actually asked for.

So: no accounts. A visitor is a random id in a cookie, set the first time
they show up --- good enough to tell two people apart, and to know a mark is
"yours" when you're back, but not to verify who anyone is. A name is just a
label someone types; two people can call themselves the same thing, and
they're still two different visitors. Ownership belongs to the browser's
cookie, not the name: typing someone else's name in another browser doesn't
let you withdraw their notes. The wall doesn't paginate, filter, or rank ---
it's short enough that reading top to bottom is the whole interface.

## Replies

Each note has a Reply button. A reply is a name and up to 280 characters,
and an emoji on its own counts. Replies sit beneath their note, oldest
first, one level deep; there are no replies to replies and no drawings in
replies. Everything works with JavaScript off --- the emoji picker and the
inline reply box are only conveniences on top of ordinary forms.

## Withdrawing what you posted

Marks used to be permanent, and the first version of this README argued for
that: a wall nobody can edit is a simpler promise. Once real people were
leaving real marks, the room asked for a way to take something back, and
that's a better reason than the original argument. So you can now withdraw
your own notes and replies, after a short confirmation. You still can't
edit, and you can't undo a withdrawal.

Withdrawing a note removes its text and drawing from the database, not just
from the page, and leaves a quiet "This note was withdrawn" in its place.
Replies other people left under it stay --- they're their authors' words,
not yours to remove --- but the thread closes to new replies. A withdrawn
reply becomes a small "Reply withdrawn" placeholder. Every withdrawal is
checked on the server against the visitor cookie, so hiding a button is
never the only thing standing in the way.

## How to play

Every active note and reply is a little character with ten hearts. You get
a budget of play points to spend on them: everyone starts with 10, gets 1
back every minute up to 10, and posting or replying is always free.

| Action | Cost | Effect | Visual feedback |
| --- | --- | --- | --- |
| 👍 Heal | 1 point | Restore 1 HP, up to 10 | Pink hearts rise and a +1 label appears |
| 👎 Attack | 1 point | Deal 1 damage | Brief card wobble and a -1 label |
| 🤮 Poison | 2 points | Deal 1 damage now, then 1 after 10 seconds and 1 after 20 seconds | A small green bubble puff and a poison badge |
| 😍 Shield | 2 points | Add one shield that absorbs the next damaging hit | A steel-style frame closes around the heart row |

You heal and shield your own notes and replies; you attack and poison other
people's. A shield absorbs the next damaging hit, poison ticks included,
and then it's gone. Poison keeps ticking through a shield, and healing
doesn't cure it. A note can carry one shield and one poison at a time;
trying to add a second costs nothing and does nothing.

At zero hearts a note is "Resting": it stays readable, poison clears, and
nobody can hurt it until its author heals it back into play. Health never
removes anything from the wall. Typing 👍 or 🤮 in a reply is just an
emoji; only the game buttons play. Withdrawing a note or reply ends any
game effects on it, and nothing under a withdrawn note can be played.

## Live, and coming back later

New notes, replies, withdrawals and every change in health appear in every
open tab within about a second. What someone sees when their connection
drops, or when they come back the next day, is settled in [ADR 0001:
reconnect and
return](https://github.com/comp4020-agentic-coding-studio/comp4020-riff8-bada-1/blob/main/docs/adr/0001-reconnect-and-return.md).

The server logs who did what, by a short anonymous tag for each visitor
cookie, so `flyctl logs` can tell two people apart without printing anyone's
cookie.

## What I read to get here

- Robin Sloan, [*An App Can Be a Home-Cooked
  Meal*](https://www.robinsloan.com/notes/home-cooked-app/) and its
  [five-year follow-up](https://www.robinsloan.com/lab/five-years-of-home-cooked-apps/)
- Ink & Switch, [*Malleable
  Software*](https://www.inkandswitch.com/essay/malleable-software/)
- the final project brief's own pointers toward the small web and games made
  for a handful of friends, which sent me looking for both of the above
