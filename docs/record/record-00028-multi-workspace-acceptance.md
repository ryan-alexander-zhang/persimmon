---
id: record-00028-multi-workspace-acceptance
type: record
status: active
parent: plan-00027-multi-workspace
verifies: [spec-00011-multi-workspace]
---

# 验收记录：多 workspace

对 [plan-00027-multi-workspace](../plan/plan-00027-multi-workspace.md) 的验收。
交付范围为 `spec-00011` 全部 21 条 FR 的 87 条 AC；无范围外一并验收的条目——
`spec-00011` §6 的十三项、`npm publish` 本身、`ainpt` 模板仓库的 `post_create`
登记步骤均在本 plan 的 Out of Scope 内。T1（十份既有文档的第二十八轮修订轮）、
T2（代码提到仓库根）、T3…T10（注册表、可用性、`Board` 开缝、Host 层、CLI、
前端参数化、切换器、跨 workspace 通知）分段落地，本记录是 T11 的收口。测试
路径相对仓库根。

**本轮验收通过，经一次不通过**：第一次安装形态实测（2026-09-07 上午）
`spec-00011-AC-20.1` 与 `AC-20.2` 两条 fail——发出的包把 `src/*.ts` 直接装进
`node_modules`，Node 拒绝对 `node_modules` 下的 `.ts` 剥类型，两种形态的
`persimmon list` 都崩在第一条 import 上。按 AGENTS §8 先立案
[issue-00029](../issue/issue-00029-a-shipped-ts-source-cannot-run-from-node-modules.md)
（根因、复现、修法），修法（构建期把 `src/` 编到 `lib/`、`files` 发 `lib/`）
以 `2e6ba63` 落地后重跑实测，两种形态皆过；两条随之为 pass，`spec-00011` §7
「AC-20.2 在实测通过前不计已验证」的门放行。同轮里全量测试偶发的一例失败
被查明不是 PTY 时序而是
[issue-00028](../issue/issue-00028-a-wildcard-bind-lets-a-loopback-squatter-answer-the-tests.md)
（`listen(port)` 绑通配地址而测试拨 `127.0.0.1`，本机回环占位者应答了测试），
以 `2c75f93` 修复并折入两条守卫。实测顺带发现的
[issue-00030](../issue/issue-00030-npx-leaves-the-pty-spawn-helper-non-executable.md)
（`npx` 形态下 `spawn-helper` 无可执行位）不影响本 plan 范围内任何 AC，已立案
`open`，是否并入由域主定。87 条全部 pass。

## 质量门

命令均在仓库根执行：

- `npm test`：退出码 0，71 个文件、2075 个测试全部通过（两次整体运行一致；含 issue-00028 的两条守卫、issue-00029 的分发守卫 `test/distribution.test.ts`、issue-00031 的两条活连接关停守卫）。
- `npm run typecheck`：退出码 0，`tsc --noEmit` 无输出。
- `npx vitest run --coverage --coverage.reportsDirectory=<仓外临时目录>`：
  退出码 0，statements 98.63%（5128/5199）/ branches 95.29%（2918/3062）/
  functions 98.67%（1560/1581）/ lines 99.36%（4409/4437）。
  `vitest.config.ts` 只对 lines / branches / functions 设 90 门槛，三项皆过，
  statements 一并列出仅作参考；阈值与排除项一字未改，无被压制的发现。报告
  目录指到仓外临时目录，不在工作树留产物。
- `npm run build`：退出码 0（附带的 chunk 大小提示是既有的，非错误）。

在 issue-00028 修复之前，全量运行约每八次有一次在 `test/server.test.ts`
的某条会话用例上失败、单跑必过；根因是通配地址绑定被本机回环占位者抢答，
不是 PTY 时序（issue-00028 §3 实测）。修复后两次整体运行、一次覆盖率运行均
无失败。

## 回归约束（`spec-00011` §7）

`spec-00001` … `spec-00010` 的既有验收就是这套全量测试：71 个文件全绿，
2075 条无一失败，`spec-00011` §1 交接列出的改写项之外无一条断言被改动。本轮
对既有测试文件的改动有两类：溯源注释的写法（把同注释续写的 AC id 补成全
id），以及 issue-00028 的修复（`listen()` 传 `'127.0.0.1'`、端口在 `listening`
之后读取——绑定地址与读端口时机，不改任何断言的期望值）。

## 安装形态实测（`spec-00011` §7 的验证义务，plan §Detailed Acceptance Path 第 7 项）

