---
id: plan-00027-multi-workspace
type: plan
status: resolved
implements: [spec-00011-multi-workspace, design-00003-multi-workspace]
---

# Plan: 多 workspace——Host 层、CLI 与逐 workspace 的前端

> 落地 `spec-00011` 全部 21 条 FR：代码提到仓库根，`Board` 开三处缝，新增
> Host 层与 `persimmon` CLI，前端按 workspace 参数化；含 design-00001 与
> design-00002 的多 workspace 修订轮与 `CONTEXT.md` 的六个新词条、七处修订。

## Design

Links only：

- [design-00003-multi-workspace](../design/design-00003-multi-workspace.md) ——
  §1 形态与 `Board` 的三处开缝；§2 注册表文件契约（id 派生、`realpath`、
  幂等、原子写、唯一读入口）；§3 可用性判定的四种原因与配置两项的免重验；
  §4 实例生命周期与 `Promise` 记忆；§5 API 契约（`/w/:wid/api/...` 两段前缀、
  Host 级三条、WS 升级分发、SPA fallback）；§6 浏览器侧（`boardApi(wid)`、
  URL 与切换时序、呈现状态与 localStorage 分层、切换器）；§7 关停扇出；
  §8 CLI 与启动握手；§9 桌面通知的跨 workspace 组合；§10 代码位置与运行。
- [design-00001-docs-whiteboard](../design/design-00001-docs-whiteboard.md) ——
  §2 模块结构（Host 层入图）、§5 会话生命周期（`onSessionsChanged` 的三个
  调用点）、§7 API 契约（前缀）、§8 代码位置与运行；均随 T1 的修订轮改写。
- [design-00002-whiteboard-ui](../design/design-00002-whiteboard-ui.md) ——
  §2 布局（顶栏最左的切换器）、§3 控件映射（切换器与添加对话框）、§10 刷新
  与呈现状态（逐 workspace 各存一份）、§12 常驻 xterm 实例（键为
  `wid:sessionId`）、§13 桌面通知（标题前缀与点击先切）；均随 T1 改写。

## Tasks

T1 是文档轮，先于一切代码；T2 是布局轮，先于一切新模块——**design-00001 与
design-00002 重新接收之前不得开写 T3 … T10 的代码，T2 落地之前不得按新路径
新建文件**。其后 T3 与 T5 互相独立、可并行；T4 依赖 T3；T6 依赖 T3、T4、T5；
T7 依赖 T3、T6；T8 依赖 T6；T9 依赖 T8；T10 依赖 T8 与 T9；T11 收口。

