---
id: spec-00012-persimmon-command
type: spec
status: active
parent: prd-00003-multi-workspace
---

# Spec: `persimmon` 命令——一个入口，一条命令开板

> 一条命令承担全部命令行入口；无子命令时它**在自己这一个进程内**起白板服务、
> 成为那个已运行进程，Ctrl-C 收尾完毕后退出。命令即本 npm 包的 bin，没有第二个
> 产物、没有子进程。脚手架三个子命令与 `new` 的登记闭环由
> `spec-00013-persimmon-scaffold` 持有；结构由 `decision-00020` 定、
> `design-00004` 持有。

## 1. Context

- canonical terms 见 `CONTEXT.md`：**persimmon 命令**、**已运行进程**、
  **workspace**、**workspace 注册表**、**切换器**。本 spec 内「服务」指白板
  服务本体，它与命令同在一个进程内，不新增术语。（第三十二轮：`CONTEXT.md`
  的 **host 包**、**版本配对**、**开发覆盖** 三个词条随其所指消失而移除，
  本节不再引用它们；`persimmon 命令` 词条现文即「npm 包
  `@ryan-alexander-zhang/persimmon` 的 bin……无子命令且本机没有已运行进程时，
  它自己开始监听，成为那个进程」。）
- 输入与权威：[decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md)
  与其形状文档 [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md)。
  该 design 第三十二轮已**原地重写**：节号 §1…§11 保留、内容全换。本 spec 引
  它的现行内容——§1 形态（一个包、一个进程）、§2 命令面（逐条子命令与退出码）、
  §3 同进程监听（`PORT` 校验、分发次序、探测三态）、§6 / §7（包结构、代码位置、
  移植面与开发命令的唯一权威）、§8（取得形态）。本 spec 只声明**这几节的引用
  有效**，不对该 design 其余各节的现状作断言（第三十二轮的审计据编排者裁定改：
  原句作「全部现行」，而 §10 的标题是「仍未改写的冲突」、其清单把本 spec 与
  `spec-00013` 列为未动——这两份一改完那份清单就该由 `design-00004` 自己的修订
  收口，不由本 spec 代为陈述）。
  `design-00004` 已声明 `informs` 本 spec——那条边在树里，不是待办。
- `parent` 为 [prd-00003-multi-workspace](../prd/prd-00003-multi-workspace.md)：
  该 PRD 第三十一轮修订后 In scope 的「单命令启动」即本 spec 的启动侧（其功能
  需求 5 明写「一条命令从任何目录启动、已有进程时不起第二个」，并把命令的
  安装与发布点名交由本 spec 持有）。
- **与 `spec-00011-multi-workspace` 的分工**（同一条启动路径的两半）：
  `spec-00011-FR-13` 持有**结果**——在项目内执行时登记该目录并以它为打开的
  workspace、打开哪一个、`PORT` 合法时如何取值；`spec-00012-FR-3` 持有**命令与
  服务之间的关系**——它们是同一个进程、谁打印地址、进程以什么退出码退出。
  `spec-00011-FR-14` 持有该端口上已有已运行进程时的接入与输出；
  `spec-00011-FR-15` 持有启动路径上端口被他人占用与登记失败的拒绝。
  `spec-00011-AC-20.2`（两种安装形态输出逐字相同）与 `spec-00011-AC-20.3`
  （缓存取得的安装形态下 pty 能起）的承载者都是 `scripts/test-install.js`
  （`spec-00011` §7），不在本 spec。
- **与 `spec-00013-persimmon-scaffold` 的分界**：`new` / `update` /
  `list-langs` 的行为与 `new` 的登记闭环全部在那份 spec；本 spec 只持有
  「这些子命令同属一个可执行体」这件事（`FR-1`）、它们各自的用法错误退什么码
  （`FR-12`）、其中两条的分发次序（`FR-14` 列的四条子命令里，属那份 spec 的
  只有 `update` 与 `list-langs`；`version` / `help` 是本 spec 自己的），以及
  命令的取得形态（`FR-10`）。
  逐条边界在 §6。
- **第三十二轮的修订源**（2026-09-09）：
  [decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md)
  的原地修订（见其**第三十二轮追注**）——2026-09-08 定下的「用 Go、两个产物、
  npm 包让出 bin 名改称 host 包、一个 tag 同发、`install.sh` 校验和」形态被域主
  推翻，改为**单一 npm 产物**：命令就是本包的 bin（`bin/persimmon.js` 薄入口
  → `src/cli.ts`），服务在同一进程内，暂不发布任何版本。本 spec 整篇写于被推翻
  的那个形态之下，逐条动作如下（该 decision §5 对本 spec 的裁定即此，引其
  §2 时连内容一起写：该表第三十二轮被整体重写，行号与旧表不对应）：
  - `FR-3`、`FR-4`：**改写**为同进程模型。没有子进程可转发，服务就在本进程里；
    用户可见的输出与信号行为（地址、stderr、Ctrl-C 停、退出码）一字不变，但
    需求文本不以「输出不变」把已经没有了的转发层留在纸面上（`decision-00020`
    §4「不变的」末段明写这一点）。
  - `FR-5`（版本配对）、`FR-6`（开发覆盖 `PERSIMMON_HOST`）、`FR-7`（本机无
    Node 时开板失败）、`FR-8`（开发态构建须设开发覆盖）、`FR-11`（校验和）
    **作废**：前四条的前提是「命令与服务是两个产物、命令自己不是 Node 程序」，
    末一条的对象 `install.sh` 与 Release 归档一并删除。五条**均有仓内引用**，
    故 **id 就地留存**为墓碑条目，不重编号、不留空号。
  - `FR-10`（取得形态）是**改写**不是作废——它有替代形态：今天只有仓库检出
    （`npm pack` tarball 或 `npm link`），发布之后是 `npx` 与 `npm i -g`
    （`design-00004` §8）。一条需求有替代形态就该改写，作废会让「怎么取得」
    在需求层失去归属。
  - `FR-1`、`FR-2`、`FR-9` 存续：入口、子命令集、退出码、`version`、`help`
    （`decision-00020` §5）。`FR-2` 本轮据实写明退出码是 **1**，`FR-9` 的
    版本号来源改为本包 `package.json`。
  - **新增四条**（`design-00004` §3 / §6 逐条记着其取舍与实测）：`FR-12`
    （用法与解析错误退 **2**，与 `FR-2` 的未知子命令退 1 是两回事）、`FR-13`
    （非法 `PORT` 报一句并拒绝，不 `listen(NaN)`、不悄悄折回缺省）、`FR-14`
    （`update` / `list-langs` / `version` / `help` 的分发排在注册表路径与
    `PORT` 解析之前）、`FR-15`（解析之前把单横杠长旗标规范化为双横杠，八条
    子命令一律）。`FR-13` 与 `FR-14` 是迁入前的 Go 实现里已有、而本 spec 从未
    落过的可观察行为；`FR-12` 与 `FR-15` 不是——它们**统一了迁入前分裂的解析
    形态，是对迁入前行为的变更**，变了什么逐项写在两条自己的正文里
    （第三十二轮的审计据编排者裁定：`FR-15` 本轮才补，此前它只以 `new` 一条的
    形态写在 `spec-00013-FR-1` 里；`FR-12` 原写作「据实记录」，不实）。
  - AC 层：`AC-1.1` … `AC-2.2`、`AC-3.4`、`AC-4.1` … `AC-4.4`、`AC-9.2` 据实
    校正措辞（行为不变，id 保留）；`AC-3.1`、`AC-3.3`、`AC-9.1`、`AC-9.3`、
    `AC-10.1`、`AC-10.2` 随其条目改写；`AC-3.2`（stderr 的**转发**）、
    `AC-5.1` … `AC-8.2`、`AC-10.3`（无 Node 的机器上子命令照常）、
    `AC-11.1` … `AC-11.5` 共十六条**退出验收集**，id 就地留存作墓碑，供
    `record-00035`、`plan-00033`（已 `wontfix`）与 `issue-00038` 的既有引用解析；
    **新增** `AC-12.1` … `AC-12.6`、`AC-13.1` … `AC-13.3`、`AC-14.1` …
    `AC-14.3`、`AC-15.1` / `AC-15.2`（其中 `AC-12.3` … `AC-12.6`、`AC-13.3`
    与 `FR-15` 的两条是第三十二轮的审计补入的：`FR-12` 四支只有两条 AC、
    `AC-13.2` 一条 Given 塞了两个边界、`FR-15` 本轮才立条）。
  - 与 `record-00035` 第三十二轮追注的对照：**两处口径现已一致**。该追注同批
    已被改正，现按两种归宿分列——**作废保 id**：`AC-3.2`（断言转发本身）、
    `AC-5.1` / `AC-5.2`、`AC-10.3`、`AC-11.1` … `AC-11.5`；**改写后继续存在**：
    `AC-3.1` / `AC-3.3` / `AC-3.4`、`AC-4.1` … `AC-4.4`、`AC-10.1` / `AC-10.2`
    ——与上一条的分法逐条相同。这些改写后存续的条目在单进程形态下重新表述，
    其读数由后续 plan 的新验收记录取得，`record-00035` 记的是那次验收的结果、
    不是现行需求（第三十二轮的审计据实改：本条原写作「这是本轮与该记录的唯一
    读数差异，不需要改动该记录」，那是该记录被改正之前的读法）。
  - 其余：§6 增两条边界（Windows 不在支持范围；不引入 `up` / `down`）、
    §7 的实测清单据实改写（承载者是 `scripts/test-install.js`）、§5 与 Links
    据实更新。