### 第一次（2026-09-07，issue-00029 修复前）——不通过

全部在仓外临时目录，`HOME` 指向临时目录。命令与结果：

1. `npm pack --pack-destination <scratch>`（`prepack` 跑 `npm run build`）→
   退出码 0，`ryan-alexander-zhang-persimmon-0.1.0.tgz`，132 个文件 / 1.6 MB。
   内容核对通过：`bin/persimmon.js`、`src/`（29 份 `.ts`）、`dist/web/index.html`
   （连 `dist/web/assets/` 共 97 份）、`scripts/fix-pty-permissions.js` 与
   `scripts/sync-docs.sh`、`package.json`、`README.md`、`LICENSE`。`dist/` 下
   除 `dist/web/` 外无一文件。
2. `HOME=<scratch>/home npm install -g --prefix <scratch>/prefix <tarball>` →
   退出码 0，`added 449 packages in 27s`。npm 11.17 默认拦 install 脚本，
   `node-pty` 的 `install`/`postinstall` 与本包的 `postinstall` 均被跳过；加
   `--allow-scripts=@ryan-alexander-zhang/persimmon,node-pty` 重装一次后
   `node-pty` 的脚本执行，其原生部分由 `prebuilds/darwin-arm64/` 的预编译件
   满足，未走 `node-gyp`。
3. `cd <scratch>/elsewhere && HOME=<scratch>/home <prefix>/bin/persimmon list`
   → **退出码 1**，无输出，抛：

   ```
   Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is
   currently unsupported for files under node_modules, for
   ".../prefix/lib/node_modules/@ryan-alexander-zhang/persimmon/src/config.ts"
   ```

   两次安装（拦脚本与放行脚本）结果相同，故与 `node-pty` 无关。
4. `cd <scratch>/elsewhere && HOME=<scratch>/home npx --yes --package <tarball>
   -- persimmon list` → **退出码非 0**，同一个
   `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`，路径落在
   `<scratch>/home/.npm/_npx/<hash>/node_modules/@ryan-alexander-zhang/persimmon/src/config.ts`。
   （`npx --yes <tarball> list` 这一写法 npx 会把 tarball 路径当命令执行、报
   `Permission denied`，不是本缺陷；须用 `--package … -- persimmon`。）

两种形态都不成立：`AC-20.1`「命令可执行并输出注册表」与 `AC-20.2`「输出与全局
安装形态相同」皆为 fail。Node 版本 v26.5.0（`engines` 要求 `>=23.6`），
`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 是无条件限制、无开关可绕。
→ 立案 issue-00029。

### 第二次（2026-09-07，`2e6ba63` 之后）——通过

`npm run test:install`（`scripts/test-install.js`，opt-in，需 registry）：
`npm pack` 得 133 个文件 / 1.6 MB，`tar -tf` 断言**无 `package/src/`、无
`*.ts`**；`HOME` 指向同一临时目录，先 `persimmon add <本仓库>` 再 `list`：

- 全局安装形态：`npm install -g --prefix <scratch>/prefix <tarball>` →
  `<prefix>/bin/persimmon list` 输出
  `persimmon  persimmon  /Users/…/persimmon  available`，退出码 0。
- `npx` 形态：`npx --yes --package <tarball> -- persimmon list` 输出同一行，
  退出码 0。脚本比对两行逐字相同（`AC-20.2`）。
  **替身声明**：`AC-20.2` 的 Given 写「包已作为 `@ryan-alexander-zhang/persimmon`
  发布」，实测以本地 tarball 代替已发布的包——`npm publish` 在本 plan 的 Out of
  Scope 内（须域主单独授权）；tarball 与发布物走同一条 `npm pack` 路径、内容
  一致，是发布前能做到的最近替身，但不是发布本身。

编排者在自己的 shell 里独立重跑一次，结果一致。默认套件另有
`test/distribution.test.ts::runs the shipped entry point from under node_modules`（`// issue-00029 · spec-00011-AC-20.1`）
：在临时目录搭一棵伪安装树（`node_modules/@ryan-alexander-zhang/persimmon/`
放 `package.json`、`bin/`、`lib/`、`scripts/`，仓库 `node_modules` 逐项软链为
兄弟）并 spawn 其 `bin/persimmon.js list`，断言退出码 0；修复前布局下同一用例
以 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 红（issue-00029 §5）。

