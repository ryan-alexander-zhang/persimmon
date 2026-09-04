---
id: spec-00011-multi-workspace
type: spec
status: active
parent: prd-00003-multi-workspace
---

# Spec: 多 workspace——一个进程服务多个项目目录

> 一个 `persimmon` 进程持有一份 workspace 注册表，每个含 `whiteboard.config.yaml`
> 的项目根目录是一个 workspace；顶栏切换器在它们之间切换，图、导航栏、会话
> 面板与设置面板随之整体切换，进程与端口不变；会话、通知、监听逐 workspace
> 作用；一条命令从任何目录启动或接入已运行进程。

## 1. Context

- canonical terms 见 `CONTEXT.md`：白板、节点、导航栏、类型组、目录组、
  会话面板、Agent 会话、等待输入、终止、刷新、变更推送、呈现状态、就近关闭、
  桌面通知、离场、离场区间、流程配置、Agent 设置、本地 agent 设置、
  有效 agent 列表、设置面板、命令面板、动作被拒、会话历史、答疑线程、标注、
  撞 id、全局覆盖率视图。design-00002 §2 持有的布局词也在本 spec 中使用：
  **右槽**、**终端面板**、**工作区**（页面布局区域）。
- 本 spec 的 Markdown 方言取 GFM。
- 输入：`parent` 为 [prd-00003-multi-workspace](../prd/prd-00003-multi-workspace.md)
  （与本 spec 同一轮写成、一并评审）；方向与已定项在
  [idea-00004-multi-workspace](../idea/idea-00004-multi-workspace.md)「已定方向」；
  拆仓背景在 [decision-00019-whiteboard-standalone-repo](../decision/decision-00019-whiteboard-standalone-repo.md)。
- 本 spec 是 `spec-00001` … `spec-00010` 的**并列新 spec**（Sizing and
  Splitting 第 1 条），不 supersede 任何一份。它 21 条 FR、正文过 500 行，
  README 的两个拆分触发都亮了；**决定不拆**：自然的缝是 CLI（FR-13 … FR-15、
  FR-20、FR-21）与板，但 CLI 的每条都以注册表与切换器的语义为前提，拆成两份
  会让每份都不能独立验收。除下列交接外，它不改任何
  workspace **内部**的行为：`spec-00001` … `spec-00010` 的每条需求在每个
  workspace 内逐一成立，其验收集整体是本 spec 的回归约束（§7）。
- **与既有文档的交接**（均不就地改它们——它们都是 `active`，修订属其各自的
  修订轮 `rule-00001-BR-3`，由 plan 轮列为任务；沿 `spec-00003` §1 的先例）：
  - `spec-00001-FR-15`（配置缺失或非法拒绝启动）：拒绝的作用域由**进程**改为
    **workspace**——该 workspace 不可用并携带同一句错误信息（FR-6、FR-9）；
    进程级的拒绝启动只余注册表不合式一种（FR-18）。其 `spec-00001-AC-15.1` /
    `AC-15.2` 断言的「启动失败」须改写为「该 workspace 不可用」。
  - `spec-00002-FR-4`（归档门在**全仓库**的 front matter 里配对 `supersedes`）
    与 `rule-00001-BR-18`（下一个空号按仓库内现有编号分配）、docs/README 的
    「`id` 在整个仓库唯一」：「仓库」在多 workspace 下即当前 workspace，判定
    互不跨越（FR-12）；规则文本不变，只在正文追注。
  - `spec-00003-FR-3`（会话并发上限）：按各 workspace 自己的 `max_sessions`
    逐 workspace 计（FR-12）。
  - `spec-00003-FR-4`（会话面板列「本次服务启动以来的已结束会话」）：基线改为
    「该 workspace 本次打开以来」（FR-12）。
  - `spec-00003-FR-7`（结束提示条）：作用域为当前 workspace（FR-12）。
  - `spec-00003-FR-9`（正常关停收尾）：对每个 workspace 的每个运行中会话执行
    （FR-16）。
  - `spec-00004-FR-2` / `FR-3` / `FR-6`（桌面通知内容）：标题多一个 workspace
    显示名前缀，外泄面因此多出显示名一项（FR-17）。
  - `spec-00004-FR-5`（通知点击）：先切 workspace 再呈现会话（FR-17）。
  - `design-00001` §5/§7/§8 与 `design-00002` §2/§3/§13：服务端的三处开缝、
    API 前缀、代码位置、切换器控件与通知标题，由 design-00003 持有，两份既有
    design 随各自修订轮改写并声明 `informs` 本 spec。
  - `spec-00009`（agent 设置）：本地层文件仍在各项目目录（文件名由
    design-00001 §13.1 持有），有效列表逐 workspace 计算——语义不变，**无需
    修订**。
- **随接收需修订 `CONTEXT.md` 的既有定义**：「呈现状态」（其封闭枚举按
  workspace 各存一份，并增补「当前 workspace」与切换器开合）；「桌面通知」
  （「只含会话种类、文档 id 与状态」增 workspace 显示名）；「会话面板」
  （「运行中数/上限」与已结束列表按当前 workspace）；「导航栏」（「工作区
  左侧」的「工作区」指布局区域，加注以别于 workspace）；「全局覆盖率视图」
  （「全仓」改「当前 workspace」）；「撞 id」（唯一性按 workspace 判）；
  「归档门」（「仓库中须存在另一份」的仓库即当前 workspace）。
