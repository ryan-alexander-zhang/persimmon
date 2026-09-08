---
id: spec-00012-persimmon-command
type: spec
status: active
parent: prd-00003-multi-workspace
implements: [decision-00020-unified-go-cli]
---

# Spec: `persimmon` 命令——一个入口，一条命令开板

> 一条命令承担全部命令行入口；无子命令时它拉起白板服务、转发服务的输出、把
> 关停信号转发进去、以服务的退出码退出，并保证拉起的服务与自己同一版本。
> 命令的取得不经 npm，除开板之外一律不需要 Node。脚手架三个子命令与 `new` 的
> 登记闭环由 `spec-00013-persimmon-scaffold` 持有；结构由 `decision-00020`
> 定、`design-00004` 持有。

## 1. Context

- canonical terms 见 `CONTEXT.md`：**persimmon 命令**、**host 包**、
  **已运行进程**、**workspace**、**workspace 注册表**、**切换器**、
  **版本配对**（本 spec `FR-5` 持有；裸词「配对」是 _Avoid_，词汇表中另指
  `supersedes` 的成对判定）、**开发覆盖**（`FR-6`；开发态构建下它是开板的
  前置，`FR-8`）。本 spec 内「服务」指 host 包提供的白板服务本体，不新增术语。
- 输入与权威：[decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md)
  与其形状文档 [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md)
  （命令面、拉起 host、版本配对、代码位置与发布线）。`design-00004` 已声明
  `informs` 本 spec——那条边在树里，不是待办。
- `parent` 为 [prd-00003-multi-workspace](../prd/prd-00003-multi-workspace.md)：
  该 PRD 第三十一轮修订后 In scope 的「单命令启动」即本 spec 的启动侧（其功能
  需求 5 明写「一条命令从任何目录启动、已有进程时不起第二个」，并把命令的
  安装与发布点名交由本 spec 持有）。
- **与 `spec-00011-multi-workspace` 的分工**（同一条启动路径的两半）：
  `spec-00011-FR-13` 持有**结果**——在项目内执行时登记该目录并以它为打开的
  workspace、打开哪一个、`PORT` 如何取值；`spec-00012-FR-3` 持有**命令与服务
  之间的关系**——拉起、stdio 透传、谁打印地址、以服务的退出码退出。
  `spec-00011-FR-14` 持有该端口上已有已运行进程时的接入与输出；
  `spec-00011-FR-15` 持有启动路径上端口被他人占用与经进程登记失败的拒绝。
  `spec-00011-AC-20.3`（缓存取得的 host 包下会话能起）落在
  `issue-00030-npx-leaves-the-pty-spawn-helper-non-executable` 的验证记录里，
  不在本 spec——`design-00004` §3 明写不新增实测义务。
- **与 `spec-00013-persimmon-scaffold` 的分界**：`new` / `update` /
  `list-langs` 的行为与 `new` 的登记闭环全部在那份 spec；本 spec 只持有
  「这些子命令同属一个可执行体」这件事（`FR-1`）与命令的取得形态（`FR-10`、
  `FR-11`）。逐条边界在 §6。
- **本稿的未决由编排者于 2026-09-08 代域主裁定**（`AUTOPILOT.md`，
  `decided_by: agent` 的口径），正文按裁定写定、不留 Open Questions：
  `help` / `-h` / `--help` 留在封闭子命令集内（`CONTEXT.md` 与
  `decision-00020` 的对应补写由编排者安排）；像路径的首参按未知子命令拒绝
  （`FR-2`）；同类关停信号第二次到达照样转发（`FR-4`）；安装脚本的校验和
  **不一致即中止安装**（`FR-11`）；`parent` 取 `prd-00003-multi-workspace`。
- **`FR-11` 的校验和口径改变了迁入前安装脚本的现状**（现状是 best-effort：
  校验不过只打警告并继续装）。这是一处已知偏离：迁入的 plan 须为它开一份
  `docs/issue` 并先写出失败的测试，再改（`AGENTS.md` §8）。