- **T1 — 词汇与十份既有文档的第二十八轮修订轮**（外加三份 decision 的追注、
  `docs/README.md` 一行）：`CONTEXT.md` 增六个新词条
  （workspace、workspace 注册表、切换器、当前 workspace、不可用 workspace、
  已运行进程）并修订七条既有定义（呈现状态、桌面通知、会话面板、导航栏、
  全局覆盖率视图、撞 id、归档门）。以下十份经修订轮（`rule-00001-BR-3`：降
  `draft` → 修订 → 审计 → 重新接收）：`design-00001`、`design-00002`、
  `spec-00001`、`spec-00002`、`spec-00003`、`spec-00004`、`spec-00005`、
  `spec-00009`、`spec-00010`、`rule-00001`。
  - `design-00001`（§2 Host 入图、§3「仓库根」的歧义、§5 会话状态的新出口、
    §7 前缀、§8 代码位置、§15 本轮无未决项）与 `design-00002`（§2 切换器入
    布局、§3 两行控件映射、§10 呈现状态分层、§12 xterm 键、§13 通知、§20
    本轮无未决项）。两份都**只登记自己那一侧**，多 workspace 的结构一律指向
    `design-00003`，不复述——两处同一事实会漂移。
  - **「拒绝启动」降级为「该 workspace 不可用」的贯穿改写**——`spec-00001-FR-15`
    的作用域变更贯穿**每一个配置键**，六份 spec、一份 design、三份 decision
    描述的是同一个机制，必须同轮改完：留一处就是两个互相矛盾的现行断言。
    `spec-00001` 的 FR-15、FR-48、FR-53 与 AC-15.1/15.2、AC-48.2…48.6、
    AC-53.5/53.6；`spec-00002` 的 FR-6 与 AC-6.1…6.4（关系矩阵自称「同款启动
    校验」）；`spec-00003` 的 FR-3 与 AC-3.4/3.5；`spec-00005` 的 AC-8.1；
    `spec-00009` 的 FR-2 与 AC-2.1…2.5（`spec-00011` §1 判它「无需修订」是
    误判——FR-2 就是 FR-15 校验）；`spec-00010` 的 FR-2 与 AC-2.1…2.9；
    `design-00001` 自己的十处（§3 的两条配置注释、`carries` 与 headless 与
    §14.1 的校验措辞、「只在启动时读取」）；`decision-00006`、`decision-00017`、
    `decision-00018` 各加一节第二十八轮追注（决定记录的是当时的裁决，只注明
    作用域后来落到哪一层，不改历史表格）。AC 的 When 统一作「在切换器中选择
    该 workspace」，Given 补上 workspace 前置。本地层不合式**不**在此列——
    它从来不拦启动（`spec-00009-FR-4`）。
  - `spec-00003` 另改 FR-4 的面板与已结束基线（新增 AC-4.10——4.4 已被占用）、
    FR-7 的提示条作用域、FR-9 的关停扇出，并补上缺失的 §8 Open Questions。
  - `spec-00004` 的 FR-2、FR-3、FR-5、FR-6（标题的 workspace 前缀、逐已打开
    workspace 成立、点击先切、外泄面只宽显示名一项）。
  - `spec-00002` 的 FR-4（归档门配对不跨 workspace）、`rule-00001` 的 BR-18
    与 BR-19（取号、撞 id 与归档配对都不跨 workspace）、`docs/README.md` 的
    「`id` 在整个仓库唯一」一行（「仓库」即当前 workspace）。
  - `spec-00004` 的 AC-6.1/AC-6.2 随 FR-6 改写——原断言通知内容「恰为」种类、
    id 与状态，与加了显示名的 FR-6 相矛盾。
  - 五份此前没有第二十八轮 §1 的 spec（`spec-00002`、`spec-00004`、
    `spec-00005`、`spec-00009`、`spec-00010`）各补 canonical terms 与修订源
    一行、Links 补 `spec-00011`/`design-00003`。
  **`spec-00011` §1 的交接清单有四处缺口，本 T1 据实补齐，留待 `spec-00011`
  下一次修订轮回填**：(1) 漏了 `spec-00010`（其 `exclude` 非法同样以「拒绝
  启动」表述）与 `spec-00002-FR-6`、`spec-00005-FR-8`；(2) 判 `spec-00009`
  「无需修订」是误判；(3) 未列 `design-00001` §2/§3、`design-00002` §10/§12
  这四处；(4) `spec-00011-FR-6` 与 `AC-6.4` 自己把那句错误信息定义为「单
  workspace 时**拒绝启动所打印**的」，而该行为已不存在——须改指
  `spec-00001-FR-15` 判为配置非法时的那句说明；(5) `AC-7.1` 写「一个运行中
  会话与一个等待输入会话 → 运行中 1、等待 1」，与 `CONTEXT.md`「等待输入
  计入运行中总数」相悖（两个会话应为 2/1）——T9 按词汇表实现，测试以一个
  等待中的运行会话取 1/1 这一两者都满足的读法，AC 措辞待改；(6) §7 的安装形态实测只写了 `list`，而 `list` 不开 pty——
  `issue-00030`（`npx` 形态下 `spawn-helper` 无可执行位）正藏在那一格之外，
  §7 须加「两种形态各实起一个 pty」。本 plan 随 T1 完成
  `draft → open`。