- **2026-09-08 由编排者代域主裁定、本轮仍然有效的四项**（`AUTOPILOT.md`，
  `decided_by: agent` 的口径）：`help` / `-h` / `--help` 留在封闭子命令集内；
  像路径的首参按未知子命令拒绝（`FR-2`）；同类关停信号第二次到达并入进行中的
  那一次收尾（`FR-4`）；`parent` 取 `prd-00003-multi-workspace`。第五项
  「安装脚本的校验和不一致即中止安装」随 `FR-11` 一并作废，其在迁入前安装脚本
  上的已知偏离（best-effort 只告警）也随 `install.sh` 的删除而无对象——原
  §1 记的那条「迁入的 plan 须先开 issue 再改」的义务随之撤销
  （`issue-00038` 留 `resolved`，其修复对象已不存在）。
- 本 spec 不改任何 workspace 内部的行为：服务本体、HTTP/WS API、
  `whiteboard.config.yaml` 契约与注册表格式一字不变（`decision-00020`
  §4「不变的」）。

## 2. Stories

| Story | Value | Delivers |
| --- | --- | --- |
| S1 | 作为文档负责人，我只想装一个东西、记一个名字：建项目、跟模板升级、看模板、开板全在同一条命令下，敲错子命令或写错用法都得到一句能照着改的话，而我已经在用的写法（长旗标写一个横杠）到哪条子命令上都还能用 | spec-00012-FR-1, spec-00012-FR-2, spec-00012-FR-12, spec-00012-FR-15 |
| S2 | 作为文档负责人，我敲 `persimmon` 就得到白板：服务的输出我看得见，Ctrl-C 能干净收尾，退出码是真的 | spec-00012-FR-3, spec-00012-FR-4 |
| S3 | 作为文档负责人，`PORT` 我写错了就要一句话告诉我，而不是悄悄开在别处或崩一串堆栈 | spec-00012-FR-13 |
| S4 | 作为文档负责人，看模板、跟模板升级、查版本、看用法这四件事不该因为一个我从不用的目录或一个写错的 `PORT` 而做不成 | spec-00012-FR-14 |
| S5 | 作为文档负责人，我知道从哪里取得这条命令，也知道手上这一份是哪个版本 | spec-00012-FR-9, spec-00012-FR-10 |

## 3. Business Rules

| Rule set | Doc | Covers |
| --- | --- | --- |
| Docs 工作流 | [rule-00001-docs-workflow](../rule/rule-00001-docs-workflow.md) | 不因本 spec 而变；本 spec 不新增业务规则——命令、进程与分发都是软件概念，拿掉软件后不存在 |

## 4. System Requirements

**已作废的条目**：`FR-5` … `FR-8` 与 `FR-11` 的对象随第三十二轮的形态回退消失，
五条只作 id 的墓碑留存（正文见各条），**不计入本 spec 的需求集，也不欠验收
条目**；它们的 AC 同样只作墓碑，见 §Acceptance 开头的一句说明。留 id 而不抹去，
是因为 `design-00004` §3、`plan-00033`（已 `wontfix`）、`issue-00038` 与
`record-00035` 都引着它们，抹掉会让既有引用无从解析（沿 `spec-00011` 第三十一 /
三十二轮 `AC-20.3` / `AC-21.3` / `AC-21.4` 的先例）。

- **spec-00012-FR-1** (Ubiquitous) 系统应以单一命令 `persimmon` 承担全部命令行
  入口，其子命令集封闭为 `new`、`update`、`list-langs`、`add`、`remove`、
  `list`、`version`（含 `-v` / `--version`）、`help`（含 `-h` / `--help`），
  加上无子命令的启动路径；不存在第二个命令行可执行体，任何一条子命令都不经由
  另一个二进制或另一个包执行。（该集合即 `decision-00020` §2 第 1 条列出的
  「`new` / `update` / `list-langs` / `add` / `remove` / `list` / `version` /
  `help` / 无子命令（启动或接入）」，与第三十一轮追注补入子命令集的
  `-h` / `--help`。**封闭**是字面意思：`up` / `down` 不在其内，见 §6。）
  `add` / `remove` / `list` 的行为由 `spec-00011-FR-2` … `spec-00011-FR-6`、
  `spec-00011-FR-18`、`spec-00011-FR-21` 持有，`new` / `update` /
  `list-langs` 的行为由 `spec-00013-persimmon-scaffold` 持有；本 spec 持有的是
  这些子命令同属一个可执行体这件事。