- 本 spec 不改任何 workspace 内部的行为：服务本体、HTTP/WS API、
  `whiteboard.config.yaml` 契约与注册表格式一字不变（`decision-00020`
  §4「不变的」）。

## 2. Stories

| Story | Value | Delivers |
| --- | --- | --- |
| S1 | 作为文档负责人，我只想装一个东西、记一个名字：建项目、跟模板升级、看模板、开板全在同一条命令下，敲错子命令得到一句能照着改的话 | spec-00012-FR-1, spec-00012-FR-2 |
| S2 | 作为文档负责人，我敲 `persimmon` 就得到白板：服务的输出我看得见，Ctrl-C 能干净收尾，退出码是真的 | spec-00012-FR-3, spec-00012-FR-4 |
| S3 | 作为文档负责人，起来的服务永远是跟我这条命令同版本的那一个；开发本仓库时我要能指向本地检出 | spec-00012-FR-5, spec-00012-FR-6, spec-00012-FR-8, spec-00012-FR-9 |
| S4 | 作为文档负责人，没有 Node 的机器上我至少还能建项目和跟模板升级，开不了板时得到一句话而不是一串堆栈 | spec-00012-FR-7 |
| S5 | 作为文档负责人，我装它只要一条命令，而且我要知道装进来的二进制没被人动过 | spec-00012-FR-10, spec-00012-FR-11 |

## 3. Business Rules

| Rule set | Doc | Covers |
| --- | --- | --- |
| Docs 工作流 | [rule-00001-docs-workflow](../rule/rule-00001-docs-workflow.md) | 不因本 spec 而变；本 spec 不新增业务规则——命令、子进程与分发都是软件概念，拿掉软件后不存在 |

## 4. System Requirements

- **spec-00012-FR-1** (Ubiquitous) 系统应以单一命令 `persimmon` 承担全部命令行
  入口，其子命令集封闭为 `new`、`update`、`list-langs`、`add`、`remove`、
  `list`、`version`（含 `-v` / `--version`）、`help`（含 `-h` / `--help`），
  加上无子命令的启动路径；不存在第二个命令行可执行体，任何一条子命令都不经由
  另一个二进制或 npm bin 执行。（该集合即 `decision-00020` §2 第 2 条列出的
  七个子命令与无子命令启动，**加上 `help` / `-h` / `--help`——那一条是本 spec
  在决定之外的补充**，取自迁入前的命令现状，已由编排者裁定保留。）
  `add` / `remove` / `list` 的行为由 `spec-00011-FR-2` … `spec-00011-FR-6`、
  `spec-00011-FR-18`、`spec-00011-FR-21` 持有，`new` / `update` /
  `list-langs` 的行为由 `spec-00013-persimmon-scaffold` 持有；本 spec 持有的是
  这些子命令同属一个可执行体这件事。
- **spec-00012-FR-2** (Unwanted) 若第一个参数不是该集合中的子命令，系统应指明
  该子命令未知、打印用法并以非 0 退出，不建立任何目录、不读写注册表。一个看
  起来像路径的第一个参数同样落入本条——命令不把它读作「要打开的目录」。
- **spec-00012-FR-3** (Event) 当执行 `persimmon`（无子命令）而该端口上没有已
  运行进程时，系统应拉起白板服务，把服务的 stdout 与 stderr 原样转发到本命令的
  对应流，在服务运行期间不返回，并在服务退出后以服务的退出码退出。可访问地址
  由服务打印，命令不再自印一份。打开哪个 workspace、`PORT` 的取值与已有已运行
  进程时的接入分别由 `spec-00011-FR-13`、`spec-00011-FR-14` 持有。
- **spec-00012-FR-4** (Event) 当命令在等待它拉起的服务期间收到 `SIGINT` 或
  `SIGTERM` 时，系统应把关停信号转发给该服务而不自行先退出，等服务按
  `spec-00011-FR-16` 收尾完毕后再以其退出码退出（`FR-3`）；同类信号第二次到达
  照样转发，并入进行中的那一次收尾（幂等由 `spec-00011-FR-16` 持有）。命令
  **没有**子进程时（接入一个已运行进程的那条路径上）收到同样的信号，它应只让
  自己立即退出、不向任何进程转发——那个已运行进程不是它的子进程，不受影响。
