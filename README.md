# Workn't

A video break in Claude's browser pane while Claude works. It asks first, plays in one place only, and calls you back when you are needed.

Claude 干活的时候，在它的浏览器面板里刷会儿视频。它先问你，全局只开一个，需要你的时候把你叫回来。

> **Status: 0.2.0, a rewrite, not released yet.** It is being tested on the `rewrite` branch. `main` still holds 0.1.1, an early demo with known problems; do not install that one.
>
> **状态：0.2.0 是一次重写，还没有发布。** 正在 `rewrite` 分支上测试。`main` 上仍是 0.1.1，一个问题很多的早期演示版，请不要安装。

[English](#english) · [中文](#中文)

---

## English

### What it does

1. You send Claude a task. Once it has been working for 8 seconds, a line above the prompt asks: `Watch some TikTok?`
2. Say no and nothing happens: nothing loads, nothing plays.
3. Say yes and the feed loads out of sight, then appears in the browser pane, already playing. It is the real Douyin or TikTok site, signed in as you, with the site's own navigation hidden while you are on the feed.
4. When Claude finishes, the video freezes under a card: `Claude is done. Took 2:14.` `Back to work` puts the pane back the way it was. `One more` plays one more clip.
5. If Claude stops to ask you something, or to get your approval, the card says that instead.

Across sessions:

- **One video for all of them.** However many sessions are running, the video is up in one. Others say where it is and offer to bring it over.
- **News from other sessions reaches you.** Another session finishing shows as a small toast; another session waiting on you freezes the video and names the session.
- **A turn nobody typed never invites you.** Background tasks and schedules waking a session do not start anything.

It stops by itself when you are not watching: when you switch tabs, hide the pane, switch sessions, cover the Claude window with another app, or touch nothing for five minutes.

If you leave a break while Claude is still working, it does not ask you again in that turn. The line says the page is still open and offers to resume.

### Install

```
/plugin install worknt --marketplace Cookiezisg/Workn-t
```

Until 0.2.0 is released this installs 0.1.1; see the status note above. To update later, run `/plugin update worknt` and start a new session.

### Requirements

- The Claude desktop app, Code tab. It needs that app's browser pane; in a terminal session it stays asleep.
- Claude Code 2.1.330 or newer. Mods are an early-access feature.
- A Douyin or TikTok account.

### One setting you must change yourself

By default the browser pane forgets your sign-ins when Claude quits, and keeps a separate set per session. Open the pane's **⋯** menu and set **Keep cookies** to **Shared**. Then you sign in once, and every session is signed in. The mod cannot change this for you and never touches your sign-in.

Shared means every session's browser carries your sign-ins. While Workn't is on, it keeps Claude off the video sites (see Privacy). Turn it off and Claude can reach them.

### Settings

Three ways in, one set of settings, applied to every session at once. No restart.

- **The settings pane.** Type `/worknt`. Every setting is a row of buttons with the current choice lit, followed by today's and yesterday's tally and a self-check button.
- **The ⋯ on the video page.** Top right. It shows for a few seconds as a clip starts and again whenever the pointer moves. It holds the two settings you want while watching, sound and live streams, and `Back to work`.
- **Commands**, below.

| Command | What it does |
| --- | --- |
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

### Privacy

- **Claude is kept off the video sites.** While Workn't is on, the model cannot navigate to Douyin or TikTok, and cannot read or control any tab that is on them, whoever opened it. Calls hidden in a batch are checked one by one. Tab titles and addresses on those sites are blanked from what the model is shown. If the guard itself breaks, browser calls are refused, not let through.
- **Stored on your machine only:** your settings, per-day totals (how long Claude worked, how long you watched, how many clips), and a log of state changes and errors. Never what you watched. Never anything about your account.
- **Nothing is sent anywhere.**
- **It does not click for you.** No consent boxes, no dialogs, nothing on the site. One exception, and only if you turn it on: with live streams set to skip, it presses ↓ to move past one.
- **What it hides.** While you are on the feed, the site's top bar and side navigation. Nothing inside a video: labels, author, buttons all stay. Leave the feed, or end the break, and they are back.

### Known limits

- The sites change. The mod recognises the feed by page structure; when it no longer does, it shows the site as it is and says so, rather than a broken layout.
- A site can sign you out on its own (it happened during testing). You are shown the site's own sign-in, and the feed starts by itself afterwards.
- Jumping from the card to another session is not possible; the card names the session.
- Skipping live streams has not been tried on a real live stream yet. If one is not recognised, nothing happens and it plays like any clip.
- The tally covers today and yesterday.
- Tested on macOS only.

### Uninstall

1. `/worknt reset` ends any break, closes the video page, and clears settings, records and logs.
2. `/plugin uninstall worknt`.
3. One folder is left behind, because a mod cannot delete files: `~/.claude/plugins/data/worknt`. Delete it yourself if you want nothing left.

### Development

```bash
claude plugin validate .
claude plugin test .
git config core.hooksPath .githooks   # once: runs both before every commit
```

Changes are listed in `CHANGELOG.md`.

`docs/spec.md` (in Chinese) is the rule book: every behaviour has a numbered rule, and every test names the rule it checks.

- `hooks/core/`: the rules, as pure functions. `report.ts` (what a session is doing), `decide.ts` (what should happen now), `guard.ts`, `page.ts` (the script that runs inside the video page), `sites.ts`, `copy.ts`.
- `hooks/io/`: the browser pane and the shared files.
- `hooks/engine.ts`: ties events and timers to the rules.
- `hooks/register.tsx`: the hooks.

### Not affiliated

Workn't is an independent project, not affiliated with, endorsed by, or sponsored by ByteDance, Douyin, TikTok, or Anthropic. Douyin and TikTok are trademarks of their owners. You use those sites under their own terms.

---

## 中文

### 它做什么

1. 你给 Claude 派个活。它干了 8 秒之后，输入框上方出现一行：`刷会儿抖音？`
2. 点“不用”，什么都不会发生：不加载，不播放。
3. 点“好”，视频流在后台加载，准备好了才出现在浏览器面板里，出现时已经在播。它是真的抖音或 TikTok 网站，登录的是你自己的账号；你在推荐流里的时候，网站自带的导航被藏起来。
4. Claude 跑完，视频定格，出一张卡片：`Claude 跑完了，用时 2:14`。`回去看看` 把面板恢复原样，`再看一条` 再放一条。
5. 如果 Claude 停下来问你问题，或者等你批准，卡片上写的就是那件事。

多个会话之间：

- **全局只有一个视频。** 不管开着几个会话，视频只在一个会话里。其他会话会告诉你它在哪，并可以搬过来。
- **别的会话的事会送到你眼前。** 别的会话跑完了，出一条小提示；别的会话在等你，视频定格并写明是哪个会话。
- **没人发起的回合不会邀请你。** 后台任务回来、定时任务触发，都不会引出任何东西。

你没在看的时候它会自己停：切了标签页、收了面板、换了会话、Claude 窗口被别的应用挡住，或者五分钟没有任何操作。

Claude 还在干活的时候你自己走开了，这个回合里它不会再问你。状态带上写着页面还开着，可以接着刷。

### 安装

```
/plugin install worknt --marketplace Cookiezisg/Workn-t
```

0.2.0 发布之前，这条命令装到的是 0.1.1，见上面的状态说明。以后更新：运行 `/plugin update worknt`，然后新开一个会话。

### 需要什么

- Claude 桌面版的 Code 标签。它依赖桌面版的浏览器面板；在终端会话里它保持休眠。
- Claude Code 2.1.330 或更新。mod 是抢先体验功能。
- 一个抖音或 TikTok 账号。

### 有一个设置必须你自己改

浏览器面板默认在退出 Claude 时忘掉登录，而且每个会话各存一份。打开面板右上角的 **⋯** 菜单，把 **Keep cookies** 改成 **Shared**。之后登录一次，所有会话都是登录状态。这个设置 mod 改不了，mod 也从不接触你的登录。

Shared 意味着所有会话的浏览器都带着你的登录。Workn't 开着的时候，它不让 Claude 碰视频网站（见“隐私”）；关掉之后 Claude 就能访问。

### 设置

三个入口，改的是同一份设置，对所有会话立刻生效，不用重启。

- **设置面板。** 输入 `/worknt`。每个设置是一行按钮，当前的选择亮着；下面是今天和昨天的账单，还有一个自查按钮。
- **视频页上的 ⋯。** 在右上角。视频开始时露面几秒，之后鼠标一动就出现。里面是看的时候会想改的两项，声音和直播，以及 `回去看看`。
- **命令**，见下表。

| 命令 | 作用 |
| --- | --- |
| `/worknt` | 打开设置面板，并显示当前设置 |
| `/worknt on` · `off` | 总开关。关掉后守卫也解除 |
| `/worknt douyin` · `tiktok` | 换片源 |
| `/worknt sound on` · `off` | 声音 |
| `/worknt live show` · `skip` | 推荐流里的直播：照常显示，或者自动划走 |
| `/worknt lang zh` · `en` | 语言 |
| `/worknt delay <秒>` | Claude 干多久之后再问 |
| `/worknt idle <分钟>` | 多久没动算走开 |
| `/worknt quiet` · `quiet off` | 今天别问 |
| `/worknt here off` · `here on` | 在当前项目里不出现 |
| `/worknt bill` | 今天和昨天的账单 |
| `/worknt doctor` | 它不对劲的时候，看它自己认为发生了什么 |
| `/worknt reset` | 清空设置、记录和日志 |

### 隐私

- **Claude 碰不到视频网站。** Workn't 开着时，模型不能导航到抖音或 TikTok，也不能读取或操作任何处在这两个网站上的标签页，不管是谁打开的。藏在批量操作里的调用逐个检查。给模型看的内容里，这些标签页的标题和地址会被抹掉。守卫自己出故障时，浏览器操作一律拒绝，不放行。
- **只存在你电脑上的：** 你的设置、每天的合计（Claude 干了多久、你看了多久、几条）、状态变化和错误的日志。不存你看了什么，不存任何账号信息。
- **不向任何地方发送任何东西。**
- **不替你点任何东西。** 同意框、弹窗、网站上的任何按钮都不点。只有一个例外，而且要你自己打开：直播设成“划走”之后，它会替你按 ↓ 把直播划过去。
- **它藏了什么。** 你在推荐流里的时候，网站的顶栏和侧边导航。视频里面的东西一样不动：标签、作者、按钮都在。离开推荐流或者结束摸鱼，藏起来的立刻回来。

### 已知的限制

- 网站会改版。mod 靠页面结构认出推荐流；认不出时会原样显示网站并告诉你，而不是给你一个坏掉的布局。
- 网站可能单方面让你的登录失效（测试中发生过）。这时显示的是网站自己的登录界面，登录后自动开始。
- 没法从卡片直接跳到另一个会话，卡片上会写明是哪个。
- “直播划走”还没在真的直播上试过。认不出来的时候什么都不会发生，直播像普通视频一样播。
- 账单只有今天和昨天。
- 只在 macOS 上测试过。

### 卸载

1. `/worknt reset`：结束摸鱼，关闭视频页，清空设置、记录和日志。
2. `/plugin uninstall worknt`。
3. 会留下一个文件夹，因为 mod 删不了文件：`~/.claude/plugins/data/worknt`。想一点不留，自己删掉它。

### 开发

`docs/spec.md` 是规则书：每个行为有一条带编号的规则，每个测试写明它检查的是哪条。改动记在 `CHANGELOG.md`。

### 声明

Workn't 是独立项目，与字节跳动、抖音、TikTok、Anthropic 均无关联，也未获其认可或赞助。抖音和 TikTok 是其各自所有者的商标。使用这些网站须遵守它们自己的条款。