- **术语裁定**：本 spec 用英文 **workspace** 作为正名而不译作「工作区」——
  design-00002 §2 已把「工作区」定为页面布局中导航栏、画布与右槽所在的区域
  （`CONTEXT.md` 的「导航栏」词条以此用法引用它），二者不可共用一词。
  「注册表」在 `CONTEXT.md` 中被「有效 agent 列表」列为 _Avoid_、又在
  design-00001 §2 指会话注册表，故 workspace 的那份文件全称 **workspace
  注册表**；本 spec 内首次出现后省称「注册表」，专指它。
- 本 spec 新增术语（拟，接收后进 `CONTEXT.md`）：
  - **workspace（Workspace）**：一个含 `whiteboard.config.yaml` 的项目根目录，
    是白板一次呈现与操作的作用域；项目级状态（`docs/`、流程配置、
    `.whiteboard/`）全部留在该目录内。
    _Avoid_：工作区（页面布局区域）、项目（作 workspace 同义词时；「项目
    根目录」「项目目录」照用）、vault、仓库（git 概念）。
  - **workspace 注册表（Workspace Registry）**：用户目录下记录全部 workspace
    的 id、显示名与绝对路径的一份文件；白板自身唯一的跨项目状态。
    _Avoid_：配置文件、项目列表。
  - **切换器（Workspace Switcher）**：顶栏顶层入口，列出全部 workspace 及其
    可用性与会话计数，选择即切换当前 workspace，并承载添加与移除。
    _Avoid_：项目菜单、选择器、下拉框（那是控件形态）。
  - **当前 workspace（Current Workspace）**：页面此刻呈现并操作的那一个
    workspace；一页同刻恰一个，URL 指明它。
    _Avoid_：活动 workspace、选中的项目。
  - **不可用 workspace（Unavailable Workspace）**：登记在注册表中但目录不存在、
    没有流程配置、不是 git 仓库或流程配置非法的 workspace；在切换器中可见、
    带原因、不可切换、可移除。
    _Avoid_：失效条目、损坏的 workspace、隐藏。
  - **已运行进程（Running Process）**：已在本机端口上监听的 `persimmon` 进程；
    再次执行命令时接入它而不再起第二个进程。（「实例」一词留给 design 里
    逐 workspace 的服务组，不在此复用。）
    _Avoid_：守护进程、后台服务、单例、已有实例。

## 2. Stories

| Story | Value | Delivers |
| --- | --- | --- |
| S1 | 作为文档负责人，我要把几个项目登记到一个白板里、在顶栏一下切过去，切换不重启进程也不打断别的项目里正在跑的会话，这样我只维护一个进程一个标签页 | spec-00011-FR-1, spec-00011-FR-2, spec-00011-FR-3, spec-00011-FR-4, spec-00011-FR-5, spec-00011-FR-7, spec-00011-FR-8, spec-00011-FR-9, spec-00011-FR-10 |
| S2 | 作为文档负责人，我要每个项目在白板里的一切——会话、上限、答疑、标注、agent 设置、展开态——都是它自己的，落在它自己的目录里，别的项目动不了它 | spec-00011-FR-11, spec-00011-FR-12, spec-00011-FR-19 |
| S3 | 作为文档负责人，我要在任何终端敲一条 `persimmon` 就得到同一个白板：在项目里敲就打开这个项目，已经有进程在跑就接过去而不是报端口冲突；某个项目配置坏了只坏它自己 | spec-00011-FR-6, spec-00011-FR-13, spec-00011-FR-14, spec-00011-FR-15, spec-00011-FR-16, spec-00011-FR-18, spec-00011-FR-20, spec-00011-FR-21 |
| S4 | 作为文档负责人，我在别的项目里干活时，任何项目的会话等我或结束了都能叫回我，一眼看出是哪个项目，点一下就落到那个项目的那个会话 | spec-00011-FR-7, spec-00011-FR-17 |

## 3. Business Rules

| Rule set | Doc | Covers |
| --- | --- | --- |
| Docs 工作流 | [rule-00001-docs-workflow](../rule/rule-00001-docs-workflow.md) | 在每个 workspace 内不变；本 spec 不新增业务规则——workspace 是软件的作用域概念，拿掉软件后不存在 |

## 4. System Requirements

- **spec-00011-FR-1** (Ubiquitous) 系统应在用户目录 `~/.persimmon/workspaces.json`
  维护 workspace 注册表：文件含版本号与条目列表，每条含唯一 `id`、显示名
  `name` 与项目根目录的绝对路径 `path`，条目顺序即切换器顺序；文件不存在读作
  空注册表；用户手改文件后，下一次列出即反映改动，无需重启进程。
- **spec-00011-FR-2** (Event) 当用户经切换器的添加入口或命令 `persimmon add
  [path] [--name <n>]` 添加一个目录时，系统应追加一条：`path` 缺省为当前目录
  向上找到的最近项目根目录，落盘前规范为解析了符号链接的绝对路径；`id` 由
  目录名派生、非空、只含小写字母数字与连字符、与既有 `id` 不重复、一经分配
  不再改变；`name` 缺省取 `id`、可指定。同一目录（按规范化后的路径）已登记
  时不新增条目、返回既有条目。命令形态非交互，成功与已登记都以 0 退出。
- **spec-00011-FR-3** (Unwanted) 若添加的路径不存在、不是目录、或目录内没有
  `whiteboard.config.yaml`，系统应拒绝添加并说明是哪一种，不改写注册表。流程
  配置非法或目录不是 git 仓库**不构成拒绝**——登记后按 FR-6 呈现为不可用。
  系统也不判定新路径是否位于另一个已登记 workspace 之下：子目录自己也是 git
  仓库时照常登记（两者各有自己的 git 仓库与 `docs/`），只是同一仓库内的子目录
  会因「不是 git 仓库」而不可用。
