# Privacy policy: Reelpilot

Last updated: 2026-10-14

Reelpilot is open-source software that runs on your own computer. The author operates no server,
collects no data, and receives nothing from your use of it.

## What the software handles

- **Your Instagram access token and account id.** You generate the token in your own Meta developer
  app and enter it with `igap setup`. It is stored in your macOS Keychain, or in
  `~/.instagram-autopilot/credentials.json` with owner-only permissions. It is sent only to Meta's Instagram API (`graph.instagram.com`).
- **Your media and captions.** Files you queue are analyzed locally with ffmpeg. When an item
  posts, the file is uploaded to the host you configured (a release in your own GitHub repository,
  or your own upload command) so Instagram can fetch it, and the caption is sent to Instagram.
  Files on a public host can be seen by anyone with the URL. Delete them there when you no longer
  want them public.
- **Your posts' performance.** View, reach, interaction and watch-time numbers for your own posts
  are fetched from Instagram and stored locally in `~/.instagram-autopilot/ledger.jsonl` to build
  your playbook.

## Retention and deletion

Everything Reelpilot stores is in `~/.instagram-autopilot/` and, for credentials, your Keychain
service `instagram-autopilot`. Delete that folder and those Keychain items to remove it all. Data
held by Meta or your media host is governed by their policies:
[Meta Privacy Policy](https://www.facebook.com/privacy/policy/),
[GitHub Privacy Statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).

## Contact

https://github.com/dileepgaganr/instagram-autopilot-skill/issues
