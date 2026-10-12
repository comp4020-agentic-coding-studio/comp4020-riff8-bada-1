# Marks: a warm wall with conversations and emoji play

Evolve this existing app into a warm, pink noticeboard where people can leave
a note or drawing, respond with a short comment or emoji, and withdraw their
own contributions. Add a playful emoji game in which comments have health
and visitors can heal, attack, poison and shield them. It should feel like a
welcoming wall shared by a small group of friends. Work from the existing
app rather than replacing it.

This is an unattended implementation brief: make routine implementation
choices yourself and complete the work, including verification.

## 1. Comments and emoji replies

- Each active note has a clearly labelled Reply action and a compact reply
  form associated with that note. Show the note while composing so people
  know what they are responding to.
- A reply has a name and up to 280 characters of text. Emoji-only replies are
  valid. Offer a small, labelled selection such as heart, smile, hug, sparkle
  and celebration that inserts an emoji into the reply field; people can
  combine it with text or send it on its own.
- Keep one level of replies. Display replies beneath their parent, oldest
  first, with author, timestamp and an ownership indicator. Main notes stay
  newest first. Existing drawings continue to work on main notes.
- Use the existing visitor cookie for ownership and remember the typed name
  as the app already does. Two people using the same name are still distinct
  visitors. Do not expose visitor IDs in HTML or event payloads.
- Text replies, including a manually typed emoji, must work with JavaScript
  disabled through ordinary forms and server-rendered HTML. The picker and
  inline expansion can be progressive enhancements.
- Validate replies on the server, escape all user text, reject blank or
  format-character-only replies, and reject missing or withdrawn parents.
  Display a useful validation message without losing the entered reply.

## 2. Withdraw your own contributions

The user explicitly requests withdrawal. This revises the previous rule that
marks are permanent. Update README.md's explanation before implementing the
new behaviour, and update the corresponding rule below the protected riff
block in CLAUDE.md so the documentation agrees. Leave that top block intact.

- Show Withdraw only on the current visitor's active notes and replies.
  Explain briefly that ownership belongs to this browser's cookie; typing
  the same name in another browser does not grant control.
- Require a small confirmation step explaining the result, with a Cancel
  option. Make the confirmation usable without JavaScript as well.
- Authorize withdrawal on the server using the visitor cookie for every
  request. Hiding a button is insufficient. A visitor must never withdraw
  another visitor's contribution by changing an ID or submitting a request
  directly. Use POST for mutations and same-origin protection appropriate
  to cookie-based ownership.
- Replace a withdrawn main note with a quiet “This note was withdrawn”
  placeholder. Remove its text and drawing from storage and from all public
  responses. Preserve existing replies as their authors' contributions,
  beneath that placeholder, and close the thread to new replies. Do not
  cascade-delete someone else's replies.
- A withdrawn reply becomes a small “Reply withdrawn” placeholder with its
  content removed. A repeat withdrawal by its owner is harmless. Do not
  provide restoration or editing in this riff.
- Preserve existing notes and drawings when migrating the SQLite database.

## 3. Live updates and returning later

Replies and withdrawals must appear in every open browser, including the
author's other tabs, within about a second just as new notes currently do.
They must also remain correct after refresh, server restart and reconnect.

The current SSE cursor is a note's row ID. It cannot describe a new reply or
withdrawal of an old note. Rework replay around a durable, monotonic change
cursor in the same SQLite database, or another equally complete approach.
Cover the gap between page rendering and the initial stream connection too.
Do not rely solely on an in-memory history. A disconnected tab must catch up
on withdrawals as well as additions, without duplicate notes or replies.
Replay must not reveal withdrawn content from stored event snapshots.

Update docs/adr/0001-reconnect-and-return.md, or supersede it with a linked ADR,
to explain the final replay and withdrawal behaviour. Live updates must not
erase drafts, collapse the reply someone is composing, or steal focus.