- **spec-00012-FR-5** (Ubiquitous) 命令拉起的服务应与命令自身同一版本号
  （版本配对），可观测为 `GET /api/instance` 的 `version` 等于 `persimmon version`
  的输出；本机上存在该 host 包的其他版本时不改变这一点。达成版本配对的手段（编译期
  注入、发布线的先后）由 `design-00004` §3 / §8 持有。接入一个**已在运行**的
  进程时不比版本（`design-00004` §9）——版本配对约束的是本命令拉起的那一个。
- **spec-00012-FR-6** (Optional feature) 当开发覆盖被设置时（环境变量
  `PERSIMMON_HOST`，其取值形态与前置条件由 `design-00004` §3 持有），系统应改用
  它所指的本地服务而不取任何已发布的 host 包，此时不要求 `FR-5` 的版本配对成立；
  未设置它时走版本配对路径，但开发态构建下**没有可与之配对的已发布版本**，按 `FR-8`
  失败。
- **spec-00012-FR-7** (Unwanted) 若本机没有可用的 Node 运行时，系统应以一句话
  说明开板需要 Node 并以非 0 退出，不拉起任何服务；`new`、`update`、
  `list-langs`、`version`、`add`、`remove` 不做这项检查、在无 Node 的机器上
  照常工作。`list` 在无已运行进程且取不到 Node 时的退让由 `spec-00011-FR-21`
  与 `design-00004` §4 持有。
- **spec-00012-FR-8** (Unwanted) 若命令是开发态构建（`FR-9` 的版本号为 `dev`）
  且开发覆盖未设置，无子命令的启动路径应以一句话说明开发态开板须指定开发覆盖
  并以非 0 退出，不拉起任何服务、不取任何已发布的 host 包——开发态没有可与之配对的
  已发布版本，猜一个会静默破坏 `FR-5`。其余子命令不受此限。
- **spec-00012-FR-9** (Ubiquitous) `persimmon version`（含 `-v` / `--version`）
  应打印命令自身的版本号，该值与 `FR-5` 版本配对所用的是同一个值；未经发布构建取得
  的命令打印 `dev`（此形态下开板须满足 `FR-8`）。
- **spec-00012-FR-10** (Ubiquitous) 命令的取得形态应为二者之一：本仓库的安装
  脚本（自动挑选本机 OS 与架构的发布归档、校验后装入 PATH 上的目录）或从本仓库
  的 Release 页下载对应平台的归档手工安装；**不经 npm 分发**。安装脚本覆盖
  linux 与 darwin，其余平台由 Release 归档覆盖。装好后除开板（`FR-7`、`FR-8`）
  之外的每条子命令在没有 Node、没有任何 npm 包的机器上照常工作。npm 包与其
  bin 名的归属由 `spec-00011-FR-20` 持有；发布线的形状与校验和文件如何产出由
  `design-00004` §8 持有。
- **spec-00012-FR-11** (Unwanted) 若所下归档的校验和与校验和文件所记的不一致，
  安装脚本应中止安装、以非 0 退出，且不在 PATH 上留下任何二进制——不一致是归档
  被动过的证据。校验和文件取到了却没有该归档那一行、或那一行不合式，同样按
  不一致处置（无法确认即不装）。只有在校验和文件取不到、或本机没有可用的校验
  工具时，脚本才退让为一句未能校验的警告并继续安装——那是本机少一件东西，不是
  归档有问题。

**Acceptance (GWT)**

- **spec-00012-AC-1.1** (spec-00012-FR-1)
  Given 机器上只装了 `persimmon` 这一个可执行体，PATH 上没有 `ainpt`
  When 执行 `persimmon list-langs`
  Then 命令列出模板，不需要 PATH 上有任何其他可执行体
- **spec-00012-AC-1.2** (spec-00012-FR-1)
  Given 命令已装好
  When 执行 `persimmon help`
  Then 输出的子命令清单恰为 `FR-1` 列出的那些，不多不少