同一次实测另见：`npx` 缓存里 `node-pty` 的 `spawn-helper` 停在 0644（npm 对
缓存安装不跑任何脚本），`list` 不开 pty 故两条 AC 不受影响，但会话会
`posix_spawnp failed`——已立案 issue-00030（`open`），不在本 plan 范围内。

## 手工验证

plan §Detailed Acceptance Path 第 6 项（浏览器内的端到端七项检查）**已执行**，
逐项结论见下文「第 6 项」。受它影响的三条 AC 各已有测试钉住可测的那一半，第 6
项是它们的端到端确认，不是它们唯一的证据：

- `AC-8.2` 的「服务端进程与端口不变」：`test/host.test.ts::serves each
  workspace its own graph` 在同一个 `host.listen(0)` 端口上应答两个
  workspace，`web/test/workspaceSwitch.test.tsx::pushes the new workspace
  address and remembers it` 钉住切换只 `pushState`、页面不重载。
- `AC-8.3` 的「终端完整输出与滚动位置保持」：由替身 xterm 观测实例、缓冲与
  `viewportY`（真 xterm 的呈现只有浏览器里看得到）。
- `AC-11.3` 的「三个标签页」：jsdom 单页内钉住「每个落定点都写一次
  `whiteboard-last-workspace`」这条使「最近一次为准」成立的规则。

### 第 6 项：浏览器端到端（2026-09-07）

真进程、真浏览器（`agent-browser` 驱动的 HeadlessChrome 148），`HOME` 指向仓外
临时目录故注册表为 `<scratch>/home/.persimmon/workspaces.json`，`PORT=4290`；
A 为本仓库，B 为临时目录（`git init` + 本仓库的 `whiteboard.config.yaml` +
一份 `idea-00001-smoke`）。启动握手如约：`node bin/persimmon.js` 打印
`persimmon: http://localhost:4290/w/persimmon`，A 自动登记进注册表。

1. **观察到** —— 打开所打印的地址即得 A 的图（侧栏 idea 4 / spec 11 /
   decision 19 / plan 27 / issue 30 / record 28，画布上是本仓库的节点），顶栏
   最左的切换器按钮文字为 `persimmon`。
2. **观察到** —— 另一 shell 的 `persimmon add <B>` 打印
   `{"id":"wsb","name":"wsb","path":"…/wsB"}` 并以 0 退出；**页面未刷新**，
   切换器里已多出 `wsb` 一行带其路径（即经已运行进程的 API 写入、由 Host 事件
   通道推到界面）。选中 `wsb`：图只剩一个 `idea-00001-smoke`「Smoke idea for
   workspace B」节点、侧栏只剩 `idea 1`，地址栏为
   `http://localhost:4290/w/wsb`，切换器文字为 `wsb`；`lsof -nP -iTCP:4290
   -sTCP:LISTEN` 前后同一行 `node 6292 … TCP 127.0.0.1:4290 (LISTEN)`，
   `pgrep -fl bin/persimmon.js` 只有 6292 一条。
3. **观察到（含真 agent CLI 半边）** —— 切走前在 A 里选中
   `idea-00002-review-nudge` 并起了一个 `clarify` 会话（`claude` 2.1.263 真装、
   配置里的 `agents` 可用；会话 agent 为 `claude-fable`，`/api/sessions` 报
   `status: running`，顶栏计数 1/5）。切到 B（会话面板随呈现状态收起、B 计数
   0/5，A 的 1 running + 1 awaiting 仍在切换器 A 行上显示）再切回 A：
   `idea-00002-review-nudge` 仍是选中项（节点蓝框、侧栏高亮、动作条在位），
   会话面板仍在、状态 `awaiting`，`.xterm` 实例数 1、缓冲逐字相同
   （`1 function greet() { … Syntax theme: Monokai Extended (ctrl+t to
   disable)`）、`.xterm-viewport` 的 `scrollTop/scrollHeight` 切走前后都是
   `0/112`。
4. **本环境不可验证** —— 桌面通知需 Notification 权限，HeadlessChrome 不给：
   经 CDP `Browser.grantPermissions`（origin `http://localhost:4290`，
   `notifications`）返回 `{"result":{}}` 而页面里 `Notification.permission`
   仍为 `"default"`；改按顶栏「Desktop notifications」开关，`permission` 变
   `"denied"`、按钮停在 `off`。故本项不记结论，`AC-17.x` 的证据仍只有
   `web/test/notifyWorkspace.test.tsx`。
