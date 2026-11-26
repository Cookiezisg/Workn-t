<img src=".claude-plugin/icon.png" width="72" alt="">

# Workn't

A video break in Claude's browser pane while Claude works. It asks first, plays in one place only, and calls you back when you are needed.

English · [简体中文](README.zh-CN.md)

Workn't is a mod for [Claude Code](https://claude.com/claude-code), for the Claude desktop app. It plays the real Douyin or TikTok site, signed in as you. It never touches your sign-in, and it sends nothing anywhere.

## What it does

1. You send Claude a task. Once it has been working for 8 seconds, a line above the prompt asks: `Watch some TikTok?`
2. Say no and nothing happens: nothing loads, nothing plays.
3. Say yes and the feed loads out of sight, then appears in the browser pane, already playing. The site's own navigation is hidden while you are on the feed.
4. When Claude finishes, the video freezes under a card: `Claude is done. Took 2:14.` `Back to work` puts the pane back the way it was. `One more` plays one more clip, twice; the third time the button says `Leave me alone`, and the card stays away for the rest of that round.
5. If Claude stops to ask you something, or to get your approval, the card says that instead.

You do not have to wait to be asked: `/worknt go` starts a break now, whether or not Claude is working.

Across sessions:

- **One video for all of them.** However many sessions are running, the video is up in one. Others say where it is and offer to bring it over.
- **News from other sessions reaches you.** Another session finishing shows as a small toast; another session waiting on you freezes the video and names the session.
- **A turn nobody typed never invites you.** Background tasks and schedules waking a session do not start anything.

It stops by itself when you are not watching: when you switch tabs, hide the pane, switch sessions, cover the Claude window with another app, or touch nothing for five minutes.

If you leave a break while Claude is still working, it does not ask you again in that turn. The line says the page is still open and offers to resume.

## Requirements

- The Claude desktop app, Code tab. Workn't needs that app's browser pane; in a terminal session it stays asleep.
- Claude Code 2.1.330 or newer. Mods are an early-access feature.
- A Douyin or TikTok account.
- macOS. It has not been tried anywhere else.

## Install

In a terminal:

```bash
claude plugin marketplace add Cookiezisg/Workn-t
claude plugin install worknt@worknt
```

Then start a new session in the desktop app.

If you use Claude Code in a terminal, one line at its prompt does the same: `/plugin install worknt --marketplace Cookiezisg/Workn-t`.

To update later:

```bash
claude plugin marketplace update worknt
claude plugin update worknt@worknt
```

Then start a new session. What changed is in [CHANGELOG.md](CHANGELOG.md).

## First run

1. **Change one setting yourself.** By default the browser pane forgets your sign-ins when Claude quits, and keeps a separate set per session. Open the pane's **⋯** menu and set **Keep cookies** to **Shared**. The mod cannot change this for you.
2. **Start a break.** Send Claude a task and say yes when asked, or type `/worknt go`. The first time, it asks for a language, a source and sound.
3. **Sign in.** The site shows its own sign-in in the pane. Sign in there yourself; the feed starts by itself afterwards. With Shared, you do this once for all sessions.

