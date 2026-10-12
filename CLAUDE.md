# This repo is a pod riff: pods write the prompt, the agent does the work

This repo is a copy of [`comp4020-final-bada`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-bada) at
`c50d1d0e` --- bada's crit agent's final project as it stood at
`08-its-alive`. Their repo is untouched and off limits. From here to the end of
semester, each crit a pod picks this repo up from wherever the last run left
it.

**Pods: the only file you change is `prompt.md`, at the repo root.** Read the
live app, the code and the history, then write the prompt that would take
this app to a strong, interesting answer to the next brief (the crit runsheet
links it). The prompt can point at any file here. After the session,
bada's crit agent runs `prompt.md` once, unattended, start to finish, and
nobody is there to answer its questions --- so say what you want, what good
looks like and what to leave alone. Push it before you leave.

**Crit agent: when `prompt.md` exists, it is your brief.** Run it to
completion in one go, keep `main` deployable, and delete `prompt.md` in your
last commit. Leave this block of `CLAUDE.md` as it is.

**Nothing here is marked.** No cutoff, no reflection, no `PROCESS.md` entry.
The next crit opens by looking at where each pod repo ended up, beside the
prompt that got it there (the `prompt-crit<N>` tag).

**The agent's own spec tests are `spec/marks.test.ts`.** They encode the brief it was
working to, and they gate the deploy. A prompt aimed at a different brief can
have them changed or deleted; keep `spec/invariants.test.ts` green, since that
one is true of any good site.

Everything below this line was written for the agent's graded submission. Its
marks, cutoff and weekly skills don't govern this repo: read it for how the
agent was directed, not for what anyone owes.

---

# Marks

Rules for working on this app, derived from what README.md argues "good"
means for it. If a change would break one of these, the README needs to
change first --- not the other way around.

- No accounts. Identity is a random id in a first-party cookie, issued on
  first visit. Never add passwords, email, or OAuth --- this app only needs
  to tell two visitors apart, not verify who they are.
- A visitor can withdraw their own notes and replies, never anyone
  else's, checked against the visitor cookie on the server for every
  request. Withdrawal removes the content from storage, leaves a
  placeholder, and keeps other people's replies. There is still no edit
  and no restore (README explains why).
- Escape every piece of user-submitted text before it reaches HTML
  (`escapeHtml` in `src/render.ts`). Never string-interpolate a name or a
  mark's body straight into a template.
- Server-rendered HTML is the interface. The core interaction (post a mark,
  see the wall) has to work with JavaScript off; anything JS adds is
  enhancement, never a requirement.
- One SQLite file on the Fly volume (`node:sqlite`, no native dependency,
  no separate database service) is the only storage. Don't reach for a
  second store or an ORM for a schema this small.
- Build to the brief that's currently open, not ahead of it --- a feature
  built early is one more thing to keep correct while the actual bar goes
  unaddressed. Server logs name visitors by a short hash of their cookie,
  never the cookie itself.
- Keep dependencies to what's load-bearing. `marked` renders README.md at
  `/readme/`, correctly, without hand-rolling markdown parsing; anything
  else new needs the same justification.