5. **观察到** —— `rm -rf <B>` 后重开切换器，`wsb` 行带出
   `workspace directory does not exist: /private/tmp/…/mv6/wsB`；选中该行弹出
   同一句原文的红色提示条，地址栏仍 `http://localhost:4290/w/persimmon`、
   切换器文字仍 `persimmon`、A 的会话面板未动。
6. **观察到** —— 第三个 shell 在 A 内再敲 `persimmon`：打印
   `persimmon: http://localhost:4290/w/persimmon — persimmon 0.1.0 is already
   running` 并以 0 退出，`lsof` 仍是 6292 一个监听者，`pgrep` 仍只一条。
7. **观察到** —— 在 A 上刷新页面：回到 `http://localhost:4290/w/persimmon`
   （URL 未变）、切换器 `persimmon`、A 的图，会话面板重挂上同一会话与同一段
   输出（`localStorage` 的 `whiteboard-last-workspace` 为 `persimmon`）。

### 第 6 项收尾发现的缺陷：浏览器还连着时 SIGINT 不退出

第 6 项收尾的「SIGINT 后数秒内以 0 退出」**未观察到**。最小复现（无会话、
无 workspace B，只要有一个浏览器页开着板）：

1. `HOME=<scratch>/home PORT=4292 node bin/persimmon.js`
2. 浏览器打开 `http://localhost:4292/w/persimmon`（events WebSocket 建立）
3. `kill -INT <pid>`

结果：http 监听立刻关掉（`lsof -nP -iTCP:4292 -sTCP:LISTEN` 无输出），进程却
**不退出**——实测 +15s、+76s 仍在（首轮带会话那次逾 5 分钟）；关掉浏览器的那一
刻立即以 0 退出。同一命令在**没有**浏览器连着时 0 秒内以 0 退出（`wait` 得
`exit code=0`）。

读码定位：`bin/persimmon.js` 的信号处理是
`void host.shutdown().then(() => process.exit(0))`，而 `Host.stop()`
（`src/host.ts`）末尾 `await new Promise((resolve) => { server.close(() =>
resolve()); server.closeIdleConnections() })`。`http.Server.close()` 的回调要
等**全部**连接终结；`closeIdleConnections()` 只关空闲的 keep-alive，已升级的
WebSocket 不算空闲，也没有任何一处去终结它——`Board.close()` 与
`Host.events.close()` 调的都是 `ws` 的 `WebSocketServer.close()`，而 `noServer`
形态下它不持有、也不关闭既有客户端连接。于是 `host.shutdown()` 永不兑现，
`process.exit(0)` 永不执行，进程活到最后一个浏览器页断开为止。

会话收尾本身是好的：本轮那个 clarify 会话在 SIGINT 后写下了
`.whiteboard/sessions/2026-09-07T12-41-46-883Z-1.json`
（`status: terminated`、`exitCode: 129`、`endedAt` 有值）与同名 `.log`，
`git log` 无新 commit、`git status` 与验证前逐字相同（会话起前既已 dirty 的
文件按 `spec-00001-AC-14.2` 被排除在外）。即坏的只有关停的最后一步。

牵连 `AC-16.1`「全部收尾完成后退出」与 `AC-16.2`；两条的既有测试
（`test/host.test.ts::wraps up the running session of every workspace before it
resolves`、`test/startup.test.ts::handles SIGTERM itself instead of being killed
by it`）都跑在没有活 WebSocket 客户端的进程上，故绿。

**处置**：按 AGENTS §8 立案
[issue-00031](../issue/issue-00031-an-upgraded-socket-never-lets-the-shutdown-finish.md)
——根因经实测校正为：Node 在 upgrade 时已把该 socket 从 http server 自己的连接
表里摘掉（`closeIdleConnections()`/`closeAllConnections()` 都够不着它），而
`ws` 的 `noServer` 形态 `close()` 不终结任何客户端；唯一的把手是
`wss.clients`。修法：`Board.close()` 与 `Host.stop()` 在 `close()` 前对每个
活客户端 `terminate()`，共 13 行；先写红测试
`test/boardSeams.test.ts::drops the sockets a live browser is holding` 与
`test/host.test.ts::resolves while a browser still holds its sockets open`
（各持一个活 socket 跨越关停，5 s 上界），修后转绿；端到端复测：浏览器（脚本
持 `/w/persimmon/api/events`）仍连着时 `kill -INT` → **144 ms** 内以 0 退出
（修前 139 s、且只在客户端断开那一刻）。清单中 `AC-16.1`/`AC-16.2` 两行据此
补上这两条守卫。issue-00031 `resolved`。

## 验收清单