## 4. Warm pink and heart appearance

Give the whole site a coherent visual refresh, including /readme/:

- Use a soft blush background, cream or pale pink cards, a deeper rose for
  buttons and accents, and dark plum text with readable contrast.
- Add restrained heart motifs in the header, empty state and small decorative
  details. Decorative hearts should be hidden from assistive technology;
  functional emoji buttons need understandable labels.
- Use rounded cards, gentle borders and shadows, comfortable spacing and
  clear typography. Make the posting area, wall, reply threads and ownership
  controls easy to distinguish. Keep withdrawal visually secondary.
- On wider screens, give the composer and wall a balanced layout. On phones,
  use a comfortable single column with no horizontal overflow. Long names,
  text and reply threads must wrap correctly; drawings stay within their cards.
- Provide visible keyboard focus, labelled inputs, generous touch targets
  and useful empty/error states. Honour reduced motion and keep any arrival
  animation subtle. Pink surfaces must retain accessible text contrast.
- Keep the friendly copy concise. Preserve the Marks name and link to the
  explanation of what the app is for. Use CSS and small inline vector motifs;
  this refresh does not need image assets or a new UI framework.

## 5. Emoji attack, defence and a points panel

Treat each active comment/reply as a little character with HP. Main notes
remain the conversation's anchors. Keep the following rules explicit in a
small “How to play” panel and in README.md:

| Action | Cost | Effect | Visual feedback |
| --- | --- | --- | --- |
| 👍 Heal | 1 point | Restore 1 HP, up to 10 | Pink hearts rise and a +1 label appears |
| 👎 Attack | 1 point | Deal 1 damage | Brief card wobble and a -1 label |
| 🤮 Poison | 2 points | Deal 1 damage now, then 1 after 10 seconds and 1 after 20 seconds | A small green bubble puff and a poison badge |
| 😍 Shield | 2 points | Add one shield that absorbs the next damaging hit | A steel-style frame closes around the heart row |

- Each existing or new comment starts at 10/10 HP. Clamp HP to 0–10.
  Display ten original pixel hearts, one per HP, with filled rose hearts for
  remaining health and empty outlines for lost health. Include the numeric
  value and text labels for poison and shield so colour is never the only
  way to understand state. Treat the individual hearts as decorative and
  expose one accessible health summary rather than ten repeated labels.
- Draw original pixel-heart shapes in inline SVG or CSS, with a distinct
  silhouette and shading suited to Marks. Borrow the general retro-game
  health-display idea; do not extract, trace or closely reproduce Minecraft
  heart textures, HUD artwork, fonts, sounds or branding.
- While poisoned, turn the remaining filled hearts green, retain empty
  outlines, and show a labelled poison badge. On a tick, briefly mark the
  heart lost; restore rose colouring when poison ends. Healing a poisoned
  comment adds a green heart because healing does not cleanse poison.
- While shielded, enclose the whole heart row in a small steel-style frame:
  silver-grey edges, subtle bevels and corner rivets, with a visible Shield
  label. The frame can coexist with green poison hearts. When the shield
  absorbs a hit, briefly flash or crack the frame once without flashing the
  screen, then remove it; the heart count stays unchanged for that hit.
  Keep the steel accent local to the health display and the rest of the
  page warm pink. Fit or wrap the ten hearts cleanly on narrow screens.
- Interpret the user's “obsessed” emoji as 😍: show it as “Shield” with a
  small shield icon so its meaning is clear. A comment can hold at most one
  shield and one poison effect. Reject duplicate active effects without
  spending points or refreshing their duration.
- A shield absorbs one damaging hit, including a poison tick, and is then
  consumed. Poison still schedules its remaining ticks. An initial poison
  hit absorbed by a shield still applies poison. Healing does not cleanse it.
- At zero HP, label the comment “Resting”. Its content remains readable and
  its author can still withdraw it. Clear poison, stop further damage, and
  allow healing to bring it back into play. Reject attack, poison and shield
  on resting comments without charging points. Health never removes content.
