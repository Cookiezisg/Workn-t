# Changelog

## 0.2.0 (not released)

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