| 被验 id | 测试 | 结果 |
| --- | --- | --- |
| spec-00011-AC-1.1 | test/workspaceRegistry.test.ts::reads an absent file as an empty registry + web/test/workspaceSwitcher.test.tsx::invites the first workspace when the registry is empty, switcher and all | pass |
| spec-00011-AC-1.2 | test/workspaceRegistry.test.ts::sees a hand edit on the next read + test/host.test.ts::lists the registry in file order, with no sessions before an instance exists | pass |
| spec-00011-AC-2.1 | test/workspaceRegistry.test.ts::appends one entry with the id derived from the directory name + test/cli.test.ts::registers the given directory and prints the entry | pass |
| spec-00011-AC-2.2 | test/workspaceRegistry.test.ts::numbers a colliding id and keeps both entries | pass |
| spec-00011-AC-2.3 | test/workspaceRegistry.test.ts::returns the existing entry for an already registered path + test/cli.test.ts::adds a registered directory again with the same entry and a zero exit | pass |
| spec-00011-AC-2.4 | test/cli.test.ts::defaults the path to the project the cwd is in | pass |
| spec-00011-AC-2.5 | test/workspaceRegistry.test.ts::collapses a symlinked spelling of a registered path | pass |
| spec-00011-AC-2.6 | test/workspaceRegistry.test.ts::falls back to `workspace` when the directory name derives an empty id | pass |
| spec-00011-AC-2.7 | test/workspaceRegistry.test.ts::keeps the id when the user repoints an entry at a renamed directory | pass |
| spec-00011-AC-3.1 | test/workspaceRegistry.test.ts::refuses a path that does not exist, leaving the registry alone + web/test/workspaceSwitcher.test.tsx::keeps the dialog and what was typed when the add is refused | pass |
| spec-00011-AC-3.2 | test/cli.test.ts::refuses a directory that holds no flow config, naming what is missing + test/workspaceRegistry.test.ts::refuses a directory without a flow config, naming the file it looked for | pass |
| spec-00011-AC-3.3 | test/workspaceRegistry.test.ts::registers a directory whose flow config is invalid | pass |
| spec-00011-AC-3.4 | test/workspaceRegistry.test.ts::registers a directory nested inside another workspace | pass |
| spec-00011-AC-4.1 | test/workspaceRegistry.test.ts::removes the entry named by id and leaves the directory alone + web/test/workspaceSwitcher.test.tsx::drops the entry and refreshes the list | pass |
| spec-00011-AC-4.2 | test/host.test.ts::leaves the workspace’s own files where they are | pass |
| spec-00011-AC-4.3 | web/test/workspaceSwitcher.test.tsx::lands the page on the first available entry when the current one goes | pass |
| spec-00011-AC-4.4 | web/test/workspaceSwitcher.test.tsx::lands on the empty state when the current one was the only entry | pass |
| spec-00011-AC-4.5 | web/test/workspaceSwitcher.test.tsx::skips an unavailable entry when it lands | pass |
| spec-00011-AC-5.1 | test/host.test.ts::answers 409 while the workspace has a running session, and keeps the entry + web/test/workspaceSwitcher.test.tsx::reports a refused removal and keeps the entry | pass |
| spec-00011-AC-5.2 | test/cli.test.ts::reports an id that is not registered and leaves the registry alone + test/workspaceRegistry.test.ts::refuses an id or path that is not registered | pass |
| spec-00011-AC-6.1 | test/workspaceAvailability.test.ts::is missing once its directory is gone + test/host.test.ts::judges every entry, carrying the reason and the sentence that says what to fix | pass |
| spec-00011-AC-6.2 | test/workspaceAvailability.test.ts::is noConfig when the flow config is gone + test/host.test.ts::answers 503 when the flow config is gone | pass |
| spec-00011-AC-6.3 | test/workspaceAvailability.test.ts::is noGit when the directory holds a config but is not a repository + test/host.test.ts::answers 503 when the directory is not a git repository | pass |
| spec-00011-AC-6.4 | test/workspaceAvailability.test.ts::is invalidConfig carrying the very message loadFlowConfig throws + test/host.test.ts::answers 503 carrying the config error when the config is invalid | pass |
| spec-00011-AC-6.5 | test/workspaceAvailability.test.ts::is available again on the next judgement once the config is fixed | pass |
| spec-00011-AC-6.6 | test/workspaceAvailability.test.ts::stays available when its config is made invalid after it was opened + test/host.test.ts::goes on calling an open workspace available after its config is broken | pass |
| spec-00011-AC-6.7 | test/workspaceAvailability.test.ts::stays available when its config is made invalid after it was opened | pass |
| spec-00011-AC-6.8 | test/workspaceAvailability.test.ts::is missing when its directory is deleted | pass |
| spec-00011-AC-7.1 | web/test/workspaceSwitcher.test.tsx::lists every entry in file order, marks the current one and counts its sessions | pass |
| spec-00011-AC-7.2 | web/test/workspaceSwitcher.test.tsx::follows the counts of another workspace while it stays open | pass |
| spec-00011-AC-7.3 | web/test/workspaceSwitcher.test.tsx::lets the keyboard onto an unavailable row and its remove control | pass |
| spec-00011-AC-8.1 | web/test/workspaceSwitch.test.tsx::replaces the graph and the navigation sidebar with the new workspace own + web/test/workspaceSwitcher.test.tsx::makes an available row the current workspace | pass |
| spec-00011-AC-8.2 | web/test/workspaceSwitch.test.tsx::pushes the new workspace address and remembers it + test/host.test.ts::serves each workspace its own graph | pass |
| spec-00011-AC-8.3 | web/test/workspaceSwitch.test.tsx::keeps the instance, its output and its scroll position | pass |
| spec-00011-AC-8.4 | web/test/workspaceSwitch.test.tsx::brings the selection back when the workspace is | pass |
| spec-00011-AC-8.5 | web/test/workspaceSwitch.test.tsx::closes a drilldown whose document was deleted while the user was away + web/test/workspaceSwitch.test.tsx::closes an editor whose document was deleted while the user was away | pass |
| spec-00011-AC-8.6 | web/test/workspaceSwitch.test.tsx::finds only the current workspace documents in the command palette | pass |
| spec-00011-AC-8.7 | web/test/workspaceSwitch.test.tsx::follows the browser back button between two workspaces | pass |
| spec-00011-AC-9.1 | web/test/workspaceSwitcher.test.tsx::refuses an unavailable row with its reason and stays where it is | pass |
| spec-00011-AC-9.2 | web/test/workspaceSwitcher.test.tsx::says an unregistered workspace is not registered, with the switcher in the bar + test/host.test.ts::answers 404 for an id that is not in the registry | pass |
| spec-00011-AC-9.3 | web/test/workspaceSwitcher.test.tsx::says why an unavailable workspace cannot be opened, and reads nothing from it + test/host.test.ts::answers 503 and builds nothing when the directory is gone | pass |
| spec-00011-AC-10.1 | web/test/workspaceSwitch.test.tsx::comes back to the same workspace | pass |
| spec-00011-AC-10.2 | web/test/workspaceSwitch.test.tsx::comes back to the top level, not to the drilldown | pass |
| spec-00011-AC-11.1 | web/test/workspaceSwitch.test.tsx::keeps the expanded type groups of each workspace apart | pass |
| spec-00011-AC-11.2 | web/test/workspaceSwitch.test.tsx::leaves the sidebar and the theme as they were | pass |
| spec-00011-AC-11.3 | web/test/workspaceSwitch.test.tsx::remembers the workspace a direct address settles on | pass |
| spec-00011-AC-12.1 | test/host.test.ts::counts the session cap per workspace | pass |
| spec-00011-AC-12.2 | test/host.test.ts::refuses a second session in the workspace whose cap is reached | pass |
| spec-00011-AC-12.3 | test/host.test.ts::reads the ask threads of the workspace they were filed in | pass |
| spec-00011-AC-12.4 | test/host.test.ts::applies each workspace’s own local agent layer | pass |
| spec-00011-AC-12.5 | test/host.test.ts::signals only the workspace whose docs moved | pass |
| spec-00011-AC-12.6 | web/test/notifyWorkspace.test.tsx::raises no end toast on this page when another workspace session ends | pass |
| spec-00011-AC-12.7 | test/host.test.ts::reads the same id in both as no clash in either | pass |
| spec-00011-AC-13.1 | test/cli.test.ts::registers the project the cwd is in and serves it on the port + test/startup.test.ts::starts and reports its address on a valid config | pass |
| spec-00011-AC-13.2 | web/test/workspaceSwitch.test.tsx::goes to the workspace this browser was last in | pass |
| spec-00011-AC-13.3 | web/test/workspaceSwitch.test.tsx::goes to the first available entry when nothing was remembered + web/test/workspaceSwitcher.test.tsx::skips an unavailable entry when it lands | pass |
| spec-00011-AC-13.4 | test/startup.test.ts::starts with no workspace when the cwd is in no project + web/test/workspaceSwitcher.test.tsx::invites the first workspace when the registry is empty, switcher and all | pass |
| spec-00011-AC-13.5 | test/cli.test.ts::registers a project whose flow config is invalid and listens all the same | pass |
| spec-00011-AC-13.6 | test/cli.test.ts::registers the project the cwd is in and serves it on the port | pass |
| spec-00011-AC-13.7 | test/cli.test.ts::registers a project whose flow config is invalid and listens all the same + web/test/workspaceSwitcher.test.tsx::says which config error keeps a registered workspace from opening | pass |
| spec-00011-AC-14.1 | test/cli.test.ts::registers through the process already running and starts no second one | pass |
| spec-00011-AC-14.2 | test/host.test.ts::signals the host events channel on a new entry + web/test/workspaceSwitcher.test.tsx::shows an entry added elsewhere while it stays open | pass |
| spec-00011-AC-14.3 | test/cli.test.ts::prints the running process entry point when the cwd is in no project | pass |
| spec-00011-AC-15.1 | test/cli.test.ts::reports the port as occupied when the server on it is not a persimmon | pass |
| spec-00011-AC-15.2 | test/cli.test.ts::reports the port as occupied, in bounded time, when nothing on it answers + test/startup.test.ts::reports a port it cannot have instead of crashing | pass |
| spec-00011-AC-15.3 | test/cli.test.ts::reports a registration the running process refused, and listens not | pass |
| spec-00011-AC-16.1 | test/host.test.ts::wraps up the running session of every workspace before it resolves + test/host.test.ts::resolves while a browser still holds its sockets open | pass |
| spec-00011-AC-16.2 | test/host.test.ts::wraps up the running session of every workspace before it resolves + test/startup.test.ts::handles SIGTERM itself instead of being killed by it + test/boardSeams.test.ts::drops the sockets a live browser is holding | pass |
| spec-00011-AC-16.3 | test/host.test.ts::does nothing on a second shutdown | pass |
| spec-00011-AC-17.1 | web/test/notifyWorkspace.test.tsx::posts a notification whose title starts with the workspace display name | pass |
| spec-00011-AC-17.2 | web/test/notifyWorkspace.test.tsx::switches to that workspace and shows the session | pass |
| spec-00011-AC-17.3 | web/test/notifyWorkspace.test.tsx::shows the session without switching when that workspace is already current | pass |
| spec-00011-AC-17.4 | web/test/notifyWorkspace.test.tsx::refuses and leaves the view alone when that workspace has been removed | pass |
| spec-00011-AC-17.5 | web/test/notifyWorkspace.test.tsx::refuses with the reason when that workspace is no longer available | pass |
| spec-00011-AC-17.6 | web/test/notifyWorkspace.test.tsx::leaves another workspace notification standing | pass |
| spec-00011-AC-17.7 | web/test/notifyWorkspace.test.tsx::carries the display name, the kind, the id and the state, and nothing else | pass |
| spec-00011-AC-17.8 | web/test/notifyWorkspace.test.tsx::says nothing about a session that was already waiting when the page loaded | pass |
| spec-00011-AC-17.9 | web/test/notifyWorkspace.test.tsx::catches up on another workspace waiting session when the page goes away | pass |
| spec-00011-AC-18.1 | test/workspaceRegistry.test.ts::refuses an ill-formed file, naming the path and the problem + test/cli.test.ts::refuses the start, naming the file and the problem, and rewrites nothing | pass |
| spec-00011-AC-18.2 | test/cli.test.ts::refuses `list` on a duplicated id, naming it | pass |
| spec-00011-AC-18.3 | test/cli.test.ts::refuses `add` when `~/.persimmon` is a file, naming the path + test/workspaceRegistry.test.ts::refuses when the registry directory is a file, naming the path | pass |
| spec-00011-AC-19.1 | test/host.test.ts::commits into the workspace the action was made in, and no other | pass |
| spec-00011-AC-19.2 | test/host.test.ts::writes the local agent settings of the workspace the save was made in | pass |
| spec-00011-AC-20.1 | test/distribution.test.ts::runs the shipped entry point from under node_modules + 手工验证「安装形态实测·第二次」全局安装形态 `persimmon list` | pass |
| spec-00011-AC-20.2 | 手工验证「安装形态实测·第二次」：`npm run test:install` 比对 `npx --yes --package <tarball> -- persimmon list` 与全局安装形态输出逐字相同 | pass |
| spec-00011-AC-21.1 | test/cli.test.ts::lists every entry with its availability | pass |
| spec-00011-AC-21.2 | test/cli.test.ts::prints an empty list on an empty registry | pass |