- **T2 — 代码提到仓库根** (spec-00011-FR-20 的布局半边)：`src/`、`web/`、
  `test/`、`bin/`、`scripts/` 与 `vite.config.ts`、`vitest.config.ts`、
  `tsconfig.json`、`components.json` 从 `tools/whiteboard/` 上移，`tools/`
  消失；根 `package.json` 取 `name: "@ryan-alexander-zhang/persimmon"`、
  `bin: { persimmon: bin/persimmon.js }`、去 `private`、加 `files` 与
  `prepack`（构建 `dist/web`）；`.gitignore` 的 `tools/*/dist/` 与 `/lib/`
  注释路径、`test/tracked.test.ts` 的路径断言、`vite` 代理（增转发 `/w`）随之
  改；`tools/whiteboard/README.md` 的命令表并入根 `README.md`；
  `ARCHITECTURE.md` §2 两行约束、§5 目录树、§11 两行风险与 `DEVELOPMENT.md`
  Commands 据实改写。**验收口径**：全仓被跟踪文件不再含字面 `tools/whiteboard`，两类除外——
  issue / plan / record 等历史工作项（它们记录当时的事实，`idea-00004` 已定
  方向第 4 条），以及 living doc 里**明确标注为原文引用**的历史更正说明
  （如 design-00001 §8 记「本行原写作…」的那几处；删掉引文等于删掉沿革）。
- **T3 — 注册表模块** (spec-00011-FR-1, FR-2, FR-3, FR-18)：新增
  `src/workspaceRegistry.ts`，按 design-00003 §2：唯一读入口（不合式即抛，
  含不可解析、版本不识别、字段缺失、`id` 重复或不合形态、`path` 非绝对、
  文件与目录不可读）、`id` 由目录名派生（小写折叠、空则 `workspace`、冲突
  加序号）、`realpath` 后落盘、同路径幂等、`mkdirSync` + `.tmp` + `rename`
  原子写、`registryPath` 为构造参数（不引入环境变量）。
- **T4 — 可用性判定** (spec-00011-FR-6)：新增 `src/workspaceAvailability.ts`，
  按 design-00003 §3 的判定次序——`existsSync`、`git rev-parse --show-toplevel`
  等于 `path`（结果按 `path` 进程内缓存，不在 `/api/workspaces` 路径上每条起
  一个同步子进程）、`existsSync` 判 `noConfig`、`loadFlowConfig` 判
  `invalidConfig`；四种原因各带一句 `error`，`invalidConfig` 即
  `ConfigError.message`；已建实例免去配置两项的重验、`missing` 与 `noGit`
  照样每次判。
- **T5 — `Board` 的三处开缝** (spec-00011-FR-8, FR-12, FR-16 的服务端前提)：
  `src/server.ts` 把 `listen(port)` 拆为 `attach()`（返回 `app` 与
  `handleUpgrade(kind, req, socket, head)`）与 `close()`（关两个
  `WebSocketServer` 与 `DocsWatcher`）；`BoardOptions` 增可选
  `onSessionsChanged`，在 `watcher.signal()` 因会话状态被调用的三处
  （`server.ts:105`、`:120`、`:180`）同时调用，**不**经 `watcher.subscribe`
  （follower 计数语义，`spec-00001-AC-42.8`）；`shutdown()` 不变。既有
  `test/server.test.ts` 的升级路径用例随之回归。
- **T6 — Host 层与 API** (spec-00011-FR-6, FR-8, FR-12, FR-16 的服务端半边)：
  新增 `src/host.ts`，按 design-00003 §4/§5/§7：`Map<wid, Promise<Board>>`
  的惰性建实例与并发记忆；`/w/:wid` 处理器只在余路径以 `/api/` 起头时解析
  并建实例、否则 `next()` 进 SPA fallback；WS 升级按前缀取实例并递入
  `handleUpgrade`，不合前缀 `socket.destroy()`；Host 级 `GET /api/instance`、
  `GET/POST/DELETE /api/workspaces*`、`WS /api/workspaces/events`（触发源恰
  两种）；`express.static` 与 `/`、`/w/*` 的 index.html；`SIGINT`/`SIGTERM`
  对全部实例 `shutdown()` 后逐个 `close()`。
- **T7 — CLI** (spec-00011-FR-13, FR-14, FR-15, FR-21, 与 FR-2/FR-4 的命令
  半边)：`bin/persimmon.js` 取代 `bin/whiteboard.js`，按 design-00003 §8：
  无子命令的启动或接入（`findRepoRoot` 判 cwd、`GET /api/instance` 1s 超时
  握手、超时与非 persimmon 应答一律报端口被占用、`server.on('error')` 的
  EADDRINUSE 兜底、`version` 只打印不设门）；`add [path] [--name]`、
  `remove <id|path>`（路径形态先 `realpath` 再查 `id`）、`list`；有已运行
  进程时经其 API 写入（422/500 报出并非 0 退出），无则直连注册表文件。