- **spec-00011-FR-4** (Event) 当用户经切换器或命令 `persimmon remove <id|path>`
  移除一个 workspace 时，系统应只删除注册表条目，不改动该目录内任何文件。被
  移除的恰是当前 workspace 时，页面落到注册表第一条可用 workspace，没有可用
  的则呈现空态。
- **spec-00011-FR-5** (Unwanted) 若被移除的 workspace 有运行中会话，系统应拒绝
  移除并说明原因，条目不变；若指定的 `id` 或路径不在注册表中，系统应说明
  未登记，注册表不变。
- **spec-00011-FR-6** (Ubiquitous) 系统应在每次列出时逐条判定未打开过的
  workspace 的可用性：目录不存在、目录内无流程配置、目录不是 git 仓库、流程
  配置非法四种为不可用，各带原因与一句说明，其中配置非法的说明与单 workspace
  时 `spec-00001-FR-15` 拒绝启动所打印的错误信息同句；原因消除后下一次列出
  即可用，无需重启进程。已打开过的 workspace 只免去配置两项的重判：它按打开时
  的配置继续可用，其后的配置改动经重启进程生效（`spec-00010` 对 `exclude` 的
  既有口径推广到整份配置）；目录不存在与不是 git 仓库两项对已打开过的
  workspace 照样每次判定，判为不可用时它不可切换，其已在运行的会话与读写各按
  自己的失败路径报错。
- **spec-00011-FR-7** (Ubiquitous) 系统应在顶栏提供切换器：列出注册表全部
  条目并标出当前 workspace，每条呈现显示名、路径、可用性（不可用者带原因，选择它按 FR-9 被拒，
  移除入口照常可达）与该 workspace 的运行中会话数、等待输入会话数（以
  非颜色手段可辨，沿 `spec-00003-FR-4` 徽标的口径；为零不渲染）；提供添加
  入口与每条的移除入口；注册表为空时呈现空态与添加入口。切换器打开期间，
  任一 workspace 的会话计数变化应即时反映，不要求它是当前 workspace。
- **spec-00011-FR-8** (Event) 当用户在切换器中选择另一个可用 workspace 时，
  系统应把当前 workspace 换为它：图、导航栏、右槽、终端面板、会话面板、设置
  面板、命令面板的检索范围、异常与诊断计数全部换为该 workspace 的；进程与端口不变；其他 workspace 的运行中会话不受影响、继续
  运行；URL 指明新的当前 workspace；再切回原 workspace 时其呈现状态按 id
  保持，所指对象已不存在者就近关闭。浏览器前进与后退在两个 workspace 的
  URL 之间移动时视同切换。
- **spec-00011-FR-9** (Unwanted) 若用户选择的 workspace 不可用，系统应拒绝
  切换、呈现其原因说明，当前 workspace 不变；若浏览器直接打开一个未登记
  `id` 的 workspace 地址，页面应呈现「未登记」态与切换器；直接打开一个不可用
  workspace 的地址，页面应呈现其不可用原因与切换器；两种情形都不视其为当前
  workspace、不发起对它的任何读写。
- **spec-00011-FR-10** (Event) 当用户重载页面时，系统应回到重载前的 workspace；
  重载只恢复 workspace 身份与 FR-11 列出的持久项，选中、下钻、终端滚动位置等
  内存中的呈现状态不跨重载（与今天相同）。
- **spec-00011-FR-11** (Ubiquitous) 跨页面重载持久的浏览器本地状态中，类型组
  与目录组的展开态应按 workspace 分别保持；导航栏开合、主题、桌面通知开关、
  面板尺寸与「上次所在 workspace」为浏览器级偏好，全局一份、切换 workspace
  不变。「上次所在 workspace」取该浏览器最近一次切换或打开的 workspace，多
  标签页并存时以最近一次为准。
- **spec-00011-FR-12** (Ubiquitous) 下列状态与判定应逐 workspace 各自成立、
  互不可见：文档解析、图、id 唯一性与撞 id 判定、全局覆盖率视图；变更监听与
  刷新；会话的发起、同文档互斥、并发上限（取各自流程配置的 `max_sessions`，
  一个 workspace 的会话不占另一个的名额）、结束提示条、会话面板（已结束列表
  的基线为该 workspace 本次打开以来）与会话历史；答疑线程；标注；有效 agent
  列表与本地 agent 设置。落盘位置仍是各自项目目录的 `docs/` 与 `.whiteboard/`，
  白板在用户目录只写注册表。
- **spec-00011-FR-13** (Event) 当用户执行 `persimmon`（无子命令）时：若当前
  目录在某个项目内（向上找到最近的 `whiteboard.config.yaml`），系统应把该项目
  根目录登记（幂等）并以它为打开的 workspace——它不可用时页面按 FR-9 呈现其
  原因；若不在任何项目内，系统应打开「上次所在 workspace」，没有或已不在
  注册表中时打开注册表第一条可用 workspace，全部不可用或注册表为空时打开
  空态。命令打印可访问地址；监听端口取环境变量 `PORT`，缺省 4173。
- **spec-00011-FR-14** (Event) 当执行 `persimmon` 而该端口上已有一个已运行进程在监听时，命令应
  不再监听、不起第二个进程：FR-13 的登记经已运行进程完成（其切换器随即可见
  新条目），命令打印已运行进程中该 workspace 的地址并以 0 退出。
- **spec-00011-FR-15** (Unwanted) 若该端口被占用而占用者不是已运行进程，命令
  应报端口被占用并以非 0 退出，不登记、不监听；若经已运行进程的登记被拒或
  失败（FR-3 的拒绝、写盘失败），命令应报出该原因并以非 0 退出，不监听。