- Visitors may heal or shield their own comments; attack and poison target
  other visitors' comments. Check ownership on the server, not by name.
- Emoji game buttons are explicit actions, separate from the emoji picker
  for composing replies. Typing 👍 or 🤮 in a normal comment has no game
  effect. Show each action's cost and a brief explanation before use.
- Add a compact personal points panel near the composer showing “Your play
  points: N/10”, replenishment information and the game rules. Each visitor
  starts with 10 points and recovers 1 per minute up to 10. Posting notes or
  comments is free. This panel is a spendable play budget, not a leaderboard.
  Keep it visible and comfortably placed on mobile too.
- Store points, HP, shields, poison deadlines and game changes in the same
  SQLite database. Compute replenishment from server timestamps; refresh,
  reconnect and restart must not reset points or duplicate poison damage.
  Resolve overdue poison ticks in order after downtime. Make charging points,
  applying an effect and recording the change atomic. Concurrent actions must
  not overspend points or double-consume a shield.
- Use server-validated POST actions, same-origin protection and a durable
  single-use action token so double-clicking or retrying the same submission
  cannot apply damage or charge points twice. Reject withdrawn targets and
  targets under a withdrawn main note. Withdrawal cancels active game effects.
- Extend the durable change stream to carry health and status changes. All
  viewers should see the same outcome, with the acting visitor's points panel
  synchronized across their tabs without exposing anyone else's points or
  identity. Poison must progress while the app runs even when no browser is
  open; use persisted deadlines, not a browser timer as the source of truth.
- Build effects with CSS and small inline vectors. Keep animations brief,
  local to the affected comment and free of flashing or layout movement.
  Announce concise outcomes accessibly. With reduced motion, show static
  labels and status changes. Reconnecting should reconcile current state
  without replaying a long sequence of old attack animations.
- Game actions and the points panel must work with JavaScript disabled using
  server-rendered forms and redirects. Animation and immediate updates are
  enhancements; show current state on the next page request without scripts.

## Scope and verification

Keep the existing Node/TypeScript server, SQLite on the Fly volume, cookie
identity, server-rendered interface and single-machine deployment. Keep
dependencies minimal. Do not add accounts, a separate database, nested reply
threads or drawing replies. The original main-note drawing interaction must
still work.

Keep spec/invariants.test.ts green. Update the app-owned tests where they
encode the superseded permanence rule, and add meaningful coverage for reply
validation, migration, ownership enforcement, withdrawal and reconnect replay.
Also cover HP bounds, costs and regeneration using a controlled clock, poison
timing across restart, shield consumption, zero-HP revival, rejected actions
without charging, duplicate submissions and concurrent spending. Extend live
replay checks to game changes. Do not make timing tests wait real minutes.
Run pnpm check against the running app.

Verify in a real browser at desktop and phone sizes. Use two independent
cookie sessions to check a note, a comment, an emoji-only reply, live delivery,
and that only the author can withdraw each contribution. Disconnect a tab,
add replies and withdraw a note elsewhere, restart the server, reconnect and
confirm the tab matches a fresh page without exposing withdrawn content.
Check a thread with surviving replies, withdrawing a reply, cancelling a
withdrawal, keyboard operation, scripts disabled, and that live updates keep
a partially composed reply intact. Report any verification you could not run
honestly in the implementation handoff. In two cookie sessions, also verify
healing, attack, poison, shielding, resting and revival; matching health in
both tabs; the personal points panel; reduced-motion effects; and that a
withdrawn contribution cannot be targeted or revived through game actions.

Follow the repo's pod-run workflow: keep main deployable, leave agent/ alone,
do not add grading reflections or a PROCESS.md entry, and delete prompt.md in
your final implementation commit. Do not deploy or push from the agent run;
the harness handles that.