- **spec-00012-FR-2** (Unwanted) 若第一个参数不是该集合中的子命令，系统应向
  stderr 指明该子命令未知（`unknown command "<它>"`）、随后打印用法，并以退出码
  **1** 退出，不建立任何目录、不读写注册表。一个看起来像路径的第一个参数同样
  落入本条——命令不把它读作「要打开的目录」。（第三十二轮据实写明退出码：本条
  原作「以非 0 退出」，而未知子命令退 1、用法与解析错误退 2 是两回事，
  见 `FR-12`；两者的口径取自迁入前的 Go 实现 `cli/main.go:168-171`，
  `design-00004` §2 的命令面表逐行记着。）**本条的判定排在 `PORT` 解析与
  注册表路径解析之前**（次序由 `FR-14` 持有），故 `PORT=abc persimmon frobnicate`
  报的是未知子命令而不是 `FR-13` 的那一句。这一点使本条无条件成立，也是对迁入前
  行为的变更：迁入前的 `default` 分支落在 `newCommand()` 之后
  （`cli/main.go:153-171`），端口先被校验，非法 `PORT` 下未知子命令报的是 PORT
  那一句（第三十二轮的审计据编排者裁定钉死这条次序）。
- **spec-00012-FR-3** (Event) 当执行 `persimmon`（无子命令）而该端口上没有已
  运行进程时，系统应**在本进程内**起白板服务并监听，不另起任何进程、不经包
  管理器取第二个产物；服务写出的 stdout 与 stderr **就是**本命令的 stdout 与
  stderr，中间没有转发这一层；命令在服务停止前不返回；服务停止后本进程随之
  退出，退出码即该次运行的结果——按 `FR-4` 正常收尾则 0，监听失败（探测之后
  端口被抢，`spec-00011-FR-15`）则非 0。可访问地址在服务开始监听后打印一次，
  命令不再自印一份。（第三十二轮据 `decision-00020` §5 改写：本条原文是「拉起
  白板服务、把服务的 stdout 与 stderr 原样转发、在服务退出后以服务的退出码
  退出」，那三件事都以命令与服务是两个进程为前提。单一 npm 产物下服务就在本
  进程内（`design-00004` §1 / §3），用户看见的输出与退出码不变，但转发、
  子进程退出码这两个机制已经没有对象，不能以「输出不变」留在需求文本里。）
  打开哪个 workspace、`PORT` 合法时的取值与已有已运行进程时的接入分别由
  `spec-00011-FR-13`、`spec-00011-FR-14` 持有。
- **spec-00012-FR-4** (Event) 当命令在自己所起的服务运行期间收到 `SIGINT` 或
  `SIGTERM` 时，系统应先按 `spec-00011-FR-16` 对每个 workspace 的每个运行中
  会话收尾，收尾完成后本进程才退出，不在收尾之前中止自己；同类信号第二次到达
  并入进行中的那一次收尾（幂等由 `spec-00011-FR-16` 持有），同样不使进程立即
  中止。命令**没有**在本进程内起服务时（接入一个已运行进程的那条路径上）收到
  同样的信号，它应只让自己立即退出——那个已运行进程是另一个进程，不受影响。
  （第三十二轮据 `decision-00020` §5 改写：本条原文是「把关停信号转发给该服务
  而不自行先退出，等它收尾完毕后以其退出码退出」。没有子进程可转发，信号直接
  送到唯一的那个进程；用户可见的行为——Ctrl-C 停、会话收尾、不留孤儿——一字
  不变，变的是「转发」这个动作不再存在。）
- **spec-00012-FR-5** (Ubiquitous) 【第三十二轮作废：版本配对】原条目断言「命令拉起的服务
  应与命令自身同一版本号，可观测为 `GET /api/instance` 的 `version` 等于
  `persimmon version` 的输出」。命令与服务是同一个包里的同一份代码，跑起来的
  服务必然与命令同版本——「配对」这个问题不存在（`design-00004` §3）。
  **无替代条目**；id 就地留存，供 `design-00004` §3 与 `plan-00033` 的既有
  引用解析（第三十二轮的审计逐条 grep 后据实改：本条原把 `record-00035` 也列为
  引用方，该记录只引 `FR-11`）。
- **spec-00012-FR-6** (Optional feature) 【第三十二轮作废：开发覆盖 `PERSIMMON_HOST`】原条目断言
  「开发覆盖被设置时改用它所指的本地服务而不取任何已发布的 host 包」。它的用途
  是让开发态的 Go 二进制指向本地检出；现在开发态跑的**就是**本地检出
  （`node bin/persimmon.js`），没有第二处可指（`design-00004` §3）。
  **无替代条目**；id 就地留存，供 `design-00004` §3 与 `plan-00033` 的既有
  引用解析（同上，据实改）。
- **spec-00012-FR-7** (Unwanted) 【第三十二轮作废：本机无 Node 时开板失败】原条目断言
  「若本机没有可用的 Node 运行时，应以一句话说明开板需要 Node 并以非 0 退出，
  其余子命令照常工作」。命令自己是 Node 程序，能执行到任何一行就已经有 Node
  （`design-00004` §3）；Node 版本下限由 `package.json` 的 `engines` 声明，
  命令不自己判版本。**无替代条目**；id 就地留存，供 `design-00004` §3 与
  `plan-00033` 的既有引用解析（同上，据实改）。
- **spec-00012-FR-8** (Unwanted) 【第三十二轮作废：开发态构建须设开发覆盖】原条目断言
  「版本号为 `dev` 且开发覆盖未设置时，无子命令的启动路径应报错退出」。它是
  `FR-5` 与 `FR-6` 的推论，  两者都已作废；本包没有「开发态构建」与「发布构建」
  两种形态之分。**无替代条目**；id 就地留存，供 `plan-00033`（`:255`、`:308`）
  的既有引用解析（第三十二轮的审计逐条 grep 后据实改：本条原把 `spec-00013` 与
  `record-00035` 也列为引用方，两者都不引本条）。
- **spec-00012-FR-9** (Ubiquitous) `persimmon version`（含 `-v` / `--version`）
  应打印命令自身的版本号，取自本包 `package.json` 的 `version`；取得形态
  （仓库检出、`npm pack` 的 tarball、全局安装、`npx`）不改变这个值。当前裁定是
  暂不发布任何版本，该值为 `0.0.0-dev`（`decision-00020` §2 第 6 条：不发布，
  `version` 保持 `0.0.0-dev`）。（第三十二轮改写：原文以「该值与 `FR-5` 版本
  配对所用的是同一个值」与「未经发布构建取得的命令打印 `dev`」两句为主，前者
  随版本配对作废，后者随「没有编译期注入、也没有两种构建形态」而不成立；
  现行口径见 `design-00004` §2 的 `version` 一行。）