- **spec-00011-FR-16** (Event) 当进程正常关停时，系统应对每个 workspace 的每
  个运行中会话执行 `spec-00003-FR-9` 的终止收尾（结束进程、commit、历史落盘；
  等待因 `spec-00003` 的信号升级阶梯而有界），全部收尾完成后退出；第二次
  关停信号并入进行中的那一次。
- **spec-00011-FR-17** (Event) 当任一 workspace（当前或非当前）的会话转入等待
  输入或结束、且 `spec-00004` 的弹出条件成立时，系统应弹桌面通知，标题以该
  workspace 的显示名为前缀，其余内容与判重、替换规则同 `spec-00004-FR-2` …
  `FR-6`，判重与替换逐「workspace + 会话」成立；通知内容只含 workspace 显示名、
  会话种类、文档 id 与状态，不含目录路径、正文或转写片段。页面首次读到某个
  workspace 的会话摘要时（如重载后），那批会话的状态是基线、不触发通知；
  页面转入离场时的补发（`spec-00004-FR-2`）对全部已打开 workspace 中等待输入
  的会话逐个成立，不限当前 workspace。当用户点击通知时，系统应
  先把当前 workspace 切为该 workspace（已是则不切），再按 `spec-00004-FR-5`
  呈现对应会话；该 workspace 已不可用或已被移除时提示且不改变当前视图。
- **spec-00011-FR-18** (Unwanted) 若注册表文件存在但不可解析、版本不识别、任一
  条目缺 `id`/`name`/`path`、`id` 重复或不合 FR-2 的形态、`path` 非绝对路径，
  或文件与其目录不可读，系统应拒绝启动并指明文件路径与问题，且不改写该
  文件；`persimmon add`/`remove`/`list` 遇同情形同样拒绝并指明。
- **spec-00011-FR-19** (Ubiquitous) 在一个 workspace 内发起的任何动作（编辑、
  状态流转、评审、会话、答疑、标注、设置保存）应只读写该 workspace 的目录与
  git 仓库，不触及任何其他 workspace 的目录、git 仓库或 `.whiteboard/`。
- **spec-00011-FR-20** (Ubiquitous) 包名应为 `@ryan-alexander-zhang/persimmon`
  （npm 上的 `persimmon` 已被无关包占用），命令名应为 `persimmon`；全局安装与
  经 npm 一次性执行（`npx @ryan-alexander-zhang/persimmon`）两种安装形态下
  命令行为相同；仓库根即包根，本仓库自身的 `whiteboard.config.yaml` 与
  `docs/` 仍在根，本仓库是第一个 workspace。
- **spec-00011-FR-21** (Ubiquitous) 命令 `persimmon list` 应列出注册表全部
  条目的 `id`、显示名、路径与可用性（口径同 FR-6），以 0 退出；注册表为空时
  输出空列表；注册表不合式时按 FR-18 拒绝。

**Acceptance (GWT)**

- **spec-00011-AC-1.1** (spec-00011-FR-1)
  Given 用户目录下没有 `~/.persimmon/workspaces.json`
  When 启动 `persimmon` 并打开切换器
  Then 切换器呈现空态与添加入口，进程不报错
- **spec-00011-AC-1.2** (spec-00011-FR-1)
  Given 进程运行中，注册表文件已被用户手改为两条
  When 用户重新打开切换器
  Then 切换器列出两条，顺序同文件
- **spec-00011-AC-2.1** (spec-00011-FR-2)
  Given 目录 `/work/demo` 含 `whiteboard.config.yaml`，注册表为空
  When 执行 `persimmon add /work/demo`
  Then 注册表新增 `{id: "demo", name: "demo", path: "/work/demo"}`，命令以 0 退出
- **spec-00011-AC-2.2** (spec-00011-FR-2)
  Given 注册表已有 `id` 为 `demo` 的条目指向另一目录
  When 添加另一个目录名也是 `demo` 的项目
  Then 新条目 `id` 与 `name` 均为 `demo-2`，两条都在
- **spec-00011-AC-2.3** (spec-00011-FR-2)
  Given `/work/demo` 已登记
  When 再次执行 `persimmon add /work/demo`
  Then 注册表仍只有那一条，命令以 0 退出并输出既有条目
- **spec-00011-AC-2.4** (spec-00011-FR-2)
  Given 当前目录为项目 `/work/alpha/docs/spec`，注册表为空
  When 执行 `persimmon add`（无参数）
  Then 注册表新增 `path` 为 `/work/alpha` 的一条
- **spec-00011-AC-2.5** (spec-00011-FR-2)
  Given `/tmp` 是指向 `/private/tmp` 的符号链接，`/private/tmp/demo` 已登记
  When 执行 `persimmon add /tmp/demo`
  Then 注册表仍只有那一条，其 `path` 为 `/private/tmp/demo`
- **spec-00011-AC-2.6** (spec-00011-FR-2)
  Given 目录 `/work/演示` 含流程配置，注册表为空
  When 添加它并指定 `--name 演示`
  Then 条目 `id` 非空且只含小写字母数字与连字符，`name` 为 `演示`
- **spec-00011-AC-2.7** (spec-00011-FR-2)
  Given 已登记的 workspace `demo`，其目录已被改名、注册表 `path` 已由用户改到新目录
  When 打开切换器
  Then 该条 `id` 仍为 `demo`
- **spec-00011-AC-3.1** (spec-00011-FR-3)
  Given 路径 `/work/nope` 不存在
  When 经切换器添加它
  Then 添加被拒并说明目录不存在，注册表未改
