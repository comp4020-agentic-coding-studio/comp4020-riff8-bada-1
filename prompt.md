# Marks: a warm wall with conversations

Evolve this existing app into a warm, pink noticeboard where people can leave
a note or drawing, respond with a short comment or emoji, and withdraw their
own contributions. It should feel like a welcoming wall shared by a small
group of friends. Work from the existing app rather than replacing it.

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

## Scope and verification

Keep the existing Node/TypeScript server, SQLite on the Fly volume, cookie
identity, server-rendered interface and single-machine deployment. Keep
dependencies minimal. Do not add accounts, a separate database, nested reply
threads or drawing replies. The original main-note drawing interaction must
still work.

Keep spec/invariants.test.ts green. Update the app-owned tests where they
encode the superseded permanence rule, and add meaningful coverage for reply
validation, migration, ownership enforcement, withdrawal and reconnect replay.
Run pnpm check against the running app.

Verify in a real browser at desktop and phone sizes. Use two independent
cookie sessions to check a note, a comment, an emoji-only reply, live delivery,
and that only the author can withdraw each contribution. Disconnect a tab,
add replies and withdraw a note elsewhere, restart the server, reconnect and
confirm the tab matches a fresh page without exposing withdrawn content.
Check a thread with surviving replies, withdrawing a reply, cancelling a
withdrawal, keyboard operation, scripts disabled, and that live updates keep
a partially composed reply intact. Report any verification you could not run
honestly in the implementation handoff.

Follow the repo's pod-run workflow: keep main deployable, leave agent/ alone,
do not add grading reflections or a PROCESS.md entry, and delete prompt.md in
your final implementation commit. Do not deploy or push from the agent run;
the harness handles that.