- **spec-00012-FR-10** (Ubiquitous) 命令的取得形态应为本 npm 包的 bin，别无
  第二种：在发布之前只有本仓库检出——`npm ci && npm run build` 之后 `npm link`，
  或 `npm pack` 出 tarball 再安装；发布之后是
  `npx @ryan-alexander-zhang/persimmon` 与
  `npm i -g @ryan-alexander-zhang/persimmon`（`decision-00020` §2 第 6 条：
  不发布任何版本，分发形态为这两种；`design-00004` §8）。两种安装形态下命令
  行为相同，该断言由 `spec-00011-AC-20.2` 持有，其承载者是
  `scripts/test-install.js`（`npm run test:install`：`npm pack` 出 tarball，
  分别以 `npx` 形态与全局安装形态各跑一次 `persimmon list` 并逐字比对）。
  包名与 bin 名由 `spec-00011-FR-20` 持有。（第三十二轮据 `decision-00020` §5
  改写：原文的取得形态是「本仓库的安装脚本自动挑选 OS 与架构的发布归档，或从
  Release 页手工安装，**不经 npm 分发**」，并声称除开板外每条子命令在没有 Node、
  没有任何 npm 包的机器上照常工作。安装脚本、Release 归档与那台没有 Node 的机器
  一并消失——命令自己就是一个 npm 包里的 Node 程序。本条是改写而不是作废：
  取得形态有替代，只是换了一种。）
- **spec-00012-FR-11** (Unwanted) 【第三十二轮作废：安装归档的校验和】原条目断言「若所下
  归档的校验和与校验和文件所记的不一致，安装脚本应中止安装、以非 0 退出，且不
  在 PATH 上留下任何二进制；取不到校验和文件或本机没有校验工具时退让为一句
  警告」。`install.sh` 与 Release 归档随发布线一并删除（`decision-00020` §2
  第 6 条、`design-00004` §8），本条**没有替代对象**——单产物的 npm 分发由 npm
  自己的完整性校验承担，不是本命令的行为。id 就地留存，供 `issue-00038`
  （留 `resolved`，其修复对象已不存在）、`plan-00033`、`spec-00013` 与
  `record-00035` 的既有引用解析（四个引用方第三十二轮的审计逐一核过，属实）。
- **spec-00012-FR-12** (Unwanted) 若命令行参数不合式——未知旗标、旗标缺值、
  `--set` 的取值不是 `KEY=VALUE`、缺必需的位置参数、或解析完仍剩下未读的位置
  参数——系统应把该错误写到 stderr 并以退出码 **2** 退出，不建立任何目录、
  不读写注册表、不改动任何既有文件。本条与 `FR-2` 不同：那是命令未知，退 1；
  本条是命令认得而用法写错，退 2。**本条是解析器层的规则，作用于全部八个
  子命令**——含 `spec-00011` 持有的 `add` / `remove` / `list` 与 `spec-00013`
  持有的 `new` / `update` / `list-langs`：那两份 spec 只持有各自的错误话术，
  退出码在此一处立法（TS 侧的形态是 `util.parseArgs` 之后的统一断言，
  `design-00004` §2；`parseArgs` 只抛异常，须接住后照退 2，同文 §6「三处
  `util.parseArgs` 覆盖不到」的第三条）。
  **这是对迁入前行为的变更，不是据实记录**——迁入前的 Go 实现退出码是分裂的，
  逐项如下（第三十二轮的审计实测，`cli/main.go`）：`new` / `update` /
  `list-langs` 走 `FlagSet`（`flag.ExitOnError`），未知旗标、旗标缺值与
  `--set` 非 `KEY=VALUE` 退 **2**；`add` / `remove` / `list` 是手写解析，
  同类错误经 `refused()` → `fail()` 退 **1**（`:203-215`）；`new` 的剩余位置
  参数与缺 `<name>`、`remove` 的缺参数经 `report()` 退 **1**
  （`:193-199`、`:278-285`）；`list` 的多余位置参数则被静默吞掉、退 **0**
  （`:167` 的 `cmdList(c)` 根本不看 `args`）。TS 侧一律统一为 2，故
  `persimmon add --frobnicate`、`persimmon add --name`、`persimmon new demo extra`、
  `persimmon new`（缺 `<name>`）与 `persimmon remove`（缺参数）自 1 变 2，
  `persimmon list extra` 自 0 变 2——最后一条从被吞掉变为拒绝，是本条唯一改变
  「能不能跑通」的一处（第三十二轮的审计据编排者裁定：分裂的退出码不值得逐
  子命令复刻，代价是这几类调用的退出码变了，收益是八条子命令一个口径）。
  **旗标之间的组合不合法**（`spec-00013-FR-4` 的 `--variant` 未配 `--lang`
  是唯一一例）虽不在解析器那一层，也属本条的「命令认得而用法写错」，同样退 2
  ——迁入前它经 `report()` 退 1。裁定的枚举里没有单列这一支，此处一并纳入是为了
  不让同一条 FR 里出现两种退出码；这是本轮据编排者裁定的口径外推的一处，记此
  备核。
- **spec-00012-FR-13** (Unwanted) 若环境变量 `PORT` 有值而它不是一个端口号
  （不是整数、小于 1、或大于 65535），系统应报一句说明该取值不是端口号并以非 0
  退出，**不监听、不折回缺省端口、也不拿一个非数值去 listen**——悄悄服务在用户
  没要的地方，比一句话糟。本条对读端口的那条路径成立：无子命令的启动路径与
  `new` / `add` / `remove` / `list`（它们都要探测那个端口）；`FR-14` 列出的四条
  不读端口，不受本条影响。`PORT` 合法时的取值与缺省 4173 由 `spec-00011-FR-13`
  持有。（第三十二轮新增：这是迁入前 Go 实现 `resolvePort`（`cli/main.go:122-131`）
  的既有行为，其注释写着 *silently serving somewhere else than the user asked is
  worse than one sentence*；`design-00004` §3 裁定 TS 侧照搬，本 spec 此前从未
  为它立过条目。）本条只验拒绝的那一侧；**边界内取值能用**（`PORT=1`、
  `PORT=65535` 监听得起来）归 `spec-00011-FR-13`，那边只采了 `PORT=5000` 一格
  （`spec-00011-AC-13.6`），两个边界内取值**本轮未补**——补它要动 `spec-00011`，
  不在本轮范围，作为一条交付边界记此（第三十二轮的审计）。
- **spec-00012-FR-14** (Ubiquitous) `update`、`list-langs`、`version`、`help`
  四条子命令的分发应排在注册表路径解析与 `PORT` 解析**之前**：它们既不读注册表
  也不要端口，不应因为一个它们从不读的用户目录（不存在、不可读）或一个非法的
  `PORT`（`FR-13`）而失败。其余入口——无子命令的启动路径与 `new` / `add` /
  `remove` / `list`——照常在解析之后分发。（第三十二轮新增：迁入前 Go 实现的
  提前 switch（`cli/main.go:136-152`）注释即此，`design-00004` §3 明写这条次序
  在 TS 侧同样必须保持——`FR-13` 新加的 `PORT` 校验正是会让 `persimmon help`
  无端失败的那种前置，排序把它挡在外面。）**未知子命令的判定（`FR-2`）同样排在
  这两处解析之前**：它不是「子命令内的用法错误」，一个连子命令都不是的第一参数
  不该先撞上 `PORT` 的校验（第三十二轮的审计据编排者裁定补入这一支——迁入前的
  `default` 分支落在 `newCommand()` 之后，`PORT=abc persimmon frobnicate` 报的
  是 PORT 那一句；提前之后 `FR-2` 无条件成立）。