- **spec-00011-AC-3.2** (spec-00011-FR-3)
  Given 目录 `/work/plain` 存在但没有 `whiteboard.config.yaml`
  When 执行 `persimmon add /work/plain`
  Then 命令以非 0 退出并说明缺少流程配置，注册表未改
- **spec-00011-AC-3.3** (spec-00011-FR-3)
  Given 目录含一份 `max_sessions: -1` 的非法流程配置
  When 添加它
  Then 添加成功，注册表新增一条
- **spec-00011-AC-3.4** (spec-00011-FR-3)
  Given 已登记的 workspace `alpha`，其子目录 `alpha/vendor/sub` 自己也是 git 仓库且含流程配置
  When 添加 `alpha/vendor/sub`
  Then 添加成功，两条都在且都可用
- **spec-00011-AC-4.1** (spec-00011-FR-4)
  Given 已登记的 workspace `demo` 无运行中会话，目录内有 `.whiteboard/` 与 `docs/`
  When 用户在切换器移除它
  Then 注册表不再含它
- **spec-00011-AC-4.2** (spec-00011-FR-4)
  Given 已登记的 workspace `demo` 无运行中会话，目录内有 `.whiteboard/` 与 `docs/`
  When 用户在切换器移除它
  Then 目录内文件一个不少
- **spec-00011-AC-4.3** (spec-00011-FR-4)
  Given 当前 workspace 为 `demo`，注册表另有可用的 `alpha` 在其前
  When 用户移除 `demo`
  Then 页面切到 `alpha`
- **spec-00011-AC-4.4** (spec-00011-FR-4)
  Given 注册表只有当前 workspace 一条
  When 用户移除它
  Then 页面呈现空态与添加入口
- **spec-00011-AC-4.5** (spec-00011-FR-4)
  Given 当前 workspace 为 `demo`，注册表另有 `broken`（不可用）与可用的 `alpha`，顺序为 `broken`、`demo`、`alpha`
  When 用户移除 `demo`
  Then 页面切到 `alpha`
- **spec-00011-AC-5.1** (spec-00011-FR-5)
  Given workspace `demo` 有一个运行中会话
  When 用户移除它
  Then 移除被拒并说明有运行中会话，条目仍在
- **spec-00011-AC-5.2** (spec-00011-FR-5)
  Given 注册表不含 `ghost`
  When 执行 `persimmon remove ghost`
  Then 命令说明未登记，注册表未改
- **spec-00011-AC-6.1** (spec-00011-FR-6)
  Given 已登记的 workspace 目录被整个删除
  When 打开切换器
  Then 该条仍在、标为不可用且原因为目录不存在
- **spec-00011-AC-6.2** (spec-00011-FR-6)
  Given 已登记的 workspace 目录在，但其 `whiteboard.config.yaml` 已被删除
  When 打开切换器
  Then 该条标为不可用且原因为缺少流程配置
- **spec-00011-AC-6.3** (spec-00011-FR-6)
  Given 已登记的 workspace 目录含流程配置但不是 git 仓库
  When 打开切换器
  Then 该条标为不可用且原因为不是 git 仓库
- **spec-00011-AC-6.4** (spec-00011-FR-6)
  Given 已登记但未打开过的 workspace 的 `whiteboard.config.yaml` 含 `max_sessions: 0`
  When 打开切换器
  Then 该条标为不可用，说明文字与单 workspace 启动时对同一配置打印的错误信息相同
- **spec-00011-AC-6.5** (spec-00011-FR-6)
  Given 已登记的 workspace 因配置非法而不可用，其配置随后被修正
  When 不重启进程、重新打开切换器
  Then 该条可用
- **spec-00011-AC-6.6** (spec-00011-FR-6)
  Given `demo` 已打开过，其后 `demo/whiteboard.config.yaml` 被改成非法
  When 打开切换器
  Then `demo` 仍标为可用
- **spec-00011-AC-6.7** (spec-00011-FR-6)
  Given `demo` 已打开过，其后 `demo/whiteboard.config.yaml` 被改成非法
  When 用户继续在 `demo` 发起会话
  Then 行为按打开时的配置不变
- **spec-00011-AC-6.8** (spec-00011-FR-6)
  Given `demo` 已打开过，其后其目录被整个删除
  When 打开切换器
  Then `demo` 标为不可用且原因为目录不存在
- **spec-00011-AC-7.1** (spec-00011-FR-7)
  Given 注册表三条，当前为第二条，第三条有一个运行中会话与一个等待输入会话
  When 打开切换器
  Then 三条按顺序呈现，第二条标为当前，第三条呈现运行中 1、等待 1，第一条无计数
- **spec-00011-AC-7.2** (spec-00011-FR-7)
  Given 切换器处于打开态，当前 workspace 为 `alpha`
  When `demo` 的一个会话转入等待输入
  Then 切换器上 `demo` 的等待计数变为 1
- **spec-00011-AC-7.3** (spec-00011-FR-7)
  Given 注册表含一条不可用的 `broken`
  When 打开切换器并以键盘移到 `broken` 行
  Then 该行呈现其原因，其移除入口可聚焦并可激活
- **spec-00011-AC-8.1** (spec-00011-FR-8)
  Given 当前 workspace 为 `alpha`，`demo` 可用
  When 用户在切换器选择 `demo`
  Then 图、导航栏、会话面板、设置面板与异常诊断计数换为 `demo` 的
- **spec-00011-AC-8.2** (spec-00011-FR-8)
  Given 当前 workspace 为 `alpha`，`demo` 可用
  When 用户在切换器选择 `demo`
  Then 服务端进程与端口不变，地址栏路径含 `demo`
