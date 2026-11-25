# Workn't

Short videos in Claude's browser pane while Claude works. The moment Claude is done, the video freezes and a card tells you to go back.

Claude 干活的时候，在它的浏览器面板里刷短视频。Claude 一跑完，视频定格，卡片叫你回去。

[English](#english) · [中文](#中文)

---

## English

### What it does

1. You send Claude a task.
2. After 8 seconds, or as soon as Claude calls its first tool, the browser pane opens your feed and starts playing. Quick questions never trigger it.
3. A line above the prompt keeps count: `Working · you have slacked 1:42 · 5 clips`.
4. When Claude finishes, the video freezes under a card: `Claude is done. Took 2:14. You watched 5 clips.`
5. `Back to work` puts the pane back the way it was. `One more` plays one more clip, then freezes again.
6. If Claude stops to ask for your approval, the feed freezes for that too.

The feed is the real Douyin or TikTok website, signed in as you, with the site's own navigation hidden so the video fills the pane.

### Requirements

- The Claude desktop app, in the Code tab. The feed lives in that app's browser pane; a terminal session has no pane, so the mod does nothing there.
- Claude Code 2.1.330 or newer. Mods are an early-access feature and may change between releases.
- A Douyin or TikTok account. Without signing in, TikTok shows only a few clips and Douyin will not open its feed.

### Install

From a terminal:

```bash
claude plugin install worknt --marketplace Cookiezisg/Workn-t
```

Or at the prompt of a terminal session:

```
/plugin install worknt --marketplace Cookiezisg/Workn-t
```

In the desktop app, where `/plugin` does not run: click **+** next to the prompt box, then **Plugins**, **Add marketplace** with `Cookiezisg/Workn-t`, then **Add plugin**.

Answer `y` to add the marketplace and choose the user scope. The install screen asks for three settings; the defaults are fine.

### First run

The first time the feed comes up, it shows a note asking you to sign in. Do that in the pane yourself. Both sites usually ask for a second verification step (a text message, an email code, a slider). The mod never sees or handles your sign-in; the session stays in the browser pane's own profile, and you only do this once.

### Commands

| Command | What it does |
| --- | --- |
| `/worknt` | Shows whether it is on, the source and the delay |
| `/worknt on` · `/worknt off` | Turns it on or off |
| `/worknt douyin` · `/worknt tiktok` | Switches the source |
| `/worknt bill` | Today's and all-time tally |
| `/worknt boss` | Replaces the feed with a page of test output |
| `/worknt show` | Brings the feed up now |

The line above the prompt also has `Boss` and `Hide` buttons. `Hide` removes the line for the rest of the day.

### Settings

Set at install, and later in the settings menu under the mod's name.

| Setting | Default | Meaning |
| --- | --- | --- |
| Source | `auto` | `douyin`, `tiktok`, or `auto`: Douyin when the system language is Chinese, TikTok otherwise |
| Delay before it appears | `8` | Seconds. A turn shorter than this never brings the feed up, unless Claude calls a tool first |
| Language | `auto` | `zh`, `en`, or `auto` to follow the system |

### Privacy

- **Claude cannot see your feed.** Any browser call the model aims at the feed's tab is refused, including calls hidden inside a batch. A call that names no tab would land on whatever tab is in front, so the mod fronts a different tab first. If the guard itself fails, browser calls are refused rather than let through.
- The guard covers the tab the mod opened. A Douyin or TikTok tab you open by hand in the same pane is an ordinary tab.
- **What is stored**, on your machine only: whether the mod is on, your source, and per-day totals of how long Claude worked, how long you watched, and how many clips. Not which clips.
- **Nothing is sent anywhere** by the mod. The only network traffic is the site you are watching.

### Limits

- The sites change their pages. The mod hides their navigation by page structure and element ids, which survives most changes, but a redesign can break the layout until the mod is updated. The feed still plays when that happens; it just looks like the ordinary site.
- If Claude needs the browser during a turn, the feed pauses and gives way, and does not come back until the next turn.
- After `Back to work`, the pane switches back within about a second and a half, not instantly.
- The Douyin feed mixes in live streams. Freezing them has not been tested: the card still covers the stream, but its sound may carry on until you leave it.

### Uninstall

```bash
claude plugin uninstall worknt
```

### Development

```bash
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```

The layout:

- `hooks/register.tsx`: the state machine, the tab guard, the line above the prompt, the command
- `hooks/page.ts`: the script that runs inside the feed page (card, freeze, counters)
- `hooks/sites.ts`: one entry per source, with its feed URL and the CSS that hides the site's navigation
- `hooks/copy.ts`: every word the mod shows, in Chinese and English, written by hand

To add a source, add an entry to `hooks/sites.ts`.

### Not affiliated

Workn't is an independent project. It is not affiliated with, endorsed by, or sponsored by ByteDance, Douyin, TikTok, or Anthropic. Douyin and TikTok are trademarks of their owners. You use those sites under their own terms.

---

## 中文

### 它做什么

1. 你给 Claude 派个活。
2. 过 8 秒，或者 Claude 第一次调用工具时，浏览器面板自己打开你的视频流开始播。随口问一句不会触发。
3. 输入框上方有一行字在记数：`在干活 · 你已摸鱼 1:42 · 5 条`。
4. Claude 跑完，视频定格，出一张卡片：`Claude 跑完了。用时 2:14，你刷了 5 条。`
5. `回去看看` 把面板恢复成原来的样子。`再看一条` 再放一条，放完再次定格。
6. Claude 停下来等你批准时，同样会定格。

视频流就是真的抖音或 TikTok 网站，登录的是你自己的账号，只是把网站自带的导航藏了起来，让视频铺满面板。

### 需要什么

- Claude 桌面版，在 Code 标签里用。视频流放在桌面版的浏览器面板里；终端里的会话没有这个面板，mod 在那里什么也不做。
- Claude Code 2.1.330 或更新。mod 是抢先体验功能，接口可能随版本变化。
- 一个抖音或 TikTok 账号。不登录的话，TikTok 只给几条，抖音进不了推荐流。

### 安装

在终端里：

```bash
claude plugin install worknt --marketplace Cookiezisg/Workn-t
```

或者在终端会话的输入框里：

```
/plugin install worknt --marketplace Cookiezisg/Workn-t
```

桌面版里 `/plugin` 用不了：点输入框旁边的 **+**，选 **Plugins**，**Add marketplace** 填 `Cookiezisg/Workn-t`，再点 **Add plugin**。

提示添加市场时答 `y`，范围选用户级。安装界面会问三个设置，用默认值就行。

### 第一次用

视频流第一次出场时，会有一行提示请你登录。请在面板里自己登录。两家通常都会要求二次验证（短信、邮箱验证码、滑块）。mod 不接触也看不到你的登录过程；登录状态保存在浏览器面板自己的配置里，只需要做一次。

### 命令

| 命令 | 作用 |
| --- | --- |
| `/worknt` | 显示是否开启、片源和延迟 |
| `/worknt on` · `/worknt off` | 开或关 |
| `/worknt douyin` · `/worknt tiktok` | 切换片源 |
| `/worknt bill` | 今天和累计的账单 |
| `/worknt boss` | 把视频流换成一页测试输出 |
| `/worknt show` | 现在就出场 |

输入框上方那一行还有 `老板来了` 和 `收起` 两个按钮。`收起` 之后当天不再显示这一行。

### 设置

安装时设置，之后可以在设置菜单里这个 mod 的名字下修改。

| 设置 | 默认 | 含义 |
| --- | --- | --- |
| Source | `auto` | `douyin`、`tiktok` 或 `auto`：系统语言是中文用抖音，否则用 TikTok |
| Delay before it appears | `8` | 秒数。比它短的回合不会出场，除非 Claude 先调用了工具 |
| Language | `auto` | `zh`、`en`，或 `auto` 跟随系统 |

### 隐私

- **Claude 看不到你的视频流。** 模型对视频流标签页的任何浏览器操作都会被拒绝，藏在批量操作里的也一样。没有指定标签页的操作会落在前台标签页上，所以 mod 会先把前台换成别的标签页。守卫自己出故障时，浏览器操作一律拒绝，不会放行。
- 守卫保护的是 mod 自己打开的那个标签页。你在同一个面板里手动打开的抖音或 TikTok 标签页，只是普通标签页。
- **保存的内容**只在你的电脑上：是否开启、片源，以及每天的合计：Claude 干了多久、你看了多久、刷了几条。不记录看了什么。
- mod 本身**不向任何地方发送数据**。唯一的网络流量是你正在看的那个网站。

### 限制

- 网站会改版。mod 是按页面结构和元素 id 来隐藏导航的，多数改动不受影响，但大改版可能让布局失效，直到 mod 更新。失效时视频照样能播，只是看起来是普通的网站。
- 如果某个回合里 Claude 自己要用浏览器，视频流会暂停让位，到下一个回合才会再出场。
- 点 `回去看看` 之后，面板大约一秒半内切回，不是瞬间。
- 抖音推荐流里混有直播。直播的定格还没有测试过：卡片仍然会盖住它，但在你离开直播间之前可能还有声音。

### 卸载

```bash
claude plugin uninstall worknt
```

### 声明

Workn't 是独立项目，与字节跳动、抖音、TikTok、Anthropic 均无关联，也未获其认可或赞助。抖音和 TikTok 是其各自所有者的商标。使用这些网站须遵守它们自己的条款。