- **spec-00012-FR-15** (Ubiquitous) 系统应在解析之前把**单横杠长旗标**规范化
  为双横杠：`-lang go` 与 `--lang go`、`-lang=go` 与 `--lang=go`、`-name x` 与
  `--name x` 结果相同。这条规范化在**解析器层，作用于全部八个子命令**，不限于
  `new`；单字符短旗标不受影响——`-v` / `-h` 仍是 `FR-1` 子命令集里的那两个，
  不被改写成 `--v` / `--h`。（第三十二轮的审计据编排者裁定补入：迁入前的 Go
  `flag` 对 `-lang` 与 `--lang` 一视同仁，而 `util.parseArgs` 抛
  `ERR_PARSE_ARGS_UNKNOWN_OPTION`，`design-00004` §6 的裁定是在调 `parseArgs`
  **之前**规范化——那是解析器层的裁定，本 spec 此前只让 `spec-00013-FR-1` 在
  `new` 一条上写了它。**本条同样是对迁入前行为的变更**：迁入前 `add` /
  `remove` / `list` 是手写解析、只认双横杠，`persimmon add -name foo` 今天按
  未知旗标被拒，此后可用。`spec-00013-FR-1` 与 `spec-00013-AC-1.9` 现引本条，
  不另立一份。）

**Acceptance (GWT)**

**不计入本验收集的墓碑条目**：`AC-3.2`、`AC-5.1`、`AC-5.2`、`AC-6.1`、`AC-6.2`、
`AC-7.1`、`AC-7.2`、`AC-7.3`、`AC-8.1`、`AC-8.2`、`AC-10.3`、`AC-11.1` …
`AC-11.5` 共十六条的断言对象已随第三十二轮的形态回退消失，它们只作 id 的墓碑
留存，供 `record-00035`、`plan-00033`（已 `wontfix`）与 `issue-00038` 的既有引用
解析——**不作为任何 FR 的验收条目计数**。存续与新增的条目各自的验收由
`AC-1.1` / `AC-1.2`（FR-1）、`AC-2.1` / `AC-2.2`（FR-2）、`AC-3.1` / `AC-3.3` /
`AC-3.4`（FR-3）、`AC-4.1` … `AC-4.4`（FR-4）、`AC-9.1` … `AC-9.3`（FR-9）、
`AC-10.1` / `AC-10.2`（FR-10）、`AC-12.1` … `AC-12.6`（FR-12）、`AC-13.1` …
`AC-13.3`（FR-13）、`AC-14.1` … `AC-14.3`（FR-14）、`AC-15.1` / `AC-15.2`
（FR-15）承担。墓碑仍写成完整的条目
声明形态（含归属标注）是**故意的**：`docs/spec/README.md` 的条目文法没有「墓碑」
这个标记位，唯一能让一行不被解析为验收条目的办法是不以粗体 id 起头，而那会让
引它们的 `record` 行变成断链（`decision-00005` §1 记的正是这一类事故）。沿
`spec-00011` 的先例保留声明形态，在此以一句话说明它们不计入。

- **spec-00012-AC-1.1** (spec-00012-FR-1)
  Given 只装了 `persimmon` 这一个可执行体，本机没有第二个命令行产物
  When 执行 `persimmon list-langs`（一条由 `spec-00013` 持有其行为的子命令）
  Then 它照常列出模板——脚手架子命令不经另一个二进制、也不经另一个包执行
  （第三十二轮的审计据实收紧：原 Given 作「PATH 上没有 `ainpt`」，
  那个可执行体已无对象）
- **spec-00012-AC-1.2** (spec-00012-FR-1)
  Given 命令已装好
  When 执行 `persimmon help`
  Then 输出的子命令清单恰为 `FR-1` 列出的那些，不多不少（既没有 `up` / `down`，
  也没有 `config`）
- **spec-00012-AC-2.1** (spec-00012-FR-2)
  Given 命令已装好，注册表有一条已登记的 workspace
  When 执行 `persimmon frobnicate`
  Then 命令向 stderr 指明该子命令未知、打印用法并以退出码 1 退出，注册表不变
- **spec-00012-AC-2.2** (spec-00012-FR-2)
  Given 当前目录下有目录 `./some-project`
  When 执行 `persimmon ./some-project`
  Then 命令按未知子命令拒绝并以退出码 1 退出，不把它读作要打开的目录
- **spec-00012-AC-3.1** (spec-00012-FR-3)
  Given 该端口上没有已运行进程
  When 在某项目内执行 `persimmon`
  Then 命令自己在该端口进入监听态、在服务停止前不返回，服务打印的可访问地址
  出现在命令自己的 stdout 上（第三十二轮的审计据实收紧：原 Then 末句「进程表里
  没有第二个 persimmon 进程」在单进程形态下重述的是 `FR-1`，不是采样本条）
- **spec-00012-AC-3.2** (spec-00012-FR-3)
  Given 原断言「由本命令拉起的服务向自己的 stderr 写的一行诊断，出现在命令的
  stderr 上而不是被吞掉或混进 stdout」（转发的正确性）
  When 命令与服务成为同一个进程，两者的 stderr 是同一个流，转发这一层不复存在
  （第三十二轮）
  Then 该断言只剩「一个进程写自己的 stderr」这一重述，自第三十二轮起退出验收集，
  **无替代条目**——id 就地留存，供 `record-00035` 的既有引用解析
- **spec-00012-AC-3.3** (spec-00012-FR-3)
  Given 探测判该端口空闲，而 `listen` 时它已被别的进程抢走（`spec-00011-FR-15`
  的 EADDRINUSE 兜底）
  When 监听失败
  Then 命令以非 0 退出——它既不留在前台，也不改用另一个端口
- **spec-00012-AC-3.4** (spec-00012-FR-3)
  Given 该端口上已有一个已运行进程在监听
  When 执行 `persimmon`
  Then 命令不在本进程内起服务、本进程不进入监听态，命令返回而不停在前台
  （接入的输出与退出码由 `spec-00011-FR-14` 持有；第三十二轮的审计据实收紧：
  原 Then 的「也不另起一个」重述的是 `FR-1`）
- **spec-00012-AC-4.1** (spec-00012-FR-4)
  Given 服务在本进程内跑着，某 workspace 有一个运行中会话
  When 进程收到 `SIGINT`
  Then 该会话按 `spec-00011-FR-16` 收尾，进程在收尾完成前不退出
- **spec-00012-AC-4.2** (spec-00012-FR-4)
  Given 服务在本进程内跑着
  When 进程收到 `SIGTERM`
  Then 会话同样收尾，进程在收尾完成后退出
- **spec-00012-AC-4.3** (spec-00012-FR-4)
  Given 收尾正在进行中
  When 进程再收到一次 `SIGINT`
  Then 不产生第二次收尾、也不立即中止，进程在第一次收尾完成后退出
- **spec-00012-AC-4.4** (spec-00012-FR-4)
  Given 一个已运行进程在监听，命令正走接入路径（本进程内没有服务）
  When 命令收到 `SIGINT`
  Then 命令自己立即退出，那个已运行进程仍在监听、其会话不受影响