- **spec-00011-AC-8.3** (spec-00011-FR-8)
  Given `alpha` 有一个运行中会话，当前 workspace 为 `alpha`
  When 用户切到 `demo` 再切回 `alpha`
  Then 该会话仍在运行，终端完整输出与滚动位置保持
- **spec-00011-AC-8.4** (spec-00011-FR-8)
  Given 当前 workspace 为 `alpha` 且已选中一个节点
  When 用户切到 `demo` 再切回 `alpha`
  Then 该节点仍被选中
- **spec-00011-AC-8.5** (spec-00011-FR-8)
  Given 当前 workspace 为 `alpha` 且已下钻到一份 spec，该 spec 在切走期间被删除
  When 用户切回 `alpha`
  Then 下钻关闭、回到顶层，其余呈现状态保持
- **spec-00011-AC-8.6** (spec-00011-FR-8)
  Given 当前 workspace 为 `demo`，命令面板打开
  When 输入只在 `alpha` 存在的文档 id
  Then 无结果
- **spec-00011-AC-8.7** (spec-00011-FR-8)
  Given 用户先在 `alpha` 后切到 `demo`
  When 按浏览器后退
  Then 当前 workspace 变为 `alpha`
- **spec-00011-AC-9.1** (spec-00011-FR-9)
  Given 当前 workspace 为 `alpha`，`broken` 因配置非法而不可用
  When 用户在切换器选择 `broken`
  Then 切换被拒并呈现该配置的错误信息，当前 workspace 仍为 `alpha`
- **spec-00011-AC-9.2** (spec-00011-FR-9)
  Given 注册表不含 `ghost`
  When 浏览器直接打开 `ghost` 的 workspace 地址
  Then 页面呈现「未登记」态与切换器
- **spec-00011-AC-9.3** (spec-00011-FR-9)
  Given `broken` 已登记且目录不存在
  When 浏览器直接打开 `broken` 的 workspace 地址
  Then 页面呈现目录不存在的说明与切换器，不发起对 `broken` 的任何读写
- **spec-00011-AC-10.1** (spec-00011-FR-10)
  Given 当前 workspace 为 `demo`
  When 用户重载页面
  Then 页面仍呈现 `demo`
- **spec-00011-AC-10.2** (spec-00011-FR-10)
  Given 当前 workspace 为 `demo` 且已下钻到一份 spec
  When 用户重载页面
  Then 页面呈现 `demo` 的顶层，未下钻
- **spec-00011-AC-11.1** (spec-00011-FR-11)
  Given 用户在 `alpha` 折叠了类型组 `spec`，在 `demo` 展开着
  When 重载页面并分别查看两个 workspace
  Then `alpha` 的 `spec` 组仍折叠，`demo` 的仍展开
- **spec-00011-AC-11.2** (spec-00011-FR-11)
  Given 用户在 `alpha` 收起导航栏并切到深色主题
  When 切到 `demo`
  Then 导航栏仍收起、主题仍为深色
- **spec-00011-AC-11.3** (spec-00011-FR-11)
  Given 两个标签页分别在 `alpha` 与 `demo`，`demo` 那页最后切换
  When 打开第三个标签页到入口地址
  Then 第三页呈现 `demo`
- **spec-00011-AC-12.1** (spec-00011-FR-12)
  Given `alpha` 的 `max_sessions: 1` 且已有一个运行中会话，`demo` 的 `max_sessions: 1` 无会话
  When 用户在 `demo` 发起一个会话
  Then 发起成功
- **spec-00011-AC-12.2** (spec-00011-FR-12)
  Given `alpha` 的 `max_sessions: 1` 且已有一个运行中会话，`demo` 有一个运行中会话
  When 用户在 `alpha` 再发起一个会话
  Then 发起被拒并说明达到上限
- **spec-00011-AC-12.3** (spec-00011-FR-12)
  Given 用户在 `alpha` 对文档 X 有一条答疑线程，`demo` 也有 id 为 X 的文档
  When 切到 `demo` 并打开 X 的问题列表
  Then 列表为空
- **spec-00011-AC-12.4** (spec-00011-FR-12)
  Given `alpha/.whiteboard/agents.json` 禁用了 agent `codex`，`demo` 无本地层
  When 分别在两个 workspace 打开设置面板
  Then `alpha` 的有效列表不含 `codex`，`demo` 的含
- **spec-00011-AC-12.5** (spec-00011-FR-12)
  Given 当前 workspace 为 `alpha`
  When 在白板之外修改 `demo/docs/` 下一份文档
  Then `alpha` 的页面不刷新
- **spec-00011-AC-12.6** (spec-00011-FR-12)
  Given 当前 workspace 为 `alpha`
  When `demo` 的一个会话结束
  Then `alpha` 的页面不出现结束提示条
- **spec-00011-AC-12.7** (spec-00011-FR-12)
  Given `alpha` 与 `demo` 各有一份 id 相同的文档
  When 分别查看两个 workspace
  Then 两处都不标撞 id
- **spec-00011-AC-13.1** (spec-00011-FR-13)
  Given 注册表为空，当前目录为项目 `/work/alpha/docs/spec`，端口空闲
  When 执行 `persimmon` 并打开打印的地址
  Then 注册表新增 `/work/alpha`，页面呈现 `alpha`
- **spec-00011-AC-13.2** (spec-00011-FR-13)
  Given 注册表有 `alpha`、`demo`，浏览器上次在 `demo`，当前目录为用户主目录
  When 执行 `persimmon` 并打开地址
  Then 页面呈现 `demo`