- **spec-00012-AC-2.1** (spec-00012-FR-2)
  Given 命令已装好，注册表有一条已登记的 workspace
  When 执行 `persimmon frobnicate`
  Then 命令指明该子命令未知、打印用法并以非 0 退出，注册表不变
- **spec-00012-AC-2.2** (spec-00012-FR-2)
  Given 当前目录下有目录 `./some-project`
  When 执行 `persimmon ./some-project`
  Then 命令按未知子命令拒绝并以非 0 退出，不把它读作要打开的目录
- **spec-00012-AC-3.1** (spec-00012-FR-3)
  Given 该端口上没有已运行进程，本机有可用的 Node
  When 在某项目内执行 `persimmon`
  Then 服务被拉起并监听，命令不返回，服务打印的可访问地址出现在命令的 stdout 上
- **spec-00012-AC-3.2** (spec-00012-FR-3)
  Given 由本命令拉起的服务向自己的 stderr 写了一行诊断
  When 观察命令的输出流
  Then 该行出现在命令的 stderr 上，而不是被吞掉或混进 stdout
- **spec-00012-AC-3.3** (spec-00012-FR-3)
  Given 由本命令拉起的服务因端口在探测与监听之间被抢而以非 0 退出
  When 服务退出
  Then 命令以同一个退出码退出
- **spec-00012-AC-3.4** (spec-00012-FR-3)
  Given 该端口上已有一个已运行进程在监听
  When 执行 `persimmon`
  Then 命令不拉起第二个服务（接入的输出与退出码由 `spec-00011-FR-14` 持有）
- **spec-00012-AC-4.1** (spec-00012-FR-4)
  Given 由本命令拉起的服务在跑，某 workspace 有一个运行中会话
  When 命令收到 `SIGINT`
  Then 服务收到关停信号并按 `spec-00011-FR-16` 收尾，命令在服务退出前不退出
- **spec-00012-AC-4.2** (spec-00012-FR-4)
  Given 由本命令拉起的服务在跑
  When 命令收到 `SIGTERM`
  Then 服务同样收到关停信号并收尾
- **spec-00012-AC-4.3** (spec-00012-FR-4)
  Given 由本命令拉起的服务正在收尾
  When 命令再收到一次 `SIGINT`
  Then 该信号照样转发，不产生第二次收尾，命令在第一次收尾完成后退出
- **spec-00012-AC-4.4** (spec-00012-FR-4)
  Given 一个已运行进程在监听，命令正走接入路径、尚未打印地址（它没有子进程）
  When 命令收到 `SIGINT`
  Then 命令自己立即退出，那个已运行进程仍在监听、其会话不受影响
- **spec-00012-AC-5.1** (spec-00012-FR-5)
  Given 命令由发布归档取得，本机从未取得过 host 包
  When 在某项目内执行 `persimmon`，随后读 `GET /api/instance`
  Then 其 `version` 与 `persimmon version` 的输出相同
- **spec-00012-AC-5.2** (spec-00012-FR-5)
  Given 本机已存在一个与命令版本不同的 host 包版本
  When 执行 `persimmon`
  Then 起来的仍是与命令同版本的那一个，`/api/instance` 的 `version` 等于 `persimmon version`
- **spec-00012-AC-6.1** (spec-00012-FR-6)
  Given 开发覆盖指向一份已构建好的本地检出
  When 执行 `persimmon`
  Then 起的是该检出的服务，命令不取任何已发布的 host 包
- **spec-00012-AC-6.2** (spec-00012-FR-6)
  Given 未设开发覆盖，命令是发布构建
  When 执行 `persimmon`
  Then 起的是与命令同版本的已发布 host 包
- **spec-00012-AC-7.1** (spec-00012-FR-7)
  Given 本机没有可用的 Node 运行时，命令是发布构建
  When 在某项目内执行 `persimmon`
  Then 命令以一句话说明开板需要 Node 并以非 0 退出，不拉起任何服务
- **spec-00012-AC-7.2** (spec-00012-FR-7)
  Given 本机没有可用的 Node 运行时
  When 执行 `persimmon new demo`
  Then 项目照常建出并登记，命令以 0 退出