- **spec-00012-AC-5.1** (spec-00012-FR-5)
  Given 原断言「命令由发布归档取得、本机从未取得过 host 包时，`GET /api/instance`
  的 `version` 与 `persimmon version` 的输出相同」
  When `FR-5` 的版本配对随两产物形态一并作废（第三十二轮）
  Then 该断言无对象可断言，自第三十二轮起退出验收集，**无替代条目**——id 就地
  留存，供 `record-00035` 与 `plan-00033` 的既有引用解析
- **spec-00012-AC-5.2** (spec-00012-FR-5)
  Given 原断言「本机已存在一个与命令版本不同的 host 包版本时，起来的仍是与命令
  同版本的那一个」
  When 同 `AC-5.1`：没有 host 包，也没有第二个版本可选
  Then 该断言随之失效，自第三十二轮起退出验收集，**无替代条目**——id 就地留存，
  供 `record-00035` 的既有引用解析
- **spec-00012-AC-6.1** (spec-00012-FR-6)
  Given 原断言「开发覆盖指向一份已构建好的本地检出时，起的是该检出的服务」
  When `FR-6` 的开发覆盖 `PERSIMMON_HOST` 随两产物形态一并作废（第三十二轮）
  Then 该断言无对象可断言，自第三十二轮起退出验收集，**无替代条目**——id 就地
  留存，供 `record-00035` 的既有引用解析
- **spec-00012-AC-6.2** (spec-00012-FR-6)
  Given 原断言「未设开发覆盖且命令是发布构建时，起的是与命令同版本的已发布
  host 包」
  When 同 `AC-6.1`：没有 host 包，也没有「发布构建」这一形态
  Then 该断言随之失效，自第三十二轮起退出验收集，**无替代条目**——id 就地留存，
  供 `record-00035` 的既有引用解析
- **spec-00012-AC-7.1** (spec-00012-FR-7)
  Given 原断言「本机没有可用的 Node 运行时时，开板以一句话说明并以非 0 退出」
  When `FR-7` 随「命令自己就是 Node 程序」一并作废（第三十二轮）
  Then 该断言无对象可断言，自第三十二轮起退出验收集，**无替代条目**——id 就地
  留存，供 `record-00035` 的既有引用解析
- **spec-00012-AC-7.2** (spec-00012-FR-7)
  Given 原断言「本机没有可用的 Node 运行时时，`persimmon new demo` 照常建出并
  登记」
  When 同 `AC-7.1`：没有 Node 的机器上这条命令根本起不来
  Then 该断言随之失效，自第三十二轮起退出验收集，**无替代条目**——id 就地留存，
  供 `record-00035` 与 `plan-00033` 的既有引用解析
- **spec-00012-AC-7.3** (spec-00012-FR-7)
  Given 原断言「本机没有可用的 Node 运行时时，`persimmon update` 照常合并」
  When 同 `AC-7.1`
  Then 该断言随之失效，自第三十二轮起退出验收集，**无替代条目**——id 就地留存，
  供 `record-00035` 与 `plan-00033` 的既有引用解析
- **spec-00012-AC-8.1** (spec-00012-FR-8)
  Given 原断言「`persimmon version` 打印 `dev` 且开发覆盖未设置时，开板报错退出」
  When `FR-8` 随 `FR-5` / `FR-6` 一并作废（第三十二轮）
  Then 该断言无对象可断言，自第三十二轮起退出验收集，**无替代条目**——id 就地
  留存，供 `record-00035` 的既有引用解析
- **spec-00012-AC-8.2** (spec-00012-FR-8)
  Given 原断言「同一情形下 `persimmon list` 照常工作——只拦无子命令的启动路径」
  When 同 `AC-8.1`：没有这条拦截
  Then 该断言随之失效，自第三十二轮起退出验收集。它想守的那件事（子命令不因
  启动路径的前置而失败）由 `FR-14` 与 `AC-14.1` … `AC-14.3` 以另一种形态承担，
  但断言不同，不作替代——id 就地留存，供 `record-00035` 的既有引用解析
- **spec-00012-AC-9.1** (spec-00012-FR-9)
  Given 命令自本仓库检出取得（`package.json` 的 `version` 为 `0.0.0-dev`）
  When 执行 `persimmon version`
  Then 打印的版本号与 `package.json` 的 `version` 相同
- **spec-00012-AC-9.2** (spec-00012-FR-9)
  Given 命令已装好
  When 分别执行 `persimmon -v` 与 `persimmon --version`
  Then 两者的输出与 `persimmon version` 相同
- **spec-00012-AC-9.3** (spec-00012-FR-9)
  Given 同一份代码打成 `npm pack` 的 tarball 后全局安装
  When 执行 `persimmon version`
  Then 打印的仍是 `package.json` 里的那个值——取得形态不改变版本号的来源
- **spec-00012-AC-10.1** (spec-00012-FR-10)
  Given 本仓库检出，已 `npm ci && npm run build`
  When 执行 `npm link` 后在任意目录执行 `persimmon version`
  Then 命令可执行——发布之前这是取得它的方式
- **spec-00012-AC-10.2** (spec-00012-FR-10)
  Given 本包打成的一个 `npm pack` tarball
  When 分别以 `npx` 形态与全局安装形态各执行一次 `persimmon list`
  Then 两者都可执行且输出逐字相同（该比对由 `spec-00011-AC-20.2` 持有，承载者是
  `scripts/test-install.js`；本条断言的是两种形态都取得到这条命令）
- **spec-00012-AC-10.3** (spec-00012-FR-10)
  Given 原断言「一台没有 Node、没有任何 npm 包的机器上，除开板外每条子命令照常
  工作」
  When 取得形态改为本包的 npm bin，命令自己就是一个 Node 程序（第三十二轮）
  Then 该断言无对象可断言，自第三十二轮起退出验收集，**无替代条目**——id 就地
  留存，供 `record-00035` 的既有引用解析
- **spec-00012-AC-11.1** (spec-00012-FR-11)
  Given 原断言「所下归档的校验和与校验和文件不一致时，安装脚本中止安装、以非 0
  退出，PATH 上不留下 `persimmon`」
  When `install.sh` 与 Release 归档随发布线一并删除（第三十二轮）
  Then 该断言无对象可断言，自第三十二轮起退出验收集，**无替代条目**——id 就地
  留存，供 `record-00035`、`issue-00038` 与 `plan-00033` 的既有引用解析
- **spec-00012-AC-11.2** (spec-00012-FR-11)
  Given 原断言「校验和文件取到了但其中没有该归档那一行时，同样中止安装」
  When 同 `AC-11.1`
  Then 该断言随之失效，自第三十二轮起退出验收集，**无替代条目**——id 就地留存，
  供 `record-00035` 的既有引用解析
- **spec-00012-AC-11.3** (spec-00012-FR-11)
  Given 原断言「该归档那一行不合式（校验和字段不是一串十六进制）时，同样中止
  安装」
  When 同 `AC-11.1`
  Then 该断言随之失效，自第三十二轮起退出验收集，**无替代条目**——id 就地留存，
  供 `record-00035` 的既有引用解析