- **spec-00011-AC-13.3** (spec-00011-FR-13)
  Given 注册表有 `broken`（不可用）与 `demo`（可用），顺序如此，浏览器无记忆，当前目录不在任何项目内
  When 执行 `persimmon` 并打开地址
  Then 页面呈现 `demo`
- **spec-00011-AC-13.4** (spec-00011-FR-13)
  Given 注册表为空，当前目录不在任何项目内
  When 执行 `persimmon` 并打开地址
  Then 页面呈现空态与添加入口，命令以监听态运行
- **spec-00011-AC-13.5** (spec-00011-FR-13)
  Given 当前目录为项目 `broken`，其流程配置非法，注册表为空
  When 执行 `persimmon`
  Then `broken` 被登记，进程以监听态运行
- **spec-00011-AC-13.6** (spec-00011-FR-13)
  Given 环境变量 `PORT=5000`，端口空闲
  When 执行 `persimmon`
  Then 进程监听 5000，打印的地址含 5000
- **spec-00011-AC-13.7** (spec-00011-FR-13)
  Given 当前目录为项目 `broken`，其流程配置非法
  When 执行 `persimmon` 并打开打印的地址
  Then 页面呈现 `broken` 的配置错误信息与切换器
- **spec-00011-AC-14.1** (spec-00011-FR-14)
  Given 一个已运行进程在 4173 监听，注册表无 `demo`，当前目录为项目 `demo`
  When 再执行 `persimmon`
  Then 不起新进程，命令打印已运行进程中 `demo` 的地址并以 0 退出
- **spec-00011-AC-14.2** (spec-00011-FR-14)
  Given 一个已运行进程在 4173 监听且其切换器处于打开态，当前目录为未登记的项目 `demo`
  When 再执行 `persimmon`
  Then 该切换器随即列出 `demo`
- **spec-00011-AC-14.3** (spec-00011-FR-14)
  Given 一个已运行进程在 4173 监听，当前目录不在任何项目内
  When 再执行 `persimmon`
  Then 不起新进程，命令打印已运行进程的入口地址并以 0 退出，注册表不变
- **spec-00011-AC-15.1** (spec-00011-FR-15)
  Given 4173 被一个非 `persimmon` 的 HTTP 服务占用，当前目录为未登记的项目 `demo`
  When 执行 `persimmon`
  Then 命令报端口被占用并以非 0 退出，注册表不变
- **spec-00011-AC-15.2** (spec-00011-FR-15)
  Given 4173 被一个从不应答的 TCP 服务占用
  When 执行 `persimmon`
  Then 命令报端口被占用并以非 0 退出
- **spec-00011-AC-15.3** (spec-00011-FR-15)
  Given 一个已运行进程在 4173 监听，当前目录为项目 `demo`，注册表文件所在目录不可写
  When 执行 `persimmon`
  Then 命令报出登记失败的原因并以非 0 退出，不起新进程
- **spec-00011-AC-16.1** (spec-00011-FR-16)
  Given `alpha` 与 `demo` 各有一个运行中会话且各有 `docs/` 变更
  When 进程收到 `SIGINT`
  Then 两个 workspace 各得到一次 commit
- **spec-00011-AC-16.2** (spec-00011-FR-16)
  Given `alpha` 与 `demo` 各有一个运行中会话
  When 进程收到 `SIGINT`
  Then 两个会话的历史都已落盘后进程才退出
- **spec-00011-AC-16.3** (spec-00011-FR-16)
  Given 关停收尾进行中
  When 进程再收到一次 `SIGINT`
  Then 不产生第二次收尾，进程在第一次收尾完成后退出
- **spec-00011-AC-17.1** (spec-00011-FR-17)
  Given 桌面通知开关生效、页面离场、当前 workspace 为 `alpha`
  When `demo` 的一个推进会话转入等待输入
  Then 弹出一条通知，标题以 `demo` 的显示名开头
- **spec-00011-AC-17.2** (spec-00011-FR-17)
  Given 一条来自 `demo` 的等待通知在场，当前 workspace 为 `alpha`，`demo` 可用
  When 用户点击该通知
  Then 页面切到 `demo` 并在终端面板呈现该会话
- **spec-00011-AC-17.3** (spec-00011-FR-17)
  Given 一条来自 `demo` 的通知在场，当前 workspace 已是 `demo`
  When 用户点击该通知
  Then 页面不切换，终端面板呈现该会话
- **spec-00011-AC-17.4** (spec-00011-FR-17)
  Given 一条来自 `demo` 的通知在场，`demo` 已被移除
  When 用户点击它
  Then 页面提示且当前视图不变
- **spec-00011-AC-17.5** (spec-00011-FR-17)
  Given 一条来自 `demo` 的通知在场，`demo` 的目录随后被删除
  When 用户点击它
  Then 页面提示且当前视图不变
- **spec-00011-AC-17.6** (spec-00011-FR-17)
  Given 开关生效、页面离场，`alpha` 与 `demo` 各有一个会话在同一离场区间内转入等待输入
  When 用户未回到页面
  Then 两条通知并存、互不替换
- **spec-00011-AC-17.7** (spec-00011-FR-17)
  Given 任一 workspace 的会话触发了通知
  When 检视通知标题与正文
  Then 只含 workspace 显示名、会话种类、文档 id 与状态，不含目录路径
- **spec-00011-AC-17.8** (spec-00011-FR-17)
  Given 开关生效、页面可见且聚焦，`demo`（非当前）有一个等待输入的会话
  When 用户重载页面
  Then 不为该会话弹通知
- **spec-00011-AC-17.9** (spec-00011-FR-17)
  Given 开关生效、页面可见且聚焦，当前 workspace 为 `alpha`，`demo` 有一个等待输入的会话
  When 页面转入离场
  Then 为 `demo` 的该会话补发一条通知