- **spec-00012-AC-7.3** (spec-00012-FR-7)
  Given 本机没有可用的 Node 运行时，当前目录是一个带创建标记的项目
  When 执行 `persimmon update`
  Then 命令照常合并，不检查 Node
- **spec-00012-AC-8.1** (spec-00012-FR-8)
  Given `persimmon version` 打印 `dev`，开发覆盖未设置，本机有可用的 Node
  When 执行 `persimmon`
  Then 命令以一句话说明须指定开发覆盖并以非 0 退出，未拉起任何服务、未取任何已发布的 host 包
- **spec-00012-AC-8.2** (spec-00012-FR-8)
  Given `persimmon version` 打印 `dev`，开发覆盖未设置
  When 执行 `persimmon list`
  Then 命令照常工作——本条只拦无子命令的启动路径
- **spec-00012-AC-9.1** (spec-00012-FR-9)
  Given 命令由某次发布的归档取得
  When 执行 `persimmon version`
  Then 打印的版本号与该次发布的版本号相同
- **spec-00012-AC-9.2** (spec-00012-FR-9)
  Given 命令已装好
  When 分别执行 `persimmon -v` 与 `persimmon --version`
  Then 两者的输出与 `persimmon version` 相同
- **spec-00012-AC-9.3** (spec-00012-FR-9)
  Given 命令由未经发布的本地构建取得
  When 执行 `persimmon version`
  Then 打印 `dev`
- **spec-00012-AC-10.1** (spec-00012-FR-10)
  Given 一台 linux 或 darwin 机器，未装过本命令，归档的校验和与校验和文件一致
  When 跑本仓库的安装脚本
  Then `persimmon` 落在 PATH 上的一个目录里且可执行
- **spec-00012-AC-10.2** (spec-00012-FR-10)
  Given 一台安装脚本不支持的平台
  When 用户从 Release 页取对应平台的归档并解出其中的二进制
  Then `persimmon version` 可执行
- **spec-00012-AC-10.3** (spec-00012-FR-10)
  Given 一台没有 Node、没有任何 npm 包的机器，命令已装好
  When 依次执行 `persimmon new demo`、`persimmon update`、`persimmon list-langs`、`persimmon version`、`persimmon add`、`persimmon remove`
  Then 每条都照常工作，无一因缺 Node 失败
- **spec-00012-AC-11.1** (spec-00012-FR-11)
  Given 所下归档的校验和与校验和文件所记的不一致
  When 跑本仓库的安装脚本
  Then 安装中止、脚本以非 0 退出，PATH 上没有留下 `persimmon`
- **spec-00012-AC-11.2** (spec-00012-FR-11)
  Given 校验和文件取到了，但其中没有该归档那一行
  When 跑本仓库的安装脚本
  Then 安装中止、脚本以非 0 退出，PATH 上没有留下 `persimmon`
- **spec-00012-AC-11.3** (spec-00012-FR-11)
  Given 校验和文件取到了，但该归档那一行不合式（校验和字段不是一串十六进制）
  When 跑本仓库的安装脚本
  Then 安装中止、脚本以非 0 退出，PATH 上没有留下 `persimmon`
- **spec-00012-AC-11.4** (spec-00012-FR-11)
  Given 校验和文件取不到（发布只出了归档），归档本身可下载
  When 跑本仓库的安装脚本
  Then 脚本给出一句未能校验的警告并照常装好 `persimmon`
- **spec-00012-AC-11.5** (spec-00012-FR-11)
  Given 校验和文件可取，但本机既没有 `sha256sum` 也没有 `shasum`
  When 跑本仓库的安装脚本
  Then 脚本给出一句未能校验的警告并照常装好 `persimmon`

## 5. Technical Design

| Design | Doc | Covers |
| --- | --- | --- |
| `persimmon` 命令与 host 包的分工、命令面、拉起 host 与版本配对、代码位置与发布线 | [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md) | 全部 FR 的实现结构 |

`design-00004` 已声明 `informs` 本 spec。启动握手的判定表是
`design-00003-multi-workspace` §8，由 `spec-00011` 持有；本 spec 经
`design-00004` §2 / §3 引用它，不另开一份契约。