- **spec-00012-AC-11.4** (spec-00012-FR-11)
  Given 原断言「校验和文件取不到时，脚本给出一句未能校验的警告并照常装好」
  When 同 `AC-11.1`
  Then 该断言随之失效，自第三十二轮起退出验收集，**无替代条目**——id 就地留存，
  供 `record-00035` 与 `issue-00038` 的既有引用解析
- **spec-00012-AC-11.5** (spec-00012-FR-11)
  Given 原断言「本机既没有 `sha256sum` 也没有 `shasum` 时，脚本告警并照常装好」
  When 同 `AC-11.1`
  Then 该断言随之失效，自第三十二轮起退出验收集，**无替代条目**——id 就地留存，
  供 `record-00035` 的既有引用解析
- **spec-00012-AC-12.1** (spec-00012-FR-12)
  Given 命令已装好
  When 执行 `persimmon new demo --set A`（`--set` 的取值不是 `KEY=VALUE`）
  Then 命令报出该用法错误并以退出码 2 退出，不建立任何目录
- **spec-00012-AC-12.2** (spec-00012-FR-12)
  Given 注册表有一条已登记的 workspace
  When 执行 `persimmon add --frobnicate`（未知旗标；`add` 的行为由
  `spec-00011` 持有，本条采的是本 FR 覆盖全部八个子命令这一面）
  Then 命令以退出码 2 退出、注册表不变——与 `AC-2.1` 的未知子命令退 1 相区别，
  且**与迁入前不同**：迁入前手写解析的 `add` 同一场景退 1
- **spec-00012-AC-12.3** (spec-00012-FR-12)
  Given 注册表有一条已登记的 workspace
  When 执行 `persimmon add --name`（旗标缺值）
  Then 命令以退出码 2 退出、注册表不变——迁入前退 1
- **spec-00012-AC-12.4** (spec-00012-FR-12)
  Given 注册表有一条已登记的 workspace
  When 执行 `persimmon list extra`（解析完剩下一个未读的位置参数）
  Then 命令报该用法错误并以退出码 2 退出，不打印列表——迁入前这个参数被静默
  吞掉、命令照常列出并退 0，本条是本 FR 唯一改变「能不能跑通」的一处
- **spec-00012-AC-12.5** (spec-00012-FR-12)
  Given 命令已装好，当前目录下没有任何新目录
  When 执行 `persimmon new`（缺必需的位置参数 `<name>`）
  Then 命令打印该子命令的用法并以退出码 2 退出，未建立任何目录——迁入前退 1
- **spec-00012-AC-12.6** (spec-00012-FR-12)
  Given 注册表有一条已登记的 workspace
  When 执行 `persimmon remove`（缺必需的位置参数）
  Then 命令报该用法错误并以退出码 2 退出、注册表不变——迁入前退 1
- **spec-00012-AC-13.1** (spec-00012-FR-13)
  Given 环境变量 `PORT=abc`
  When 在某项目内执行 `persimmon`
  Then 命令报一句说明该取值不是端口号并以非 0 退出，没有任何端口被监听
- **spec-00012-AC-13.2** (spec-00012-FR-13)
  Given 环境变量 `PORT=65536`（上界外一格）
  When 执行 `persimmon add`
  Then 命令报同一句并以非 0 退出、注册表不变——不折回缺省的 4173
- **spec-00012-AC-13.3** (spec-00012-FR-13)
  Given 环境变量 `PORT=0`（下界外一格）
  When 执行 `persimmon add`
  Then 命令报同一句并以非 0 退出、注册表不变（第三十二轮的审计拆出：原
  `AC-13.2` 一条 Given 里塞了 65536 与 0 两个边界）
- **spec-00012-AC-14.1** (spec-00012-FR-14)
  Given 环境变量 `PORT=abc`
  When 执行 `persimmon help`
  Then 打印用法并以 0 退出——它从不读端口，不因 `FR-13` 的校验失败
- **spec-00012-AC-14.2** (spec-00012-FR-14)
  Given 用户目录不可读，注册表路径解析不出来
  When 执行 `persimmon list-langs`
  Then 命令照常列出模板并以 0 退出——它从不读注册表
- **spec-00012-AC-14.3** (spec-00012-FR-14)
  Given 环境变量 `PORT=abc`
  When 执行 `persimmon list`
  Then 命令按 `FR-13` 以非 0 退出——`list` 要探测端口，不在提前分发的那四条里
- **spec-00012-AC-15.1** (spec-00012-FR-15)
  Given 注册表为空，`/work/alpha` 是一个项目
  When 执行 `persimmon add /work/alpha -name alpha`（长旗标只写一个横杠，
  且这条子命令由 `spec-00011` 持有）
  Then 结果与 `--name alpha` 相同——规范化在解析器层，不限于 `new`；迁入前
  手写解析的 `add` 把 `-name` 按未知旗标拒绝
- **spec-00012-AC-15.2** (spec-00012-FR-15)
  Given 命令已装好
  When 执行 `persimmon -v`
  Then 打印版本号（`FR-9`）——单字符短旗标不被规范化成 `--v`，这是规范化
  只作用于长旗标的边界

## 5. Technical Design

| Design | Doc | Covers |
| --- | --- | --- |
| 一个包一个进程的形态、命令面与退出码、同进程监听与 `PORT` 校验、分发次序、包结构与取得形态 | [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md) §1 / §2 / §3 / §6 / §7 / §8 | 全部现行 FR 的实现结构 |

`design-00004` 已声明 `informs` 本 spec，并已于第三十二轮原地重写——节号
§1…§11 保留、内容全换，全部现行；本 spec 的每处 `design-00004` §N 引用都指向
重写后的那一节。启动握手的判定表是 `design-00003-multi-workspace` §8，由
`spec-00011` 持有；本 spec 经 `design-00004` §2 / §3 引用它，不另开一份契约。

## 6. Out of Scope

- **`spec-00013-persimmon-scaffold` 持有的**：`new` / `update` / `list-langs`
  的全部行为与旗标、`template.json` 的处置、创建标记、`new` 完成后的登记闭环
  与其失败处置。本 spec 只持有它们同属一个可执行体（`FR-1`）、用法与解析错误的
  退出码（`FR-12`）、单横杠长旗标的规范化（`FR-15`）与其中两条的分发次序
  （`FR-14`）——末三条都在解析器层、作用于全部八个子命令，故立法在本 spec，
  `spec-00013` 引它们。
- **`spec-00011-multi-workspace` 持有的**：注册表的位置、格式与整份校验
  （`spec-00011-FR-1`、`spec-00011-FR-18`）；`add` / `remove` / `list` 的行为
  （`spec-00011-FR-2` … `spec-00011-FR-5`、`spec-00011-FR-21`）；可用性判定
  （`spec-00011-FR-6`）；启动路径登记与打开哪个 workspace、`PORT` 合法时的取值
  （`spec-00011-FR-13`——含 `PORT` 边界**内**取值 `1` / `65535` 能用的验收，
  那边只采了 `PORT=5000` 一格，本轮未补，见 `FR-13` 末句的交付边界）；已有
  已运行进程时的接入（`spec-00011-FR-14`）；端口被
  他人占用与登记失败的拒绝（`spec-00011-FR-15`）；关停时对每个 workspace 每个
  会话的收尾扇出（`spec-00011-FR-16`）；npm 包名与 bin 名（`spec-00011-FR-20`）。
