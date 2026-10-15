---
name: ig-autopilot
description: >-
  Run an Instagram account's posting on autopilot through the official Instagram API - connect the
  account, queue videos and images, approve them into learned time slots, and let a scheduler check,
  fix, upload and publish them. Use when the user says "post this to Instagram", "schedule my reels",
  "set up instagram autopilot", "what's queued", "why didn't it post", or wants hands-off posting.
---

# ig-autopilot

Everything runs through one CLI. In a plugin install it is `node "${CLAUDE_PLUGIN_ROOT}/cli/igap.mjs"`;
in a clone it is `node <repo>/cli/igap.mjs` (or `npm link` once and call `igap`). Below, `igap` means
whichever applies. Data lives in `~/.instagram-autopilot/` (override with `IGAP_HOME`).

## First run

1. `igap status`. If the account is not connected, walk the user through the README's
   "Connect an account" section. The token is something only they can generate; never
   ask them to paste it into chat. Have them run `igap setup` in their own terminal, where the input
   is hidden.
2. Hosting: Instagram downloads media from a public URL. Default is a public GitHub repo's release
   (`igap config set hosting.repo owner/name`; uploads run as the active `gh` account, which needs write access).
   Any other uploader works through `hosting.provider command` (see README).
3. `igap config set timezone <IANA zone>` if the machine's zone is not the audience's.

## The loop

```
igap add <video> --hook <formula-tag>      # draft; write the caption into the queue file
igap analyze <id>                          # specs, timing, what will be fixed (see ig-analyze)
igap lint <id>                             # caption check + the 125 characters the feed shows
igap approve <id> [--at "Tue 12:00"]       # books the next learned slot unless a time is given
igap schedule                              # once: a timer runs `igap run` every 15 min
```

Each `run` tick: refreshes the token when due, pulls insights for recent posts, re-learns the
playbook, then posts at most one due item: analyze → auto-fix a copy (silence, black open, loudness,
9:16 frame, codecs) → caption lint → upload → publish → record features + tweaks in the ledger.

## Rules you keep

- **Approval is the user's.** `approval: manual` (default) means nothing posts until `igap approve`.
  Only set `approval auto` when the user explicitly asks for it, and say what it means: every draft
  with a caption gets scheduled and posted without another look.
- Only the post itself is automated. Never automate likes, comments, follows or DMs, and never use
  browser automation against instagram.com. Both break Instagram's terms and get accounts restricted.
- Never invent numbers, testimonials or results in captions. If a caption needs a figure the user
  has not given, leave `{{number}}` and tell them.
- A `blocked` item says why in `blocked_reason`. Content problems (video can't be posted, caption
  errors) need a fix and `igap unapprove` + `approve`; network failures retry 3 times on their own.

## Diagnosing "it didn't post"

`igap status`, `igap list`, then the tail of `~/.instagram-autopilot/autopilot.log`. Idle reasons
are logged verbatim: daily cap, minimum gap, nothing due, quota used up.