- **spec-00011-AC-18.1** (spec-00011-FR-18)
  Given `~/.persimmon/workspaces.json` 是一段不可解析的文本
  When 执行 `persimmon`
  Then 进程拒绝启动、指明该文件路径与解析失败，文件内容不变
- **spec-00011-AC-18.2** (spec-00011-FR-18)
  Given 注册表两条 `id` 相同
  When 执行 `persimmon list`
  Then 命令以非 0 退出并指明重复的 `id`
- **spec-00011-AC-18.3** (spec-00011-FR-18)
  Given `~/.persimmon` 是一个文件而不是目录
  When 执行 `persimmon add /work/demo`
  Then 命令以非 0 退出并指明该路径不可用作目录
- **spec-00011-AC-19.1** (spec-00011-FR-19)
  Given 当前 workspace 为 `alpha`
  When 用户在 `alpha` 接收一份 draft prd
  Then `alpha` 的 git 得到一次 commit，`demo` 的工作树与 git 历史不变
- **spec-00011-AC-19.2** (spec-00011-FR-19)
  Given 当前 workspace 为 `alpha`
  When 用户在 `alpha` 保存本地 agent 设置
  Then 只有 `alpha/.whiteboard/agents.json` 被写
- **spec-00011-AC-20.1** (spec-00011-FR-20)
  Given 包已全局安装
  When 在任意目录执行 `persimmon list`
  Then 命令可执行并输出注册表
- **spec-00011-AC-20.2** (spec-00011-FR-20)
  Given 包已作为 `@ryan-alexander-zhang/persimmon` 发布、本机未全局安装
  When 以 npm 一次性执行形态运行 `list`
  Then 输出与全局安装形态相同
- **spec-00011-AC-21.1** (spec-00011-FR-21)
  Given 注册表有可用的 `alpha` 与目录已不存在的 `demo`
  When 执行 `persimmon list`
  Then 输出两行，`alpha` 标可用，`demo` 标目录不存在，命令以 0 退出
- **spec-00011-AC-21.2** (spec-00011-FR-21)
  Given 注册表为空
  When 执行 `persimmon list`
  Then 输出空列表，命令以 0 退出

## 5. Technical Design

| Design | Doc | Covers |
| --- | --- | --- |
| Host 层、注册表文件契约、可用性判定、实例生命周期、API 前缀、URL 与切换、关停扇出、CLI 握手、通知组合、代码位置 | [design-00003-multi-workspace](../design/design-00003-multi-workspace.md) | 全部 FR 的实现结构 |

单 workspace 内的服务与界面仍由 design-00001 与 design-00002 持有，二者随各自
修订轮声明 `informs` 本 spec（§1 交接）；两条边在本 spec 转 `active` 前落地，
否则 §1 对它们的引用是无边可循的声明。

## 6. Out of Scope

- 多 workspace 同屏并排的合并视图；跨 workspace 的文档关系、检索、覆盖率汇总。
- 远程或多人访问；进程仍只监听 `localhost`。可添加的路径不设白名单：白板是
  本机单人工具，登记哪个目录是用户自己的选择，与今天从哪个目录启动同一信任
  模型。
- 把白板改造成以终端为中心的 agent 编排台。
- 把 `.whiteboard/`、流程配置、agent 本地层搬出项目目录。
- 流程配置的热重载（已打开 workspace 的配置改动经重启生效，沿既有口径）。
- 监听用户目录的注册表文件变化并主动推送（手改在下一次打开切换器时可见）。
- 页面关闭后的通知送达（`spec-00004` §6 的既有边界不变）。
- 不同端口上的两个已运行进程共享一份注册表：各自独立运行，同一目录可能被
  两个进程各建一组服务；由用户避免，不做协调。
- 无已运行进程时两次并发的 `persimmon add` 直接写文件的先后：取后写者。
- 今天无前缀的类型组与目录组展开态不迁移到按 workspace 的键。
- 接入已运行进程不看其版本：旧版本在跑也接入，命令打印对方版本号供用户
  自行决定是否重启。
- 已登记目录之下的嵌套 workspace 不做祖先关系判定（FR-3）：自己也是 git
  仓库的子目录照常登记，作为已知边界。

## 7. Non-Functional

- 切换 workspace 的等待与首次打开一个 workspace 的等待各不超过今天单 workspace
  的启动加载；切回已打开过的 workspace 不重新解析其文档。无 GWT，验收走实测
  （沿 design-00002 的口径）。
- 未打开过的 workspace 不产生文档解析、文件监听或会话状态。
- 验证义务：FR-20 的两种安装形态（全局安装、`npx`）各实测一次，含 `node-pty`
  的原生构建与 `postinstall`；AC-20.2 在实测通过前不计已验证。
- 回归约束：只登记一个 workspace 时，`spec-00001` … `spec-00010` 的全部既有
  验收（§1 交接列出的改写项除外）照常通过。

## Links

- Parent: [prd-00003-multi-workspace](../prd/prd-00003-multi-workspace.md) · Idea: [idea-00004-multi-workspace](../idea/idea-00004-multi-workspace.md)
- Decision: [decision-00019-whiteboard-standalone-repo](../decision/decision-00019-whiteboard-standalone-repo.md)
- Rules: [rule-00001-docs-workflow](../rule/rule-00001-docs-workflow.md)（不变）
- Design: [design-00003-multi-workspace](../design/design-00003-multi-workspace.md) · [design-00001-docs-whiteboard](../design/design-00001-docs-whiteboard.md) · [design-00002-whiteboard-ui](../design/design-00002-whiteboard-ui.md)