## 6. Out of Scope

- **`spec-00013-persimmon-scaffold` 持有的**：`new` / `update` / `list-langs`
  的全部行为与旗标、`template.json` 的处置、创建标记、`new` 完成后的登记闭环
  与其失败处置。本 spec 只持有它们同属一个可执行体这件事（`FR-1`）。
- **`spec-00011-multi-workspace` 持有的**：注册表的位置、格式与整份校验
  （`spec-00011-FR-1`、`spec-00011-FR-18`）；`add` / `remove` / `list` 的行为
  （`spec-00011-FR-2` … `spec-00011-FR-5`、`spec-00011-FR-21`，含 `list` 的
  五态与无 Node 时退回四态那一支）；可用性判定（`spec-00011-FR-6`）；启动路径
  登记与打开哪个 workspace、`PORT` 的取值（`spec-00011-FR-13`）；已有已运行
  进程时的接入（`spec-00011-FR-14`）；端口被他人占用与经进程登记失败的拒绝
  （`spec-00011-FR-15`）；关停时对每个 workspace 每个会话的收尾扇出
  （`spec-00011-FR-16`）；npm 包名与 bin 名（`spec-00011-FR-20`）。
- `config` 子命令（`decision-00020` §2 第 7 条不在其范围内，故也不在本 spec 的
  子命令集内）。
- 白板界面里的 workspace 创建（届时由 Host 以子进程调 `persimmon new`，
  `decision-00020` §2 第 7 条）。
- 发布线的实现：一个 tag 触发两个产物、workflow 的形状与先后、归档命名、
  校验和文件如何产出——`design-00004` §8。本 spec 只持有用户侧的取得形态与
  安装时对校验和的处置（`FR-10`、`FR-11`）。
- 旧 npm 包 `@ryan-alexander-zhang/persimmon` 的 `npm deprecate`、ainpt 仓库的
  归档与其 README 改写（`decision-00020` §4）。
- Windows 上的开板：开板继承 host 包的平台支持（`design-00004` §6，node-pty 在
  Windows 未实测）。
- 缓存取得的 host 包下 pty 能否起（`spec-00011-AC-20.3` 与
  `issue-00030-npx-leaves-the-pty-spawn-helper-non-executable` 的验证记录）：
  `design-00004` §3 明写不新增实测义务。

## 7. Non-Functional

- **实测义务**（仓库内无从确认，故不写成 FR 断言，清单在 `design-00004` §10）：
  命令与它拉起的服务之间的 stdio 与信号透传（`FR-3`、`FR-4`）在无 TTY 与离线
  两种情形下各一次；安装脚本在 linux 与 darwin 各一次，含校验和不一致时的中止
  （`FR-10`、`FR-11`）。`spec-00012-AC-3.1` … `spec-00012-AC-3.3`、
  `spec-00012-AC-4.1` … `spec-00012-AC-4.4`、`spec-00012-AC-10.1`、
  `spec-00012-AC-10.2`、`spec-00012-AC-11.1` … `spec-00012-AC-11.5` 在对应实测
  通过前不计已验证。
- **回归约束**：`spec-00001` … `spec-00011` 的全部既有验收不因命令合一而变。
- 第一次开板要取一次 host 包，冷启动多几秒（`decision-00020` §4）；不设离线
  兜底。

## Links

- Parent: [prd-00003-multi-workspace](../prd/prd-00003-multi-workspace.md)
- Decision: [decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md)（本 spec `implements` 它）
- Design: [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md) · [design-00003-multi-workspace](../design/design-00003-multi-workspace.md) §8（经 `design-00004` 引用）
- 并列 spec: [spec-00013-persimmon-scaffold](spec-00013-persimmon-scaffold.md) · [spec-00011-multi-workspace](spec-00011-multi-workspace.md)（分界见 §6）
- Issue: [issue-00030-npx-leaves-the-pty-spawn-helper-non-executable](../issue/issue-00030-npx-leaves-the-pty-spawn-helper-non-executable.md)
- Rules: [rule-00001-docs-workflow](../rule/rule-00001-docs-workflow.md)（不变）
