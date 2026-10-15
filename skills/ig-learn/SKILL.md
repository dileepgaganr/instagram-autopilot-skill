---
name: ig-learn
description: >-
  Learn from what an Instagram account already posted - pull insights through the API, compare each
  post with the account's own median, correlate views and watch-through with video timing, length,
  posting slot, hook and caption, and turn that into a playbook the autopilot applies. Use when the
  user asks "what's working", "why did this flop", "when should I post", "what should I change",
  or wants a performance report.
---

# ig-learn

```
igap sync               # pull insights for posts younger than 7 days
igap learn              # rebuild ~/.instagram-autopilot/playbook.json and print it
igap report             # print the last playbook + recent posts
```

The scheduler runs sync + learn on every tick, so this is mostly for reading and explaining.

## How it decides

- **Outlier multiple** = a post's views ÷ the account's own median. Raw views mostly measure follower
  count; the multiple measures the post.
- **Watch-through** = average watch time ÷ video length (Reels only).
- Numeric features (length, first cut, longest still, lead silence, loudness, caption length,
  hashtags, hour) are rank-correlated (Spearman) with both. |rho| ≥ 0.4 is reported as a signal.
- Buckets: length band, weekday+hour slot, and the `hook` tag set on each item.
- Confidence: `collecting` below `learn.min_posts` (6) settled posts, then low < 12, medium < 30, high.
  Nothing is applied while collecting.

What it changes on its own: `target_max_s` (best length band, if it beats the median by 20% with 2+
posts), `max_shot_s` (when still stretches hurt), `max_lead_silence_s` (when dead air hurts), and the
posting slots. Everything else is advice for the user.

## Talking about results

Be honest about sample size: 8 posts is a hint, not proof. Recommend changing one thing at a time
(tag hooks with `--hook` so they can be compared) and say which signal a recommendation rests on.
A post with a high multiple and low watch-through had a good hook and a weak middle; the reverse
had a weak hook. Point at the specific timing feature when you can.