- **T8 — 前端按 workspace 参数化** (spec-00011-FR-8, FR-10, FR-11)：
  `web/src/api.ts` 的模块级对象改 `boardApi(wid)` 工厂，`eventSocket.ts` 与
  `terminalSocket.ts` 改 `connectEvents(wid)`、`connectTerminal(wid,
  sessionId)`；`Board.tsx` 持 `Map<wid, PresentationState>` 与
  `Map<wid:sessionId, xterm>`；每个读操作带发起时的 `wid`、响应 `wid` 不符即
  丢弃（沿 `useBoard.ts` 的 `reading` 纪律，issue-00018）；`sidebar.ts` 与
  `directoryGroups.ts` 的两个键加 `w:<wid>:` 前缀，其余键保持全局；
  `whiteboard-last-workspace` 在当前 workspace 每次确定下来时写；`/` 与
  `/w/:wid` 的 `pushState`/`replaceState`/`popstate`，按 design-00003 §6。
- **T9 — 切换器与 workspace 页态** (spec-00011-FR-7, FR-9, 与 FR-2/FR-4 的
  界面半边)：新增 `web/src/WorkspaceSwitcher.tsx` 与添加对话框；顶栏最左的
  `DropdownMenu` 列显示名、路径、可用性、运行中与等待计数（`Terminal`/
  `Keyboard` 两图标，为零不渲染）；不可用行不禁用、激活得到拒绝提示条；
  每行移除入口（409 → 提示条）；空态；未登记 `wid` 与不可用 `wid` 的直接
  打开页态，按 design-00003 §6 与 design-00002 §2/§3。
- **T10 — 跨 workspace 的桌面通知** (spec-00011-FR-17)：`notify.ts` 标题改
  `<name> · <kind> · <sourceId>`、正文不变；`useBoard.ts` 的 `announce` 拆两
  半——提示条只随当前 workspace 的差分，桌面通知随全部 live workspace 的并集
  差分，键 `wid:sessionId`，逐键判重与替换；页面首次读到某 workspace 的会话
  摘要即基线；转入离场对全部已打开 workspace 的等待会话补发；点击
  `window.focus()` → 必要时先切 workspace → 既有 `showSession`，按
  design-00003 §9 与 design-00002 §13。
- **T11 — 测试与验收收口**：新增 `test/workspaceRegistry.test.ts`
  （`AC-1.x`、`AC-2.x`、`AC-3.x`、`AC-18.x`）、`test/workspaceAvailability.test.ts`
  （`AC-6.x`）、`test/host.test.ts`（`AC-8.2` 的进程端口不变、`AC-12.x`、
  `AC-16.x`、`AC-19.x`、路由与升级分发）、`test/cli.test.ts`（`AC-13.x`、
  `AC-14.x`、`AC-15.x`、`AC-20.1`、`AC-21.x`）；`web/test/` 增
  `workspaceSwitcher.test.tsx`（`AC-4.x`、`AC-5.x`、`AC-7.x`、`AC-9.x`）、
  `workspaceSwitch.test.tsx`（`AC-8.x`、`AC-10.x`、`AC-11.x`）、
  `notifyWorkspace.test.tsx`（`AC-17.x`）；既有 `web/test/api.test.tsx` 等七个
  文件里写死的 `/api/...` 断言随 T8 改；每测带 `// <AC id>` 溯源标注；
  `npm test`、`npm run typecheck` 与覆盖率门全绿且不下调；写 record
  （`parent` 指向本 plan，`verifies: [spec-00011-multi-workspace]`）；根
  `README.md` 增 workspace 与 `persimmon` 命令各一节。

## Detailed Acceptance Path

