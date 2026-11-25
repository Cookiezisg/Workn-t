# Changelog

## 0.2.2 (not released)

A full check of 0.2.1: four independent reviews, random-order tests with failing outside calls, and deliberately broken code to see what the tests miss. Everything below was found that way, and each has a test now.

**You would have run into these**

- After pressing `Back to the feed` once, the next press on the page (for example `Back to work` on the card) did nothing.
- `/worknt go` typed while Claude was working waited for the turn to end.
- With sound off, clips after the first could play aloud.
- A paused clip started again when the site started a neighbouring one; after a swipe the next clip could stay frozen.
- "One more" ran on for minutes with the site's auto-advance on, or came back at once after a swipe.
- Coming back after more than five minutes away got "Still there?" straight away.
- Off the feed (a profile, a live room) nothing called you back, and the line had no `Back to work`.
- The first-use questions stayed on the line for ever if the turn ended first.
- After `/worknt reset`, the next thing counted brought the old tally back.

**Tabs and sessions**

- A break taken by another session while still loading did not let go.
- The person's own tab could be used as the video page when a new one could not be made, and later closed.
- Tabs that were never shown, taken over, or unusable were left open; a kept tab could be forgotten instead of closed.
- A mod reloaded mid-turn forgot the turn was running.
- A wait that ended at once left the session "waiting"; a permission request was ended by any other call of the same tool.

**The guard**

- A browser call is looked at again after it runs. One that ends on a video site by a redirect, a script, or a batch that navigates and then reads no longer gets its result.
- Addresses are read the way the browser reads them (percent-escapes, full-width letters, and so on).
- Every shape of tool answer is scrubbed, not only lists of text.
- The guard stays on while the mod is asleep in a session.
- A call with no tab named, while the video is in front, now tells the model to open its own tab instead of asking the person to switch Workn't off.
- The README now says plainly what the guard is not: a security boundary.

## 0.2.1 (2026-11-26)

- `Leave me alone`. After `One more` and `Last one, really`, the third time the card comes back its button no longer asks for one more clip: it sends the card away for the rest of that round. Clips play on, nothing locks, and the break is not ended for nobody working. The next thing to happen (another turn finishing, a session waiting on you) is a new card and calls you back as before.
- From the second extra clip on, the card keeps count of them.

## 0.2.0 (2026-11-26)

A rewrite. 0.1.x opened the video by itself in every session; 0.2.0 asks first and keeps one video for all sessions.

**How it behaves**

- `/worknt go` starts a break now, without waiting to be asked and whether or not Claude is working.
- It asks before doing anything: a line above the prompt, once Claude has worked for a few seconds. Nothing loads until you say yes.
- One video page for all sessions. Other sessions say where it is and can take it over.
- It calls you back with a card that locks the page: when everything has finished, when a session stops on an error, when a session is waiting for your answer or approval. Another session finishing while others still work is a small toast instead.
- A turn nobody typed (a background task, a schedule) never starts anything.
- It pauses when you are not looking: another tab, a hidden pane, another session, a covered window, five minutes without input.
- Leaving a break mid-turn is not followed by another invitation. The line offers the page that is still open.
- Sign-in, verification and any page that is not the feed are left exactly as the site made them. Once you are signed in, the feed starts by itself.
- The tab is kept, paused, for ten minutes after a break, then closed. A new break on it starts its counts from zero.

**Settings**

- A settings pane (`/worknt`), a small menu on the video page (⋯, top right), and commands. All three change the same settings, for every session at once.
- New settings: sound, language, how long before it asks, how long without input counts as gone, stop asking for today, never in this project, live streams (show or skip).

**Privacy**

- The guard is by site: while Workn't is on, the model cannot open, read or control any tab on the video sites, and their titles and addresses are blanked from what it is shown. A guard that fails refuses.
- Nothing is sent anywhere. Sign-ins are never read or stored.

**When it does not behave**

- `/worknt doctor` says what the mod thinks is going on. A log of state changes and errors is kept per session.

## 0.1.1

- Preloads the feed to shorten the first start.

## 0.1.0

- First version: Douyin or TikTok in the browser pane while Claude works, a card when it is done.
