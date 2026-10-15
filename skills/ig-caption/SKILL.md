---
name: ig-caption
description: >-
  Write and lint the caption for a queued Instagram post - the first line that survives the
  "... more" fold, one ask, plain words, at most five hashtags - in the user's own voice. Use when a
  queue item has no caption, when the user says "caption this", or when `igap lint` reports problems.
---

# ig-caption

The caption is the text under the frontmatter in the item's queue file
(`~/.instagram-autopilot/queue/<id>.md`). Edit it there, then `igap lint <id>`.

1. Ask what the video shows and the one thing a viewer should do next, if the user has not said.
   Use only facts the user gave you.
2. **Line one carries the post.** The feed shows about 125 characters. For a Reel that already hooks
   in the video, line one is context plus the ask; for an image or carousel, line one is the hook.
3. One ask. Links are not clickable in captions, so say "link in bio".
4. Hashtags: 0–3 specific ones beat 5 generic ones; the hard cap is `caption.max_hashtags`.
5. If the account uses AI voices or generated footage, say so in the caption; put the phrase in
   `caption.require_phrases` so the lint enforces it.
6. Run `igap lint <id>` and fix every ERROR. Read the WARN lines and fix the ones that matter.

Write like a person talking to one viewer: contractions, concrete nouns, no stock phrases
(the lint lists the common ones).