87 条 AC 各有一行，全部 pass。`AC-20.1` 与 `AC-20.2` 在第一次实测为 fail、
经 issue-00029 修复后第二次实测为 pass，两次都记在上文「安装形态实测」。
无未覆盖项：本轮把 `AC-13.7`
（此前无测试）、`AC-12.3`、`AC-12.4`、`AC-19.2`（此前有 FR 级注释而无对应
用例）四条补齐；`AC-4.2`、`AC-13.2`、`AC-13.3`、`AC-13.6`、`AC-16.2`、
`AC-18.2`、`AC-21.2`、`AC-6.2`、`AC-9.3` 的溯源注释此前以同注释续写或 FR id
写就，本轮改写为全 id，使一次 grep 即可核对。

## 只钉住半边的 AC

下列各条的 Then 只有一半由测试钉住，另一半由所列的另一条用例或第 6 项手工
验证承担；行仍记 pass，因为所钉的那一半正是该 AC 的可测内核，但不宣称多于
测试所示：

- `AC-3.4`「两条都在**且都可用**」——登记那一半由 `registers a directory
  nested inside another workspace` 钉住（夹具只造 `.git` 目录）；可用性那一半
  的边界由 `test/workspaceAvailability.test.ts::is noGit when the directory is
  a subdirectory of a repository` 从另一侧钉住（不是自己仓库根的子目录即
  `noGit`）。