1. T1 收口 → verify: 十份文档均回到 `active`（`design-00001`、
   `design-00002`、`spec-00001`、`spec-00002`、`spec-00003`、`spec-00004`、
   `spec-00005`、`spec-00009`、`spec-00010`、`rule-00001`）且各含本轮改写；
   `CONTEXT.md` 含六个新词条、七条既有定义已修订；三份 decision 各带追注；
   全仓再无进程级的配置拒绝断言——**门用一条 grep**：
   `grep -rn '拒绝启动\|启动失败\|启动被拒\|启动白板服务\|只在启动时读取' docs/ CONTEXT.md`，
   命中只允许两类（agent CLI 启动失败之义，即 `spec-00001-FR-16` 及其引用；
   与明确标注为原文引用的历史说明），其余一律为零；条目 id 全仓无重号；
   三份 design 的 mermaid 全部可解析；本 plan 为 `open`。
2. T2 落地 → verify: 在仓库根 `npm install`、`npm run typecheck`、
   `npm run build`、`npm test` 四条全部退出码 0；`git ls-files` 中除
   issue / plan / record 外无文件含字面 `tools/whiteboard`；`npm start` 仍能
   起板并返回本仓库的图。
3. T3 … T10 落地 → verify: `spec-00011-AC-1.1` … `AC-21.2` 共 87 条各有对应
   测试通过，每测带 AC id 标注。
4. 全量测试、typecheck、覆盖率门全绿 → verify: 三条命令退出码 0，四个覆盖率
   数字不低于阈值，无门槛下调、无被压制的发现。
5. 回归约束 → verify: 只登记一个 workspace 时，`spec-00001` … `spec-00010`
   的既有验收（`spec-00011` §1 交接列出的改写项除外）照常通过。
6. 手工验证：注册表置空，在本仓库内 `persimmon` 启动 → 本仓库自动登记并
   呈现；`persimmon add` 另一个模板项目；两个 workspace 间切换 → verify:
   图与导航栏整体切换、地址栏路径随之变、进程与端口不变；在 A 起一个会话，
   切到 B 再切回 → 会话仍在、终端输出与滚动位置保持；页面离场时 B 的会话
   转等待 → 桌面通知标题以 B 的显示名起头，点击落到 B 的该会话；删掉 B 的
   目录 → 切换器标不可用并带原因；在第二个终端再敲 `persimmon` → 不起新
   进程、打印已有地址。
7. 安装形态實测（`spec-00011` §7 的验证义务）→ verify: `npm pack` 得到的
   tarball 经 `npx <tarball>` 与 `npm install -g <tarball>` 两种形态各跑一次
   `persimmon list`，输出一致，含 `node-pty` 的 `postinstall` 与原生构建通过；
   `AC-20.2` 在此之前不计已验证。
8. record 列全本轮 87 条 AC，本 plan 经 `open → resolved` 放行 → verify:
   resolved 门通过（`rule-00001-BR-25`）。

## Out of Scope

- `spec-00011` §6 的全部条目（同屏合并视图、跨 workspace 关系与检索、远程
  多人、终端为中心的编排台、把项目级状态搬出项目目录、配置热重载、监听用户
  目录、页面关闭后的通知、跨端口两进程的协调、并发直写取后者、旧展开态
  迁移、接入不看版本、嵌套不判祖先）。
- **把包发布到 npm**：`@ryan-alexander-zhang/persimmon` 的实际 `npm publish`
  是一次对外动作，须域主单独授权；本 plan 只到 `npm pack` 与本地安装實测
  （第 7 步），交付的是可发布形态而非已发布事实。
- `ainpt` 模板仓库的 `post_create` 登记步骤（`prd-00003` 依赖项）：改动在模板
  仓库与 `ainpt`，本 plan 只保证 `persimmon add <path>` 非交互、幂等、已登记
  时仍以 0 退出这一契约。
- 任何 workspace **内部**行为的改动：`spec-00011-FR-19` 与 §7 的回归约束把它
  钉为不变量，本 plan 不借机改任何既有语义。
- `spec-00001` 与 `spec-00003` 的正文修订本身属其各自修订轮，本 plan 在 T1
  只做 `spec-00011` §1 交接列出的那几处，不重写这两份 spec。
- **`issue-00030`（`npx` 形态下 node-pty 的 `spawn-helper` 无可执行位）**：
  T11 的实测发现、已立案 `open`；它不影响本 plan 范围内任何 AC（`list`
  两种形态皆过），修法（运行时首次 spawn 前补可执行位）是否并入本轮由域主定，
  未定前不阻塞 `resolved`。
