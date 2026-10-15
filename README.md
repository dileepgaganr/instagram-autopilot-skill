# Instagram autopilot skill

Claude skills plus a zero-dependency CLI that take a video from your disk to a published Reel, then
learn from how it did. The CLI checks the video, fixes a copy, picks the time slot and posts it
through Instagram's official API. Everything else is up to you: no account, no content, no
opinions about your niche are baked in.

```
add ─▶ analyze ─▶ approve (into a learned slot) ─▶ scheduler: fix copy ─▶ upload ─▶ publish
                                                          ▲                          │
                              playbook (targets, slots) ◀─ learn ◀─ insights sync ◀──┘
```

| skill | what it does |
| --- | --- |
| `ig-autopilot` | Connect, queue, approve, schedule, diagnose. The control room. |
| `ig-analyze` | Reels specs, aspect, scene cuts, time to first cut, frozen stretches, dead air, loudness. Writes a fixed copy. |
| `ig-learn` | Pulls insights, ranks every post against your own median, correlates timing/length/slot/hook/caption with views and watch-through, and writes the playbook the scheduler applies. |
| `ig-caption` | Writes and lints the caption, and shows the ~125 characters the feed shows before "… more". |

## Install

Plugin:

```
/plugin marketplace add dileepgaganr/instagram-autopilot-skill
/plugin install instagram-autopilot
```

Or clone it and copy `skills/*` into `~/.claude/skills/`. The CLI is `node bin/igap.mjs`. Running
`npm link` once puts `igap` on your PATH.

Requirements: Node 20+, `ffmpeg` and `ffprobe` (`brew install ffmpeg`, `apt install ffmpeg`), and
`gh` if you use the default GitHub-release hosting.

## Connect an account (one time, ~15 minutes)

1. **Professional account.** In the Instagram app: Settings → Account type and tools → switch to
   *Creator* or *Business*. It's free and you can switch back.
2. **Meta app.** At developers.facebook.com, create an app and pick the use case *Manage messaging &
   content on Instagram*. Then open *API setup with Instagram login* → *Add account*, sign in to the
   Instagram account, and click **Generate token**. You can leave the app in development mode. It
   can post to accounts that have a role on the app, which covers your own.
3. **Media hosting.** Instagram downloads the file from a public URL, so the CLI uploads it first.
   - Default: a public GitHub repo's release. Run `gh repo create <you>/<name>-media --public`, add
     one commit (releases need it), then
     `igap config set hosting.repo <you>/<name>-media`. If `gh` has several logins, also run
     `igap config set hosting.gh_user <login>`.
   - Anything else: `igap config set hosting.provider command` and
     `igap config set hosting.command "<upload {file} as {name}, print the https URL>"`. That works
     with rclone, `aws s3 cp`, scp to a web server, and so on.
   - Or give a queue item `media_url:` and skip uploading.
4. Run `igap setup` in your own terminal and paste the token (the input is hidden).
   `igap status` should say *connected*.
5. Run `igap schedule` to install a timer that runs `igap run` every 15 minutes (launchd on macOS;
   it prints cron and systemd lines elsewhere).

Credentials go to the macOS Keychain (service `instagram-autopilot`), or to environment variables
(`IGAP_ACCESS_TOKEN`, `IGAP_USER_ID`), or to `~/.instagram-autopilot/credentials.json` (mode 600)
with `IGAP_CREDENTIALS=file`. Long-lived tokens last 60 days. The scheduler refreshes yours weekly,
so it only dies if nothing runs for two months.

## Daily use

```bash
igap add ~/Videos/clip.mp4 --hook contrarian   # draft; caption goes in the queue file
igap analyze <id>                              # what's wrong, what will be fixed
igap lint <id>                                 # caption check + the feed fold
igap approve <id>                              # next learned slot (or --at "Thu 18:30")
igap list ; igap report                        # what's queued; what's working
```

`approval` is `manual` by default, so nothing posts that you haven't approved.
`igap config set approval auto` schedules every captioned draft automatically. Only turn that on if
you mean it.

## What gets fixed automatically

These fixes go on a copy before upload. The original is never touched.

- Silence before the first sound, and more than 1s of silence at the end. Trims never leave less
  than 3s.
- Loudness, normalised to −14 LUFS (configurable).
- Aspect: anything that isn't 9:16 is fitted into 1080×1920 over a blurred fill. The subject is
  never cropped.
- Frame rate outside 23–60, codecs that aren't H.264/AAC, audio above 48 kHz.
- Length is only trimmed with `tweak --cap`, because a hard cut can land mid-sentence.

## What it learns, and the limits

Each posted item is stored with its timing features, caption features, slot and hook tag. Once it
has 6 posts that are at least 48 hours old, the scheduler rebuilds the playbook on every tick:

- The **outlier multiple** is views ÷ your own median. Raw views mostly measure follower count.
- **Watch-through** is average watch time ÷ length.
- It runs a Spearman correlation of each feature against both, and compares length bands, slots
  and hooks by median multiple.
- It applies only three things on its own: a length target, a limit on still stretches, a
  dead-air limit, plus the posting slots. Each needs a clear signal (|rho| ≥ 0.4) or a bucket with
  2+ posts that beats the median.

Correlation on a dozen posts is a hint, not proof. The report says how confident it is. The best
way to make it useful is to change one thing at a time and tag hooks with `--hook`.

## The fine print

- **Official API only.** Posting uses Instagram's Content Publishing API for professional
  accounts, which is the sanctioned route. Nothing here automates likes, comments, follows or DMs,
  or drives instagram.com in a browser. Those break Instagram's terms and get accounts restricted.
- **Limits.** Instagram allows 100 API posts per 24 hours per account. The scheduler defaults to 1
  a day with a 6-hour gap (`daily_cap`, `min_gap_hours`).
- **Reels specs** are in `lib/analyze.mjs` (`REELS_SPEC`), as Meta's docs stated them in October
  2026. If Instagram changes them, Instagram is right; edit the table.
- **Disclosure** is your job, and the lint can enforce it. If your videos use AI voices or
  generated footage, add the phrase you use to `caption.require_phrases`.

## Commands

`setup · status · add · list · analyze · tweak · lint · approve · unapprove · post · run · sync ·
learn · report · schedule · config · refresh`. Run `igap` with no arguments for usage.

## Tests

`npm test` renders a synthetic video with every common problem in it (16:9, dead air, a hard cut,
a 6s frozen stretch, quiet audio). It checks that analysis finds each one and that the fixed copy
is 1080×1920 at −14 LUFS. Then it runs add → approve → run → post → sync → learn against a mocked
Instagram API.

## License

MIT.