- `AC-6.7`「行为按打开时的配置不变」——所钉的是可用性判定的免重验（实例按
  打开时的配置继续可用）；「发起会话的行为」本身沿 `spec-00001` 既有验收。
- `AC-7.1`「运行中 1、等待 1」——测试以**一个等待中的运行会话**取 1/1，这是
  AC 措辞与 `CONTEXT.md`「等待输入计入运行中总数」两种读法都满足的形态。
  plan T1 已记此处 AC 措辞待改，留待 `spec-00011` 下一次修订轮。
- `AC-8.2`、`AC-8.3`、`AC-11.3` —— 见上文「手工验证」三条。
- `AC-16.2`「历史都已落盘后进程才退出」——所钉的是关停扇出与「`shutdown()`
  兑现之前两个 workspace 各已 commit」这一先后；单个会话的历史落盘本身是
  `spec-00003-FR-9` 的既有验收。
- `AC-20.1` —— 默认层由 `test/distribution.test.ts::runs the shipped entry point from under node_modules` 钉住（伪安装树，无网络），真实安装形态由 opt-in 的 `npm run test:install` 实测；`AC-20.2`只有实测（需 registry），不进默认套件。两条均 pass。

## 实现期的既定取舍

- **`AC-12.3` / `AC-12.4` / `AC-19.2` 补在 `test/host.test.ts` 而不是前端**：
  三条钉的都是「读写落在哪个 workspace 的目录里」，观测点在服务端；前端只是
  把 `wid` 绑进路径（已由 `web/test/workspaceSwitch.test.tsx::boardApi` 那组
  钉住），在 jsdom 里再造一遍只会把断言换成一套替身。
- **`AC-12.3` 直接写 `.whiteboard/asks/<id>.json` 而不起一次 ask 会话**：
  AC 的 Then 是「另一个 workspace 的同 id 文档问题列表为空」，可测内核是
  列表按 workspace 各存一份；起一次真会话会把两个 workspace 的隔离换成一套
  agent 替身的时序。
- **`AC-13.7` 拆成命令半边与页面半边**：命令半边把 `AC-13.5` 那条对打印地址
  的 `toContain('/w/')` 收紧成对 `/w/<id>` 的全等断言（登记下来的那一条的 id
  正是地址里的那个）；页面半边另起一条，紧挨 `AC-9.3`，Given 取
  `availability: 'invalidConfig'` 并断言错误原文在页面上、切换器可达、对该
  workspace 一次读写都没有。整条 Then 只在浏览器里才连成一条，这在两半各自
  可测的前提下不值得再造一次端到端。
- **`AC-20.1` / `AC-20.2` 的溯源注释写在 `describe('persimmon list')` 上**：
  两条的 Given 是安装形态，跑在工作树里的用例从定义上到不了；注释只指明证据
  在实测，不假装用例覆盖了它。