- `config` 子命令（`decision-00020` §2 第 7 条 ⑥：`config` 与白板界面里的
  workspace 创建不在该决定范围内，故也不在本 spec 的子命令集内）。
- `up` / `down` 子命令（`decision-00020` §3 否决、域主 2026-09-09 确认不做：
  `down` 要再写一遍探活与终止阶梯，而前台进程 Ctrl-C 即停；只留 `up` 则与既有的
  「无子命令即启动」两种做法做同一件事）。
- 白板界面里的 workspace 创建（届时由 Host 直接调用同进程的脚手架模块，
  `decision-00020` §2 第 8 条）。
- **Windows**：支持平台仅 linux 与 darwin（`decision-00020` §2 第 10 条，域主
  2026-09-09 裁定）。三条理由：模板产出的项目带 `CLAUDE.md -> AGENTS.md` 符号
  链接，Windows 上建链接要 Developer Mode 或提权；解归档改用外壳 `tar`
  （`design-00004` §6），它在 Windows 上不保证存在；node-pty 在 Windows 从未
  实测。本 spec 的每一条需求都以这两个平台为准。
- 发布线：当前裁定是暂不发布任何版本（`decision-00020` §2 第 6 条），
  `.goreleaser.yaml` / `install.sh` / `release.yml` 一并删除
  （`design-00004` §8）。本 spec 只持有用户侧的取得形态（`FR-10`）；真要发布时
  是一个产物、一条 `npm publish`，那条 workflow 由届时的 plan 写。
- 旧 npm 包的 `npm deprecate`（无对象：该包名从未发布过，`decision-00020` 的
  plan 轮追注）与 ainpt 仓库的归档及其 README 改写（`decision-00020` §2
  第 7 条 ①）。
- 缓存取得的安装形态下 pty 能否起（`spec-00011-AC-20.3` 与
  `issue-00030-npx-leaves-the-pty-spawn-helper-non-executable`）：其承载者是
  `scripts/test-install.js`（`spec-00011` §7），不在本 spec。

## 7. Non-Functional

- **实测义务**（仓库内无从确认，故不写成 FR 断言）：`FR-10` 的取得形态由
  `scripts/test-install.js` 承载，本轮它有**三格**——`npm link`（`npm ci &&
  npm run build && npm link` 之后在任意目录跑 `persimmon version`，`AC-10.1`
  在此取得读数）、`npx` 形态与全局安装形态（同一个 `npm pack` tarball 各跑一次
  `persimmon list` 并逐字比对，`AC-10.2` 在此取得读数）；同一脚本还承载
  `spec-00011-AC-20.2` 与那一格真 pty，见 `spec-00011` §7 与 `design-00004` §7。
  `npm link` 那一格是第三十二轮的审计据编排者裁定补入的：`AC-10.1` 的场景就是
  `npm link`，而重写后的脚本原只有 npx 与全局安装两格，那条 AC 因此无处取数。`FR-4` 的信号收尾在真终端与无 TTY
  两种情形下各一次（`AC-4.1` … `AC-4.4`）——它现在是一个进程内的
  `host.shutdown()`，不再有跨进程转发要验，但「Ctrl-C 之后没有孤儿进程、会话
  已 commit」仍只在实测里看得见。这些条目在对应实测通过前不计已验证。
  （第三十二轮改写：原清单里「命令与它拉起的服务之间的 stdio 与信号透传」与
  「安装脚本在 linux 与 darwin 各一次，含校验和不一致时的中止」两项，前者的
  跨进程部分、后者整项都随其对象消失。）
- **覆盖率门**：`FR-1` / `FR-2` / `FR-3` / `FR-4` / `FR-9` / `FR-10` / `FR-12` /
  `FR-13` / `FR-14` / `FR-15` 的实现全部落在 `src/cli.ts`（含自 `bin/` 挪进来的
  约 200 行握手代码，`design-00004` §6），它与脚手架**同受** `vitest.config.ts`
  的 90% 行 / 分支 / 函数三项门槛——同一道门，本 spec 与 `spec-00013` §7 一个
  口径。`bin/persimmon.js` 保持薄入口正是为了它不成为这道门的逃逸口：
  **`bin/` 里不得有「读 `process.argv`、调 `lib/cli.js`、以其返回码退出」之外
  的逻辑**。（第三十二轮的审计据编排者裁定补入：`spec-00013` §7 认领了 `src/`
  的门槛而本 spec 只字未提，命令层落在门内这件事在需求层此前无人认领。）
- **回归约束**：`spec-00001` … `spec-00011` 的全部既有验收不因命令合一而变。
- 单产物下开板不再取任何包，也就没有第一次开板的冷启动等待（原条目所记的
  「取一次 host 包、多几秒」随 `npx` 一并消失）。启动路径之外的子命令不加载
  服务端模块图——`persimmon list` 的启动时间不为一个它用不到的白板服务买单
  （`design-00004` §11 的动态 `import()`）。**这一条的承载者是一条断言 `list`
  路径上不求值服务端模块图的测试**，断的是「模块图未被求值」这个事实，不是一个
  计时阈值（第三十二轮的审计据编排者裁定给它定的承载者：本节此前只有它没有
  承载者）。

## Links

- Parent: [prd-00003-multi-workspace](../prd/prd-00003-multi-workspace.md)
- Decision: [decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md)（它的 `constrains` 列出本 spec；spec 不携带 `implements`，`docs/README.md` 关系规则）
- 第三十二轮: [decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md) 的第三十二轮追注（语言与分发形态回退，单一 npm 产物）与 §5 对本 spec 的逐条裁定
- Design: [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md)（第三十二轮原地重写，节号保留、内容全换） · [design-00003-multi-workspace](../design/design-00003-multi-workspace.md) §8（经 `design-00004` 引用）
- 并列 spec: [spec-00013-persimmon-scaffold](spec-00013-persimmon-scaffold.md) · [spec-00011-multi-workspace](spec-00011-multi-workspace.md)（分界见 §6）
- Issue: [issue-00030-npx-leaves-the-pty-spawn-helper-non-executable](../issue/issue-00030-npx-leaves-the-pty-spawn-helper-non-executable.md) · [issue-00038-install-script-installs-an-archive-it-could-not-verify](../issue/issue-00038-install-script-installs-an-archive-it-could-not-verify.md)（留 `resolved`，其修复对象 `install.sh` 已随第三十二轮删除）
- Record: [record-00035-persimmon-command-acceptance](../record/record-00035-persimmon-command-acceptance.md)（其第三十二轮追注与本 spec §1 的对照见该节末条）
- Rules: [rule-00001-docs-workflow](../rule/rule-00001-docs-workflow.md)（不变）
