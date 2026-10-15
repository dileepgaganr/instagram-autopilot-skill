---
name: ig-analyze
description: >-
  Analyze a short-form video before it goes to Instagram - Reels specs, aspect, scene cuts and the
  time to the first cut, frozen stretches, dead air at the start and end, loudness - and produce a
  fixed copy. Use when the user asks "is this video ready", "check my reel", "why does this lose
  people", "fix the audio/aspect", or before approving any video.
---

# ig-analyze

```
igap analyze <file|id>          # human report
igap analyze <file|id> --json   # everything, for reasoning
igap tweak <file|id> [--cap]    # writes ~/.instagram-autopilot/media/tweaked/<name>.ig.mp4
```

Needs `ffmpeg` and `ffprobe` on PATH. The original file is never modified.

## Reading the report

| line | meaning | what to do |
| --- | --- | --- |
| ERROR | Instagram will reject it (too short/long, wrong container) | re-export; autopilot blocks it |
| FIX | autopilot fixes it on a copy before posting | nothing, or run `tweak` to preview |
| WARN | needs judgement, not a filter | tell the user plainly; suggest an edit |

The timing features, and why they matter:

- **first_cut_s** — the first visual change. The hook window is about three seconds; a first cut at
  5s on talking-head footage usually means the opening runs long.
- **longest_frozen_s** — the longest stretch where the picture does not change. Static stretches are
  where viewers swipe. Motion-graphics videos often have zero hard cuts and that is fine; this is the
  number that matters for them.
- **lead_silence_s / tail_silence_s** — dead air. The tweak trims both (never below 3s total).
- **lufs** — integrated loudness. Instagram plays loud; -14 LUFS is the usual target.
- **sound_coverage** — share of the clip above -35 dB. Near zero means music-free or broken audio.

`--cap` trims the end to `video.target_max_s`. It can cut mid-sentence, so only use it when the user
agrees, and listen to the result first.

Learned targets (from ig-learn) override the defaults once there is enough data; `igap config` shows
the defaults, `igap report` shows what the playbook changed.