Shared means every session's browser carries your sign-ins. While Workn't is on, it keeps Claude off the video sites (see [Privacy](#privacy)). Turn it off and Claude can reach them.

## Settings

Three ways in, one set of settings, applied to every session at once. No restart.

- **The settings pane.** Type `/worknt`. Every setting is a row of buttons with the current choice lit, followed by today's and yesterday's tally and a self-check button.
- **The ⋯ on the video page.** Top right. It shows for a few seconds as a clip starts and again whenever the pointer moves. It holds the two settings you want while watching, sound and live streams, and `Back to work`.
- **Commands**, below.

| Command | What it does |
| --- | --- |
| `/worknt go` | Start a break now, without waiting to be asked, whether or not Claude is working |
| `/worknt` | Opens the settings pane and shows the current settings |
| `/worknt on` · `off` | The main switch. Off also lifts the guard |
| `/worknt douyin` · `tiktok` | Source |
| `/worknt sound on` · `off` | Sound |
| `/worknt live show` · `skip` | Live streams in the feed: leave them, or move past them |
| `/worknt lang zh` · `en` | Language |
| `/worknt delay <seconds>` | How long Claude works before it asks |
| `/worknt idle <minutes>` | How long without input counts as gone |
| `/worknt quiet` · `quiet off` | Stop asking for today |
| `/worknt here off` · `here on` | Never show up in this project |
| `/worknt bill` | Today's and yesterday's tally |
| `/worknt doctor` | What the mod thinks is going on, for when it does not behave |
| `/worknt reset` | Clears settings, records and logs |

## Privacy

- **Claude is kept off the video sites.** While Workn't is on, the model's browser calls are refused if they name Douyin or TikTok or aim at a tab that is on them, whoever opened it. Every call is looked at again after it has run: if it ended on one of those sites by a road it did not name (a redirect, a script, a batch that navigates and then reads), its result is withheld. Tab titles and addresses on those sites are blanked from what the model is shown. If the guard itself breaks, browser calls are refused, not let through.
- **It is a railing, not a vault.** The guard stops Claude from wandering onto your video site, or being led there by a web page. It is not a security boundary: a model that can run commands could in principle change Workn't's own settings file, as it could read any file on your disk. Real isolation is what Claude's own permission settings are for.
- **Stored on your machine only:** your settings, per-day totals (how long Claude worked, how long you watched, how many clips), and a log of state changes and errors. Never what you watched. Never anything about your account.
- **Nothing is sent anywhere.**
- **It does not click for you.** No consent boxes, no dialogs, nothing on the site. One exception, and only if you turn it on: with live streams set to skip, it presses ↓ to move past one.
- **What it hides.** While you are on the feed, the site's top bar and side navigation. Nothing inside a video: labels, author, buttons all stay. Leave the feed, or end the break, and they are back.

## Known limits

- The sites change. The mod recognises the feed by page structure; when it no longer does, it shows the site as it is and says so, rather than a broken layout.
- A site can sign you out on its own (it happened during testing). You are shown the site's own sign-in, and the feed starts by itself afterwards.
- Jumping from the card to another session is not possible; the card names the session.
- Skipping live streams has been seen working on Douyin. On TikTok nobody has watched it happen. A live stream that is not recognised plays like any clip.
- The settings pane takes the browser pane's place while it is open, so the video pauses until you switch back.
- A browser pane opened by a local dev-server preview keeps its own sign-ins, apart from the shared ones. In such a pane the site shows as signed out.
- The tally covers today and yesterday.

## When it does not behave

Run `/worknt doctor`. It prints what the mod thinks is going on: whether it is awake, what each session is doing, where the break stands, and recent errors.

If that does not explain it, [open an issue](https://github.com/Cookiezisg/Workn-t/issues/new/choose) with that output and what you did. The last line of the output is a file path with your user name in it; cut it if you would rather not post that.

## Uninstall

1. `/worknt reset` ends any break, closes the video page, and clears settings, records and logs.
2. In a terminal: `claude plugin uninstall worknt@worknt`.
3. One folder is left behind, because a mod cannot delete files: `~/.claude/plugins/data/worknt`. Delete it yourself if you want nothing left.

## Development

```bash
claude plugin validate .
claude plugin test .
git config core.hooksPath .githooks   # once: runs both before every commit
```

Where things are:

- `hooks/core/`: the rules, as pure functions. `report.ts` (what a session is doing), `decide.ts` (what should happen now), `guard.ts`, `page.ts` (the script that runs inside the video page), `sites.ts`, `copy.ts`.
- `hooks/io/`: the browser pane and the shared files.
- `hooks/engine.ts`: ties events and timers to the rules.
- `hooks/register.tsx`: the hooks, the line above the prompt, the settings pane.
- `types/index.d.ts`: the shapes the mod keeps in the session's state.

The documents are in Chinese:

- [docs/spec.md](docs/spec.md) is the rule book. Every behaviour has a numbered rule, and every test names the rule it checks.
- [docs/audit-0.2.2.md](docs/audit-0.2.2.md) records the check done before 0.2.2: how it was done, what it found, what it left.
- [docs/walkthrough.md](docs/walkthrough.md) is the checklist for what only a person at a real desktop can verify.

## Not affiliated

Workn't is an independent project, not affiliated with, endorsed by, or sponsored by ByteDance, Douyin, TikTok, or Anthropic. Douyin and TikTok are trademarks of their owners. You use those sites under their own terms.

[MIT](LICENSE)
