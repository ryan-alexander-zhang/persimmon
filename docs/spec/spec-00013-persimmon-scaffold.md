---
id: spec-00013-persimmon-scaffold
type: spec
status: active
parent: prd-00003-multi-workspace
---

# Spec: `persimmon` 的脚手架——new / update / list-langs 与登记闭环

> `new` 从模板仓库的一个分支建出项目、写下创建标记、并把它登记为 workspace；
> `update` 把模板此后的改动三方合并回项目而保住本地改动；`list-langs` 列出
> 可用模板。登记在 `new` 里闭环，模板仓库不再需要知道白板的存在。行为取自
> 迁入前的 ainpt——`decision-00020` §2 第 3 条要求「`new` / `update` 的语义、
> 参数（`--lang` / `--variant` / `--dir` / `--ref` / `--set`）、三方合并算法、
> `.ainpt.json` 的内容与文件名一律不变」，四处已修缺陷按更正后的行为写定、
> 且不得随移植重现（§1）。
>
> **本 spec 经第三十二轮修订（2026-09-09）：需求内容整体存续，实现语言自 Go
> 变为 TypeScript**（`decision-00020` §5 逐字：「需求内容整体存续，实现语言从
> Go 变为 TS」）。变的只是承载——脚手架落在 `src/`、测试跑 vitest；另有五条
> 实测得出的技术约束（`exclude` 的 glob 语义、`--set` 的 `KEY=VALUE` 校验、
> 单横杠长旗标、无 `git` 时的半截树、`list-langs` 不做速率处理）与两条平台
> 事实（支持范围仅 linux 与 darwin、外壳 `tar` 是前置依赖）本轮进入需求层。

## 1. Context

- canonical terms 见 `CONTEXT.md`：**persimmon 命令**、**已运行进程**、
  **workspace**、**workspace 注册表**、**切换器**。
- 本 spec 新增术语（拟，接收后进 `CONTEXT.md`）：
  - **模板仓库（Template Repository）**：`new` 与 `update` 取材的那个仓库，其
    每个分支是一个模板（`main` 为基础模板、`lang/<l>` 为语言模板、
    `lang/<l>/<v>` 为变体模板），每个分支自带 `template.json` 描述自己的
    脚手架。缺省坐标是源码里的常量，可由环境变量覆盖（`FR-1`）——第三十二轮
    据实改：没有编译期，「编译期钉死」是 Go 的 ldflags 概念
    （`design-00004` §6 对照表末行），`CONTEXT.md` 的同名词条同批已改。
    _Avoid_：脚手架仓库、骨架库、ai-native-project-template（那是缺省坐标的
    具体值，不是概念名）。
  - **创建标记（Creation Marker）**：`new` 在新项目根目录写下的一份文件，记住
    项目来自哪个模板仓库、哪个 ref、创建时的哪个提交与哪些变量；`update` 以
    它记下的提交为三方合并的基准。文件名永久沿用 `.ainpt.json`
    （`decision-00020` §2 第 7 条 ③：改名会让全部既有项目的 `update` 失效）。
    _Avoid_：锁文件、lock（那是实现里的类型名）、清单、配置。
  - **模板管辖文件（Template-managed File）**：当前上游模板分支里存在、且未被
    **该分支**的 `template.json` 的 `exclude` 命中的文件；只有它们参与
    `update` 的合并，项目自有的文件一律不动。
    _Avoid_：受管文件、模板文件（歧义：也可指 `template.json` 本身）。
  - **基准（Merge Base）**：创建标记里记下的那个模板提交；`update` 的三方合并
    以它为共同祖先，合并成功后它被推进为本次的上游提交（`FR-9`）。
    _Avoid_：基线、上次的版本。
- 输入与权威：[decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md)
  的决定表——**该表第三十二轮被整体重写，旧表的编号与新表不对应，故本 spec
  引它时连内容一起写**（该文 §2 顶上的行号警告）：第 1 条「一个 `persimmon`
  命令承担全部命令行入口，命令即本 npm 包的 bin，不引入第二种实现语言、不引入
  第二个产物」、第 3 条「脚手架移植为 TypeScript 落在 `src/`，移植面按**函数**
  而非目录计，`new` / `update` 的语义、参数、三方合并算法、`.ainpt.json` 的
  内容与文件名一律不变」、第 4 条「移植不得让 `issue-00034` / `00035` /
  `00036` / `00037` 的缺陷重现，四条各留一条引其 issue id 的回归测试，其中第四条
  在 TS 侧实现为解析器层的统一断言」、第 8 条「界面创建到来时 Host 直接调用
  同进程的脚手架模块」、第 10 条「支持平台仅 linux 与 darwin，Windows 明写在
  支持范围外」。形状取
  [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md)
  §2（命令面与参数解析）/ §5（`new` 的登记闭环）/ **§6（代码位置与移植面，
  含 Go→TS 机制对照表——本次移植的技术权威，本 spec 第三十二轮新增的五条技术
  约束逐条源出于它）**。迁入前行为的事实取自独立仓库 ainpt 的 `README.md`、
  `main.go` 与 `internal/scaffold/scaffold.go`；那些文件名只作史源，不再是本
  spec 任何一条需求的坐标。
- **第三十二轮的修订源**（2026-09-09）：`decision-00020` 的原地修订（见其
  **第三十二轮追注**）与随之原地重写的 `design-00004`。域主推翻了「用 Go、
  两个产物」的形态，改为单一 npm 产物。本 spec 的裁定是
  `decision-00020` §5 那一行——「需求内容整体存续，实现语言从 Go 变为 TS」。
  逐条动作：
  - **FR-1 … FR-14 的行为语义一条未改**，70 条既有 AC **一条未删、一条未改**
    ——承载它们的测试自 `go test` 换成 vitest，那不改 AC 的断言，也就不需要动
    AC 的文本。`record-00035` 与已 `wontfix` 的 `plan-00033` 引着其中大部分 id，
    本轮因此没有产生任何墓碑条目。
  - 改写的三处：`FR-4` 的多余位置参数拒绝扩及全部三个脚手架子命令（`update`
    的同类缺陷本轮才有归属，见下）、并写明 `--set` 的报错原文；`FR-11` 列全
    模板坐标不合式的四种形态；`FR-12` 把「半截更新、不回滚」明写出来（原先
    只由 `AC-12.1` / `AC-12.2` 规定，留给读者推断）。`FR-1` 与 `FR-14` 各加
    一句既有形态的保全条款（单横杠长旗标、不做速率处理），不改既有断言。
    **本轮的审计其后又改了这两处的立法归属**（编排者裁定）：剩余位置参数的
    统一断言与单横杠长旗标都在解析器层、作用于全部八个子命令，分别由
    `spec-00012-FR-12` 与 `spec-00012-FR-15` 持有，`FR-4` 与 `FR-1` 改为引它们
    ——本 spec 不再各立一份，也不再把作用面限定为三个脚手架子命令；退出码同理
    （`spec-00012-FR-12`：一律 2），本 spec 只持有报出的是哪一句。
  - 新增三条需求：`FR-15`（`exclude` 的 glob 匹配语义）、`FR-16`（不合式的
    `exclude` 模式按不匹配处理）、`FR-17`（外壳 `tar` 前置），各带 AC
    （`AC-15.1` … `AC-15.7`、`AC-16.1` / `AC-16.2`、`AC-17.1` / `AC-17.2`）；
    另补 `AC-1.9`（单横杠长旗标）、`AC-4.5`（`update` 的多余位置参数）、
    `AC-11.6`（`owner/`）、`AC-12.3`（半截树不回滚）、`AC-14.4`（不退避不重试）
    五条白；本轮的审计另补 `AC-15.6`（带尾斜杠的模式经字面串前缀命中）与
    `AC-15.7`（前缀那一半不是 glob）两条，见 `FR-15`。本轮后共 17 条 FR、
    86 条 AC。
  - §5 的 design 清单拆为三行并把 §6 点为代码位置与移植面的唯一权威；
    §6 增 Windows 一条；§7 的覆盖率口径自 Go 的 legacy 记债改为 `src/` 的
    vitest 门槛，并写明支持矩阵与两个外部前置的实测义务。
  - **不拆分**：`docs/spec/README.md` 的两条尺寸触发器本轮都响了（正文过
    500 行；本轮新增了三条需求）。逐条看过后仍判为一个 feature——三条新需求
    都是既有行为（`exclude` 的匹配、解归档）在换实现时才必须写明的约束，
    不是新能力；Stories 仍是同一个增量。故本轮按修订处理，不开新 spec。
- `parent` 为 [prd-00003-multi-workspace](../prd/prd-00003-multi-workspace.md)：
  该 PRD 第三十一轮修订后的功能需求 6 明确要求「`persimmon new` 在脚手架完成后
  **自己**登记新项目」，功能需求 1 说明登记走的正是 `add` 那条路径——本 spec 是
  它的需求形态；该 PRD 已把脚手架那一半点名交给本 spec——那些指针在树里，
  不是待办。
- **与 `spec-00012-persimmon-command` 的分界**：那份 spec 持有入口与子命令集、
  无子命令的启动路径（同进程起服务、信号、退出码）、`version` 与命令的取得
  形态；本 spec 持有 `new` / `update` / `list-langs` 三个子命令与 `new` 的
  登记闭环。原先列在那边的版本配对与缺 Node 的失败随两产物形态一并作废
  （`decision-00020` §5 对 `spec-00012` 的逐条裁定，其修订由那份 spec 自己的
  修订轮落地），本 spec 不代它陈述。逐条边界在 §6。
- **登记语义不在本 spec 重述**：`FR-6` 走的是 `persimmon add` 那条路径，其幂等、
  `id` 派生、路径规范化与可登记判定由 `spec-00011-FR-2` / `spec-00011-FR-3`
  持有，注册表不合式的判定由 `spec-00011-FR-18` 持有。
- **本稿的未决由编排者于 2026-09-08 代域主裁定**（`AUTOPILOT.md`，
  `decided_by: agent` 的口径），正文按裁定写定、不留 Open Questions：`update`
  缺 `git` 时不做合并前预检（`FR-12`）；创建标记永久沿用 `.ainpt.json`、不做
  迁移（`FR-3`）；`AINPT_OWNER` / `AINPT_REPO` 保留（`FR-1`）；`new` 的登记
  无关闭途径（`FR-6`）；`parent` 取 `prd-00003-multi-workspace`。
- **四条已修缺陷按更正后的行为写定，且不得随移植重现**（`decision-00020`
  §2 第 4 条：「移植不得让 `issue-00034` / `00035` / `00036` / `00037` 的缺陷
  重现……四条各留一条引其 issue id 的回归测试」）。四条各自的需求归属：
  - `issue-00034`——创建标记的模板坐标须过「恰一个斜杠、owner 非空、repo 非空」
    三条件校验：`FR-11`，验收 `AC-11.4`（`/repo`）、`AC-11.5`
    （`owner/repo/extra`）、`AC-11.6`（`owner/`，本轮补）。
  - `issue-00035`——只有变体而没有 `lang/<l>` 基础分支的语言不印那条
    `--lang <l>` 行：`FR-13`，验收 `AC-13.3`。
  - `issue-00036`——`list-langs` 跟随 `Link: rel="next"` 取完所有分支：
    `FR-13`，验收 `AC-13.4`。
  - `issue-00037`——解析完不得剩余未读的位置参数：`FR-4`，验收 `AC-4.4`
    （`new`）与本轮补的 `AC-4.5`（`update`）。TS 侧的实现形态是
    **解析器层的统一断言**（`design-00004` §2），故本轮把 `FR-4` 的这一支
    自 `new` 扩及三个脚手架子命令，一并覆盖 `issue-00037` §4 记下的
    `cmdUpdate` 同类缺陷——那条延期原挂在 `plan-00033` T2b，随该 plan 转
    `wontfix` 而失效，本轮之前在需求层无人认领。
  四条的回归测试各须逐字引其 issue id（回归约束见 §7）。同批盘出的另一处偏离
  是安装脚本的校验和（`spec-00012-FR-11`）：`install.sh` 随 `decision-00020`
  §2 第 6 条删除，它连同其需求一并没有对象，不在本 spec 的四条之内。
- 本 spec 不改任何 workspace 内部的行为，也不改模板仓库的 `template.json`
  （`decision-00020` §4「不变的」）。

## 2. Stories

| Story | Value | Delivers |
| --- | --- | --- |
| S1 | 作为文档负责人，我要从任意模板分支建项目、把变量一次讲清、模板说不要的东西一件也别落地，参数写错或机器少个工具时得到一句能照着改的说明而不是半个项目 | spec-00013-FR-1, spec-00013-FR-2, spec-00013-FR-4, spec-00013-FR-5, spec-00013-FR-15, spec-00013-FR-16, spec-00013-FR-17 |
| S2 | 作为文档负责人，我要 `persimmon new` 建完就能在切换器里看到这个项目，不用记得再跑一次登记；登记出了问题也别把我刚建好的项目弄丢 | spec-00013-FR-6, spec-00013-FR-7, spec-00013-FR-8 |
| S3 | 作为文档负责人，模板骨架升级后我要把它折进已有项目，我自己的改动一个不丢、真撞上了留冲突标记给我，删掉的东西别给我塞回来 | spec-00013-FR-3, spec-00013-FR-9, spec-00013-FR-10, spec-00013-FR-11, spec-00013-FR-12 |
| S4 | 作为文档负责人，我要先看有哪些模板可用再决定建什么 | spec-00013-FR-13, spec-00013-FR-14 |

## 3. Business Rules

| Rule set | Doc | Covers |
| --- | --- | --- |
| Docs 工作流 | [rule-00001-docs-workflow](../rule/rule-00001-docs-workflow.md) | 不因本 spec 而变；本 spec 不新增业务规则——模板分支与三方合并都是软件概念，拿掉软件后不存在。`new` 建出的项目落地即带模板自带的 `whiteboard.config.yaml` 与 `docs/`，故一落地就满足 workspace 的定义（`CONTEXT.md`）并可被登记（`FR-6`）；这是模板分支内容的后果，不是本 spec 加的规则 |

## 4. System Requirements

- **spec-00013-FR-1** (Event) 当用户执行 `persimmon new <name>` 时，系统应把
  模板仓库的一个分支落地为 `<dir>/<name>` 目录下的新项目。分支的取法：缺省
  `main`；`--lang <l>` 取 `lang/<l>`；`--lang <l> --variant <v>` 取
  `lang/<l>/<v>`；`--ref <branch>` 覆盖以上一切。`--dir <path>` 指定新项目的
  父目录（缺省当前目录）；`--set KEY=VALUE` 可重复地提供模板变量；模板仓库的
  坐标可由环境变量 `AINPT_OWNER` / `AINPT_REPO` 覆盖（名字沿用，
  `decision-00020` §2 第 7 条 ④）。旗标可出现在 `<name>` 之前或之后，结果相同
  （解析方式属 `design-00004` §2；恰一个位置参数由 `FR-4` 保证）。**长旗标写
  一个横杠与写两个横杠等价**——`-lang go` 与 `--lang go`、`-lang=go` 与
  `--lang=go` 结果相同。这条规范化**不由本 spec 立法**：它在解析器层、作用于
  全部八个子命令，由 `spec-00012-FR-15` 持有，本句只是它在 `new` 上的形态
  （第三十二轮的审计据编排者裁定改：本条原自立一份、只覆盖脚手架这几条，与
  那条重复立法）。
- **spec-00013-FR-2** (Event) 当 `new` 取到模板分支时，系统应按该分支
  `template.json` 的声明落地：`exclude` 命中的路径不复制（目录被命中即整棵
  跳过；命中的判据是 `FR-15` 的 glob 语义）；`.git` 与 `template.json` 本身
  永不复制，无需在 `exclude` 里声明；
  变量按「`--set` 给出的 > 该变量声明的 `default`」定值，`default` 自身也做
  占位替换（故 `default` 可写成 `{{name}}` 一类）；`{{name}}` 与
  `{{PROJECT_NAME}}` 缺省即项目名；`substitute` 列出的文件中的 `{{KEY}}` 占位
  以定好的变量替换，列出但该分支实际没有的文件跳过、不构成失败；`post_create`
  的各步在新项目目录内**按声明顺序**依次执行；`vars` 条目与 `post_create`
  步骤上的 `when_lang` / `when_variant` 是精确匹配的门控，与本次 `--lang` /
  `--variant` 不匹配的条目与步骤跳过。变量声明里的 `prompt` 只是给人看的说明：
  **没有交互路径**，缺值一律按 `FR-5` 失败而不是提问。
- **spec-00013-FR-3** (Ubiquitous) 系统应在 `new` 成功时于新项目根目录写下
  创建标记，记住模板仓库坐标、`ref`、`lang`、`variant`、创建时该 ref 的提交
  （即基准）与定好的变量（不含随项目名而变的 `name`）；`update` 以基准做三方
  合并（`FR-9`）。标记的文件名与格式与迁入前一致，故迁入前建出的既有项目
  无需任何迁移即可被 `update` 处理。
- **spec-00013-FR-4** (Unwanted) 若脚手架子命令的参数不合式——`--variant` 未配
  `--lang`、缺 `<name>`、某个 `--set` 的值不含 `=`、或参数解析完之后还剩下
  未读的位置参数——系统应说明是哪一种并拒绝执行，不取模板、不建立任何目录、
  不读写注册表、不改动任何既有文件。**退出码不由本条立法**：用法与解析错误
  一律 2，由 `spec-00012-FR-12` 持有（本条的四种都在它的作用面内——前三种在
  解析器那一层，`--variant` 未配 `--lang` 由该条末段一并纳入）；本条只持有报出
  的是哪一句。`--set` 的值不含 `=` 时报出的那一句**含
  `expected KEY=VALUE, got <该值>` 这个片段，该片段与迁入前逐字相同**——迁入前
  的完整 stderr 是 `invalid value "BAD" for flag -set: expected KEY=VALUE, got "BAD"`
  再加一整份 FlagSet 的 usage dump，其中只有该片段出自 `setFlag.Set`
  （`cli/main.go:256-263`），外层的 `invalid value … for flag -set:` 包装与那份
  usage dump 是 Go `flag` 包的产物，**不复现**（第三十二轮的审计据实改：本条原
  写作整句「与迁入前逐字相同」，那对整句不成立）。**「不得剩余未读的位置参数」
  这一支不由本 spec 限定作用面**：它是解析器层的统一断言，作用于全部八个子命令
  （`spec-00012-FR-12`，实现见 `design-00004` §2），其中脚手架这三条的形态是
  `new` 只收一个 `<name>`、`update` 与 `list-langs` 一个位置参数也不收，故旗标
  与位置参数的任何排列都得同一结果（第三十二轮的审计据编排者裁定改：本条原把
  这一支限定为「三个脚手架子命令」，与 `spec-00012-FR-12` 各立一份）。
- **spec-00013-FR-5** (Unwanted) 若 `new` 在落地过程中失败——目标
  `<dir>/<name>` 已存在、模板分支取不到（此时并提示可执行
  `persimmon list-langs`）、模板声明的某个必需变量（已声明、没有 `default`、
  也未经 `--set` 给出）缺值、或某个 `post_create` 步骤以非 0 退出——系统应报出
  是哪一种并以非 0 退出，**不写创建标记、不登记**（`FR-6`）；本机没有 `tar`
  是其中的又一种，由 `FR-17` 单独持有。目标已存在这一种
  下目标目录的内容一字不改；已开始复制之后才失败的（`post_create` 失败）已
  复制的文件留在原地不回滚，用户自行删除后重来。模板分支可取而其提交号取不到时
  不算失败：项目照常建出并登记，命令给出一句警告，创建标记的基准为空——其后的
  `update` 因此按 `FR-11` 拒绝。
- **spec-00013-FR-6** (Event) 当 `new` 的脚手架成功时，系统应把 `<dir>/<name>`
  登记为 workspace：走与 `persimmon add` 完全相同的登记路径——有已运行进程时
  经它登记（该进程的切换器随即可见新条目），无已运行进程时直接写注册表文件；
  路径规范化、幂等、`id` 派生与可登记判定的语义同 `spec-00011-FR-2` /
  `spec-00011-FR-3`。登记成功后命令的最后一行应给出已登记的条目 id 与「在项目内
  执行 `persimmon` 打开」的提示。**登记没有关闭途径**：不提供跳过它的旗标或
  环境变量，试图给出这样一个旗标应按未知旗标被拒（`FR-4` 的口径）。
- **spec-00013-FR-7** (Unwanted) 若 `new` 登记时该端口被一个不是已运行进程的
  程序占用，系统应仍直接写注册表文件完成登记并以 0 退出——项目已经建好，不因
  一个无关进程占了端口而少登记一步。这与 `spec-00011-FR-15` 对启动路径与
  `add` 的「报端口被占用、非 0 退出」是**有意的不同**（`design-00004` §5）。
- **spec-00013-FR-8** (Unwanted) 若登记本身失败——注册表不合式
  （`spec-00011-FR-18` 的判定）、写盘失败、或经已运行进程被拒——系统应保留已
  建好的项目、不回滚，以一句话报出登记侧的原因并以非 0 退出，且不改写注册表
  文件。项目目录是主产物，登记是附带动作：用户修好原因后 `persimmon add` 即可
  补上。
- **spec-00013-FR-9** (Event) 当用户在一个带创建标记的项目内执行
  `persimmon update [--dir <path>]` 时，系统应取模板仓库在基准与当前 `ref` 两个
  版本，对每个模板管辖文件做三方合并：项目的本地改动保留、上游的增量折入、二者
  重叠处留下常规的 `<<<<<<<` 冲突标记。**只有基准与项目侧都没有该路径时**上游
  文件才作为新增被原样加入（模板管辖文件的判定用 `FR-15` 的 glob 语义）；
  上游有、基准没有而项目侧已有同路径文件的，仍做
  三方合并（共同祖先为空）并计为已合并。项目自有的文件一律不动。合并后系统应
  把基准推进为本次的上游提交，并汇总合并数、新增数、因项目已删而留空的数与
  冲突文件清单，冲突不为空时列出各文件并提示逐个解决后提交。**留下冲突不是
  失败**：命令以 0 退出，基准照样推进——冲突标记已在工作树里，下一次 `update`
  该从这一次的上游提交继续。当前 `ref` 的提交与基准相同时报「已是最新」且不
  改动任何文件。
- **spec-00013-FR-10** (Ubiquitous) 合并的取舍口径应为：只有**基准中不存在**的
  上游文件才算新增——基准有而项目没有的文件是项目自己删过的（含 `post_create`
  删掉的引导物），尊重该删除、不重建，并在汇总中计出；`exclude` 取的是**本次
  上游分支**的 `template.json`（创建标记不记 `exclude`，故排除集随模板演进，
  上游新加的排除项立即生效），它在目录上与在文件上同样生效、命中的目录整棵
  跳过；上游是符号链接的条目不做文本合并——目标一致即通过，上游自基准以来未动
  而项目侧改过则以项目侧为准且不报冲突，其余报为冲突并保持项目侧原样（链接处
  无处安放冲突标记）。符号链接的新增同受 `FR-9` 的两个前提约束。
- **spec-00013-FR-11** (Unwanted) 若 `update` 的前提不成立——目标目录内没有
  创建标记、标记不是合法 JSON、标记里的基准为空、或标记里的模板坐标不是恰
  `owner/repo` 形态——系统应说明是哪一种并以非 0 退出，不改动项目内任何文件。
  坐标的判据是三个条件同时成立：**恰一个斜杠、owner 非空、repo 非空**；
  `norepo`（无斜杠）、`/repo`（owner 空）、`owner/`（repo 空）、
  `owner/repo/extra`（两个斜杠）四种形态都在此被拒，**且在任何网络请求之前**
  ——用户该看到的是「这个值形态不对」，不是远端的一句 404（`issue-00034`）。
- **spec-00013-FR-12** (Unwanted) 若本机 PATH 上没有 `git`，系统应在第一个
  **需要合并**的文件上报出合并失败并以非 0 退出——三方合并逐文件外壳调一次
  `git merge-file`，缺 `git` 在第一个这样的文件上就失败。此时
  **基准不推进**，故此前已加入项目的上游新增文件在重跑时会被再次处理（它们已
  在项目里，按 `FR-9` 走三方合并而不是重复新增）。**工作树因此停在半截更新的
  状态，系统不回滚**：失败之前落地的新增文件与符号链接留在项目里，命令不删除
  它们、也不提供撤销；这是有意的，重跑从同一基准开始即可收敛（`AC-12.1` /
  `AC-12.2`）。不做合并前的一次性预检：一次只新增文件或符号链接的 `update`
  根本不需要 `git`，预检会把这种本可完成的升级也拒掉。`git` 对 `new` 是稳成立
  的前置（`post_create` 要 `git init`），对 `update` **不成立**——`update` 可能
  跑在与创建时不同的机器上，本条正是那台机器上的行为。
- **spec-00013-FR-13** (Event) 当用户执行 `persimmon list-langs` 时，系统应列出
  模板仓库的模板：先一行基础模板，再按语言字典序列出每个有 `lang/*` 分支的
  语言，每个语言之下按字典序列出其变体，以 0 退出。取分支时应**跟随分页直到
  取尽**，不因某一页的条数上限而截断。只有 `lang/<l>/<v>` 而没有 `lang/<l>` 的
  语言仍成组列出，但**不印那条不存在的 `--lang <l>` 基础行**，改在组头标注该
  语言没有基础分支、只能经 `--variant` 使用。没有任何 `lang/*` 分支时输出说明
  只有基础模板可用。
- **spec-00013-FR-14** (Unwanted) 若列分支失败，系统应报错并以非 0 退出：
  请求发不出去时报出该错误；HTTP 状态非 200 时另报出该请求的地址与状态；
  应答不可解析时报出解析错误。**取分支不带凭据、不退避、不重试**：每一页一次
  裸请求，`FR-13` 的分页把请求数乘上去；撞上模板仓库宿主对未认证请求的每小时
  上限后（GitHub 今天是 60 次/小时），它答的 403 即按「HTTP 状态非 200」那一支
  原样呈现——系统不等待、不重试、不降级为部分结果。这是一个选择而不是默认：加凭据要谈凭据存放，加退避要谈
  超时上限，两者都不在本 spec 范围（`design-00004` §6）。
- **spec-00013-FR-15** (Ubiquitous) 系统对 `template.json` 的 `exclude` 模式
  应使用与迁入前逐例等价的 glob 语义判定命中：`*` 与 `?` 匹配任意字符但
  **不跨** `/`；**字符类不受分隔符约束**——`[^A-Z]` 与 `[/]` 都匹配 `/`，
  实现不得从用户写的字符类里剔掉 `/`；`!` 在字符类里是字面成员
  **不是**否定符，否定符只有 `^`；模式整串锚定，`a` 不匹配 `ab`；反斜杠转义
  下一个字符。模式**只作用于路径本身**。
  一条 `exclude` 模式的命中判定由**两个互相独立的半边**依次组成，实现不得把
  它们合成一个 glob：**先剥掉模式尾部的 `/`**（`a/` 与 `a` 同义），以剥后的
  模式做**字面串**比较——路径与它相等、或以「它加一个 `/`」开头即命中（目录
  被命中即整棵跳过），这一半**不经任何 glob**；**其后**才把整条模式按上述
  glob 语义判一次。两半任一命中即排除。这不是措辞细节：`AC-2.1` 的 `.github/`
  排除掉的是**该目录下的文件**，而那全靠字面串这一半。实测三格（剥尾斜杠后
  `p` 已是 `.github`，故 glob 永远拿不到带斜杠的原模式）：
  `filepath.Match(".github", ".github")` = `true`——只走 glob 也能命中目录
  **自身**，这正是该误实现看起来能用的原因；
  `filepath.Match(".github", ".github/workflows/ci.yml")` = **`false`**；
  而 `strings.HasPrefix(".github/workflows/ci.yml", ".github/")` = **`true`**
  ——承重的是这一格。只走 glob 的实现会让目录自身被排除、其下文件却照常
  落地，`AC-2.1` 静默失效（`cli/internal/scaffold/scaffold.go:223-235`；
  第三十二轮的审计补入这一段：本条原文只说「前缀匹配那一半不变」，据此
  两种实现都写得出来。审计同时纠正了本段初稿引错的实测值——初稿引的是
  `Match(".github/", ".github")` = `false`，那一格 `filepath.Match` 根本
  到不了）。
  这条语义在 `new`（`FR-2`）与 `update`（`FR-10`）两处同为判据：
  两处若不一致，创建时排除掉的东西会在 `update` 时长回来。
- **spec-00013-FR-16** (Unwanted) 若某条 `exclude` 模式不合式——实现无法把它
  译成一条可用的匹配式——系统应把该模式的 **glob 判定**按不匹配处理并静默跳过，
  **不抛错、不中止** `new` 或 `update`。不合式只使这一半失效：`FR-15` 的字面串
  那一半照常先跑，故一个字面名恰为 `[a-` 的路径仍被模式 `[a-` 排除
  （第三十二轮的审计据实改：本条原作「按不匹配任何路径处理」，那是绝对陈述，
  对字面同名的路径不成立）。`exclude` 来自用户可编辑的
  `template.json`，这条路径可达；迁入前的实现丢弃了匹配函数的错误返回值，
  不合式模式因此既不匹配也不报错，本条把那个行为写定为需求，而不是留给
  下一个实现去重新发明（`design-00004` §6）。
- **spec-00013-FR-17** (Unwanted) 若本机 PATH 上没有 `tar`，系统应在解归档这
  一步报出该缺失并以非 0 退出：`new` 此时尚未在目标位置落下任何东西，
  `<dir>/<name>` 不建立、创建标记不写、注册表不动；`update` 此时一个文件也
  还没合并，项目内文件一字未改。外壳 `tar` 与 `git`（`FR-12`）是本命令**自己
  直接依赖**的两个外部前置——`tar` 对 `new` 与 `update` 都必需（两者都要解模板
  分支的 tarball），`git` 只在 `update` 真需要合并时必需。第三个外部命令是
  `sh`：`post_create` 的每一步都经 `sh -c` 执行
  （`FR-2`，`cli/internal/scaffold/scaffold.go:306`），但它是模板声明的步骤的
  执行器、不是本命令自己的调用，本条的报错义务不及于它（第三十二轮的审计据实
  改：本条原作「仅有的两个外部前置」，`sh` 使那句为假）。

**Acceptance (GWT)**

- **spec-00013-AC-1.1** (spec-00013-FR-1)
  Given 模板仓库的 `main` 分支存在，当前目录下没有 `demo`
  When 执行 `persimmon new demo`
  Then `./demo` 建出，其内容来自 `main`
- **spec-00013-AC-1.2** (spec-00013-FR-1)
  Given 模板仓库有分支 `lang/go`
  When 执行 `persimmon new svc --lang go`
  Then `./svc` 的内容来自 `lang/go`
- **spec-00013-AC-1.3** (spec-00013-FR-1)
  Given 模板仓库有分支 `lang/java/ddd`
  When 执行 `persimmon new app --lang java --variant ddd`
  Then `./app` 的内容来自 `lang/java/ddd`
- **spec-00013-AC-1.4** (spec-00013-FR-1)
  Given 模板仓库有分支 `lang/go` 与 `spike`
  When 执行 `persimmon new demo --lang go --ref spike`
  Then 内容来自 `spike`——`--ref` 覆盖由 `--lang` 推出的分支
- **spec-00013-AC-1.5** (spec-00013-FR-1)
  Given 目录 `/work` 存在且可写
  When 执行 `persimmon new demo --dir /work`
  Then 项目建在 `/work/demo`
- **spec-00013-AC-1.6** (spec-00013-FR-1)
  Given 环境变量 `AINPT_OWNER=acme`、`AINPT_REPO=tpl`
  When 执行 `persimmon new demo`
  Then 取的是 `acme/tpl` 的模板而不是缺省坐标的
- **spec-00013-AC-1.7** (spec-00013-FR-1)
  Given 模板的 `template.json` 声明变量 `MODULE_PATH`
  When 执行 `persimmon new demo --set MODULE_PATH=example.com/x --set EXTRA=1`
  Then 两个变量都进入替换——`--set` 可重复
- **spec-00013-AC-1.8** (spec-00013-FR-1)
  Given 模板仓库有分支 `lang/go`
  When 执行 `persimmon new --lang go demo`（旗标在位置参数之前）
  Then 结果与 `persimmon new demo --lang go` 相同
- **spec-00013-AC-1.9** (spec-00013-FR-1)
  Given 模板仓库有分支 `lang/go`
  When 执行 `persimmon new svc -lang go`（长旗标只写一个横杠）
  Then 结果与 `persimmon new svc --lang go` 相同
- **spec-00013-AC-2.1** (spec-00013-FR-2)
  Given 模板分支的 `template.json` 的 `exclude` 含 `.github/`
  When `new` 建出项目
  Then 项目内没有 `.github/`
- **spec-00013-AC-2.2** (spec-00013-FR-2)
  Given 模板分支的 `template.json` 的 `exclude` 既没写 `.git` 也没写 `template.json`
  When `new` 建出项目
  Then 项目内既没有 `.git/` 也没有 `template.json`
- **spec-00013-AC-2.3** (spec-00013-FR-2)
  Given `substitute` 列出 `README.md`，模板的该文件含 `{{PROJECT_NAME}}`
  When 执行 `persimmon new demo`
  Then 项目的 `README.md` 中该占位已成 `demo`
- **spec-00013-AC-2.4** (spec-00013-FR-2)
  Given 变量 `ARTIFACT_ID` 声明了 `default` 为 `{{name}}`，用户未给 `--set`
  When 执行 `persimmon new demo`
  Then 该变量取值 `demo`——`default` 自身也做占位替换
- **spec-00013-AC-2.5** (spec-00013-FR-2)
  Given `post_create` 含一步标了 `when_lang: go`
  When 执行 `persimmon new demo`（未给 `--lang`）
  Then 该步不执行
- **spec-00013-AC-2.6** (spec-00013-FR-2)
  Given `post_create` 含一步标了 `when_lang: go`
  When 执行 `persimmon new demo --lang go`
  Then 该步在新项目目录内执行
- **spec-00013-AC-2.7** (spec-00013-FR-2)
  Given `post_create` 声明了三步，其中第二步的效果依赖第一步
  When 执行 `persimmon new demo`
  Then 三步按声明顺序在项目目录内依次执行
- **spec-00013-AC-2.8** (spec-00013-FR-2)
  Given `substitute` 列出一个该分支实际没有的文件
  When `new` 建出项目
  Then 命令不因此失败，项目照常建成
- **spec-00013-AC-3.1** (spec-00013-FR-3)
  Given 模板分支 `lang/go` 的最新提交为 `abc1234`
  When 执行 `persimmon new svc --lang go`
  Then `svc` 的创建标记记下模板坐标、`ref` 为 `lang/go`、`lang` 为 `go`、基准为 `abc1234`
- **spec-00013-AC-3.2** (spec-00013-FR-3)
  Given 执行 `persimmon new demo --set MODULE_PATH=example.com/x`
  When 读该项目的创建标记
  Then 其变量表含 `MODULE_PATH` 与 `PROJECT_NAME`，不含 `name`
- **spec-00013-AC-3.3** (spec-00013-FR-3)
  Given 一个由迁入前的 `ainpt` 建出、根目录已有创建标记的既有项目（本仓库即是其一）
  When 在其中执行 `persimmon update`
  Then 命令照常合并，无需任何迁移步骤
- **spec-00013-AC-4.1** (spec-00013-FR-4)
  Given 当前目录下没有 `app`
  When 执行 `persimmon new app --variant ddd`（未给 `--lang`）
  Then 命令说明 `--variant` 需要 `--lang` 并以非 0 退出，`./app` 未建立
- **spec-00013-AC-4.2** (spec-00013-FR-4)
  Given 命令已装好
  When 执行 `persimmon new`（未给 `<name>`）
  Then 命令打印该子命令的用法并以非 0 退出，未建立任何目录
- **spec-00013-AC-4.3** (spec-00013-FR-4)
  Given 当前目录下没有 `demo`
  When 执行 `persimmon new demo --set BAD`（值不含 `=`）
  Then 报出的那一句含 `expected KEY=VALUE, got "BAD"`，`./demo` 未建立——
  退出码按 `spec-00012-FR-12`，本条不另立（第三十二轮的审计据编排者裁定改：
  本条原自断言「以非 0 退出」，与 `spec-00012-AC-12.1` 是同一场景的两条 AC）
- **spec-00013-AC-4.4** (spec-00013-FR-4)
  Given 当前目录下没有 `demo` 也没有 `extra`
  When 执行 `persimmon new demo extra`（两个位置参数）
  Then 命令说明只接受一个 `<name>`、打印用法并以非 0 退出，两个目录都未建立
- **spec-00013-AC-4.5** (spec-00013-FR-4)
  Given 一个带创建标记的项目
  When 在其中执行 `persimmon update extra`（一个多余的位置参数）
  Then 命令说明 `update` 不接受位置参数并以非 0 退出，项目内文件一字未改
- **spec-00013-AC-5.1** (spec-00013-FR-5)
  Given `./demo` 已存在且其中有文件
  When 执行 `persimmon new demo`
  Then 命令说明目标已存在并以非 0 退出，`./demo` 的内容一字未改，注册表不变
- **spec-00013-AC-5.2** (spec-00013-FR-5)
  Given 模板仓库没有分支 `lang/rust`
  When 执行 `persimmon new demo --lang rust`
  Then 命令报取不到该分支、提示可执行 `persimmon list-langs`，以非 0 退出，`./demo` 未建立
- **spec-00013-AC-5.3** (spec-00013-FR-5)
  Given 模板声明变量 `MODULE_PATH`（有 `prompt`、无 `default`），用户未给 `--set`
  When 执行 `persimmon new demo`
  Then 命令说明缺该变量并指出用 `--set MODULE_PATH=VALUE`，以非 0 退出，不向用户提问，`./demo` 未建立
- **spec-00013-AC-5.4** (spec-00013-FR-5)
  Given 模板的某个 `post_create` 步骤以非 0 退出
  When 执行 `persimmon new demo`
  Then 命令报出是哪一步失败并以非 0 退出，`./demo` 内没有创建标记，注册表不变
- **spec-00013-AC-5.5** (spec-00013-FR-5)
  Given 模板的某个 `post_create` 步骤以非 0 退出
  When 检视 `./demo`
  Then 此前已复制的文件仍在原地——命令不回滚
- **spec-00013-AC-5.6** (spec-00013-FR-5)
  Given 模板分支可取，但取其提交号的请求失败
  When 执行 `persimmon new demo`
  Then 项目照常建出并登记，命令给出一句警告，创建标记的基准为空
- **spec-00013-AC-6.1** (spec-00013-FR-6)
  Given 该端口上没有已运行进程，注册表为空
  When 执行 `persimmon new demo --dir /work`
  Then 注册表新增一条，其路径为 `/work/demo`
- **spec-00013-AC-6.2** (spec-00013-FR-6)
  Given 一个已运行进程在监听且其切换器处于打开态，注册表为空
  When 执行 `persimmon new demo --dir /work`
  Then 登记经该进程完成、其切换器随即列出该条，命令不起第二个服务
- **spec-00013-AC-6.3** (spec-00013-FR-6)
  Given 脚手架与登记都成功
  When 读命令的最后一行输出
  Then 它给出已登记的条目 id 与在项目内执行 `persimmon` 打开的提示
- **spec-00013-AC-6.4** (spec-00013-FR-6)
  Given `/work` 是指向 `/private/work` 的符号链接，注册表为空
  When 执行 `persimmon new demo --dir /work`
  Then 条目的路径为 `/private/work/demo`
- **spec-00013-AC-6.5** (spec-00013-FR-6)
  Given 当前目录下没有 `demo`
  When 执行 `persimmon new demo --no-register`
  Then 命令按未知旗标拒绝并以非 0 退出，项目未建立——登记没有关闭途径
- **spec-00013-AC-7.1** (spec-00013-FR-7)
  Given 该端口被一个不是已运行进程的程序占用，注册表为空
  When 执行 `persimmon new demo`
  Then 项目建出、注册表得到该条，命令以 0 退出
- **spec-00013-AC-7.2** (spec-00013-FR-7)
  Given 上一条的条目已直接写入注册表文件
  When 其后启动一个已运行进程并打开切换器
  Then 该条在列，与经进程登记的条目没有分别
- **spec-00013-AC-8.1** (spec-00013-FR-8)
  Given 注册表文件存在但不可解析
  When 执行 `persimmon new demo`
  Then 项目建出且完整，命令以一句话报出注册表的问题并以非 0 退出，注册表文件未被改写
- **spec-00013-AC-8.2** (spec-00013-FR-8)
  Given 注册表文件所在目录不可写
  When 执行 `persimmon new demo`
  Then 项目建出且完整，命令以一句话报出写盘失败并以非 0 退出
- **spec-00013-AC-8.3** (spec-00013-FR-8)
  Given 一个已运行进程在监听，它对该路径的登记以 422 拒绝
  When 执行 `persimmon new demo`
  Then 项目建出且完整，命令以一句话报出该进程给出的拒绝原因并以非 0 退出
- **spec-00013-AC-8.4** (spec-00013-FR-8)
  Given 上述任一失败之后，用户已排除该原因
  When 在该项目内执行 `persimmon add`
  Then 该项目照常登记
- **spec-00013-AC-9.1** (spec-00013-FR-9)
  Given 项目由 `new` 建出，其后用户改过某模板管辖文件，上游对该文件另有改动且两处不重叠
  When 执行 `persimmon update`
  Then 该文件同时含用户的改动与上游的改动
- **spec-00013-AC-9.2** (spec-00013-FR-9)
  Given 用户与上游改的是同一处
  When 执行 `persimmon update`
  Then 该文件留下 `<<<<<<<` 冲突标记，命令列出该文件并提示解决后提交
- **spec-00013-AC-9.3** (spec-00013-FR-9)
  Given 用户与上游改的是同一处
  When 执行 `persimmon update`
  Then 命令以 0 退出——留下冲突不是失败
- **spec-00013-AC-9.4** (spec-00013-FR-9)
  Given 本次合并留下了冲突
  When 读该项目的创建标记
  Then 基准已推进为本次的上游提交
- **spec-00013-AC-9.5** (spec-00013-FR-9)
  Given 合并完成且没有冲突
  When 读该项目的创建标记
  Then 基准已推进为本次的上游提交
- **spec-00013-AC-9.6** (spec-00013-FR-9)
  Given 项目里有一个模板从未有过的文件
  When 执行 `persimmon update`
  Then 该文件一字未改
- **spec-00013-AC-9.7** (spec-00013-FR-9)
  Given 上游新增了一个基准里不存在的文件，项目里也没有该路径
  When 执行 `persimmon update`
  Then 该文件被原样加入项目，汇总中计为新增
- **spec-00013-AC-9.8** (spec-00013-FR-9)
  Given 上游新增了一个基准里不存在的文件，而项目里已有同路径的自己的文件
  When 执行 `persimmon update`
  Then 该文件不被覆盖，而是与上游做共同祖先为空的三方合并、计为已合并（重叠处留冲突标记）
- **spec-00013-AC-9.9** (spec-00013-FR-9)
  Given 基准与当前 `ref` 的提交相同
  When 执行 `persimmon update`
  Then 命令报「已是最新」，不改动任何文件，以 0 退出
- **spec-00013-AC-9.10** (spec-00013-FR-9)
  Given 带创建标记的项目在 `path/to/proj`
  When 在别处执行 `persimmon update --dir path/to/proj`
  Then 被合并的是该目录
- **spec-00013-AC-10.1** (spec-00013-FR-10)
  Given 基准里有一个文件而项目里没有（创建后被 `post_create` 或用户删掉）
  When 执行 `persimmon update`
  Then 该文件不被重建，汇总说明有文件因项目已删而留空
- **spec-00013-AC-10.2** (spec-00013-FR-10)
  Given 上游分支的 `template.json` 新增了一条创建时不存在的 `exclude` 模式，命中项目里的一批文件
  When 执行 `persimmon update`
  Then 那批文件不参与合并——排除集取自本次上游分支，不是创建时那一份
- **spec-00013-AC-10.3** (spec-00013-FR-10)
  Given `exclude` 的某个模式命中的是一个目录而非其中的文件
  When 执行 `persimmon update`
  Then 该目录整棵不参与合并
- **spec-00013-AC-10.4** (spec-00013-FR-10)
  Given 上游有一个符号链接，项目里也是指向同一目标的符号链接
  When 执行 `persimmon update`
  Then 链接与其所指的目标文件都未被合并结果覆盖
- **spec-00013-AC-10.5** (spec-00013-FR-10)
  Given 上游自基准以来改了某符号链接的目标，项目里那个位置是用户放的普通文件
  When 执行 `persimmon update`
  Then 命令把它报为冲突并保持项目侧原样
- **spec-00013-AC-10.6** (spec-00013-FR-10)
  Given 上游那个符号链接自基准以来未动，项目却把它改指了别处
  When 执行 `persimmon update`
  Then 以项目侧为准，不报冲突
- **spec-00013-AC-11.1** (spec-00013-FR-11)
  Given 某目录内没有创建标记
  When 在其中执行 `persimmon update`
  Then 命令说明该目录里没有创建标记并以非 0 退出，目录内文件一字未改
- **spec-00013-AC-11.2** (spec-00013-FR-11)
  Given 创建标记不是合法 JSON
  When 执行 `persimmon update`
  Then 命令说明解析失败并以非 0 退出，项目内文件一字未改
- **spec-00013-AC-11.3** (spec-00013-FR-11)
  Given 创建标记的基准为空（`spec-00013-AC-5.6` 的产物）
  When 执行 `persimmon update`
  Then 命令说明没有基准、无法三方合并并以非 0 退出，项目内文件一字未改
- **spec-00013-AC-11.4** (spec-00013-FR-11)
  Given 创建标记里的模板坐标为 `/repo`（斜杠前一段为空）
  When 执行 `persimmon update`
  Then 命令指明该值不是 `owner/repo` 形态并以非 0 退出，项目内文件一字未改
- **spec-00013-AC-11.5** (spec-00013-FR-11)
  Given 创建标记里的模板坐标为 `owner/repo/extra`（两个斜杠）
  When 执行 `persimmon update`
  Then 命令指明该值不是 `owner/repo` 形态并以非 0 退出
- **spec-00013-AC-11.6** (spec-00013-FR-11)
  Given 创建标记里的模板坐标为 `owner/`（斜杠后一段为空）
  When 执行 `persimmon update`
  Then 命令指明该值不是 `owner/repo` 形态并以非 0 退出，项目内文件一字未改
- **spec-00013-AC-12.1** (spec-00013-FR-12)
  Given 本机 PATH 上没有 `git`，项目有需要合并的模板管辖文件
  When 执行 `persimmon update`
  Then 命令在第一个需要合并的文件上报出合并失败并以非 0 退出
- **spec-00013-AC-12.2** (spec-00013-FR-12)
  Given 上一条失败之后
  When 读该项目的创建标记
  Then 基准未推进——重跑 `update` 仍从同一个基准开始
- **spec-00013-AC-12.3** (spec-00013-FR-12)
  Given 本机 PATH 上没有 `git`，本次 `update` 在失败前已把一个上游新增文件落进项目
  When `update` 在第一个需要合并的文件上失败退出后检视该项目
  Then 那个新增文件仍在项目里——命令不回滚这棵半截更新的工作树
- **spec-00013-AC-13.1** (spec-00013-FR-13)
  Given 模板仓库有分支 `lang/go`、`lang/java`、`lang/java/ddd`
  When 执行 `persimmon list-langs`
  Then 输出先列基础模板一行，再按字典序列 `go`、`java`，`ddd` 列在 `java` 之下，命令以 0 退出
- **spec-00013-AC-13.2** (spec-00013-FR-13)
  Given 模板仓库没有任何 `lang/*` 分支
  When 执行 `persimmon list-langs`
  Then 输出说明只有基础模板可用，命令以 0 退出
- **spec-00013-AC-13.3** (spec-00013-FR-13)
  Given 模板仓库有 `lang/java/ddd` 但没有 `lang/java`
  When 执行 `persimmon list-langs`
  Then `java` 成组列出并标注它没有基础分支，`ddd` 列在其下，输出里没有 `--lang java` 那一行
- **spec-00013-AC-13.4** (spec-00013-FR-13)
  Given 模板仓库的分支数超过单页上限，`lang/zzz` 只出现在第二页
  When 执行 `persimmon list-langs`
  Then `zzz` 也在输出里——取分支跟随分页直到取尽
- **spec-00013-AC-14.1** (spec-00013-FR-14)
  Given 列分支的请求发不出去（无网络）
  When 执行 `persimmon list-langs`
  Then 命令报出该错误并以非 0 退出
- **spec-00013-AC-14.2** (spec-00013-FR-14)
  Given 列分支的请求返回 403
  When 执行 `persimmon list-langs`
  Then 命令报出该请求的地址与状态并以非 0 退出
- **spec-00013-AC-14.3** (spec-00013-FR-14)
  Given 列分支的应答是 200 但正文不可解析
  When 执行 `persimmon list-langs`
  Then 命令报出解析错误并以非 0 退出
- **spec-00013-AC-14.4** (spec-00013-FR-14)
  Given 列分支的第一次请求即因未认证的每小时上限被答以 403
  When 执行 `persimmon list-langs`
  Then 命令只发出过那一次请求——不等待、不重试
- **spec-00013-AC-15.1** (spec-00013-FR-15)
  Given `exclude` 含 `*.md`，模板分支里有 `README.md` 与 `docs/a.md`
  When `new` 建出项目
  Then `README.md` 未落地而 `docs/a.md` 落地——`*` 不跨 `/`
- **spec-00013-AC-15.2** (spec-00013-FR-15)
  Given `exclude` 含 `docs[^A-Z]draft.md`，模板分支里有 `docs/draft.md`
  When `new` 建出项目
  Then `docs/draft.md` 未落地——字符类不受分隔符约束，`[^A-Z]` 匹配 `/`
- **spec-00013-AC-15.3** (spec-00013-FR-15)
  Given `exclude` 含 `[!x]y.md`，模板分支里有 `!y.md` 与 `ay.md`
  When `new` 建出项目
  Then `!y.md` 未落地而 `ay.md` 落地——`!` 是类里的字面成员，不是否定符
- **spec-00013-AC-15.4** (spec-00013-FR-15)
  Given `exclude` 含 `READM`，模板分支里有 `README.md`
  When `new` 建出项目
  Then `README.md` 照常落地——模式整串锚定，不作前缀匹配
- **spec-00013-AC-15.5** (spec-00013-FR-15)
  Given 某条带否定字符类的 `exclude` 模式在创建时排除掉了一批文件，上游分支的
  `template.json` 仍带着它
  When 执行 `persimmon update`
  Then 那批文件仍不参与合并、不被塞回项目——两处判据同一
- **spec-00013-AC-15.6** (spec-00013-FR-15)
  Given `exclude` 含 `.github/`（带尾部斜杠），模板分支里有 `.github/workflows/ci.yml`
  When `new` 建出项目
  Then 该文件未落地——尾部斜杠先被剥掉，`.github` 以**字面串**前缀命中
  （`strings.HasPrefix(".github/workflows/ci.yml", ".github/")` 为 `true`）；
  这一半不经 glob——`filepath.Match(".github", ".github/workflows/ci.yml")`
  实测为 `false`，只走 glob 的实现会排除掉目录自身却漏过其下文件，
  使 `AC-2.1` 静默失效
- **spec-00013-AC-15.7** (spec-00013-FR-15)
  Given `exclude` 含 `doc?`，模板分支里有 `docs/a.md`
  When `new` 建出项目
  Then `docs/a.md` 照常落地——字面串那一半要求整段相等或以 `doc?/` 开头，
  glob 那一半整串锚定且 `?` 不跨 `/`，两半都不命中
- **spec-00013-AC-16.1** (spec-00013-FR-16)
  Given `exclude` 含 `[a-`（不合式，译不出匹配式），模板分支里没有字面名为
  `[a-` 的路径
  When 执行 `persimmon new demo`
  Then 项目照常建出、命令以 0 退出，该模式一个路径也没命中，未报任何错
- **spec-00013-AC-16.2** (spec-00013-FR-16)
  Given 上游分支的 `template.json` 的 `exclude` 含 `*[`（不合式）
  When 执行 `persimmon update`
  Then 合并照常完成、命令不中止——不合式模式在 `update` 侧同样按不匹配处理
- **spec-00013-AC-17.1** (spec-00013-FR-17)
  Given 本机 PATH 上没有 `tar`，当前目录下没有 `demo`
  When 执行 `persimmon new demo`
  Then 命令报出 `tar` 缺失并以非 0 退出，`./demo` 未建立，注册表不变
- **spec-00013-AC-17.2** (spec-00013-FR-17)
  Given 本机 PATH 上没有 `tar`，一个带创建标记的项目，且上游 `ref` 的提交与
  基准**不同**（相同则 `update` 按 `FR-9` 在取 tarball 之前就报「已是最新」
  返回，根本走不到解归档；第三十二轮的审计据实补足 Given）
  When 在其中执行 `persimmon update`
  Then 命令报出 `tar` 缺失并以非 0 退出，项目内文件一字未改、基准未推进

## 5. Technical Design

| Design | Doc | Covers |
| --- | --- | --- |
| 命令面与参数解析（含解析器层的剩余位置参数断言） | [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md) §2 | `FR-1`、`FR-4`、`FR-13` |
| `new` 的登记闭环 | 同上 §5 | `FR-6` … `FR-8` |
| 代码位置与移植面：脚手架落 `src/scaffold.ts`、命令层落 `src/cli.ts`，移植面按**函数**计；Go→TS 机制对照表（外壳 `tar` 解归档、`git merge-file` 的调用形状与空临时文件作祖先、手写 glob 翻译器、`util.parseArgs` 覆盖不到的三处） | 同上 §6 | 全部 FR 的实现结构，`FR-15` … `FR-17` 的技术依据 |

`design-00004` 已声明 `informs` 本 spec——那条边在树里，不是待办。**§6 是代码
位置与移植面的唯一权威**：本 spec 不写目录树、不点名实现文件之外的坐标；
第三十二轮之前文内以 `cli/…`（Go）为坐标的表述已全部撤去，那些路径只在
`design-00004` 的历史追注里作史料。注册表的文件契约是
`design-00003-multi-workspace`
§2，由 `spec-00011` 持有，本 spec 的 `FR-6` … `FR-8` 经 `design-00004` §4 / §5
引用它，不另开一份契约。

## 6. Out of Scope

- **`spec-00012-persimmon-command` 持有的**：子命令集与未知子命令的拒绝
  （`spec-00012-FR-1`、`spec-00012-FR-2`）；无子命令的启动路径——同进程起服务、
  信号、退出码（`spec-00012-FR-3` / `FR-4`，第三十二轮改写为同进程模型）；
  `version`（`spec-00012-FR-9`）；命令的取得形态（`spec-00012-FR-10`）；
  **解析器层的两条规则**——用法与解析错误一律退 2、剩余位置参数的统一断言
  （`spec-00012-FR-12`），单横杠长旗标规范化为双横杠（`spec-00012-FR-15`），
  两者都作用于全部八个子命令，本 spec 的 `FR-4` 与 `FR-1` 引它们、不另立
  （第三十二轮的审计据编排者裁定补入这一项）。
  该 spec 原先持有的版本配对、开发覆盖、缺 Node 与开发态构建的失败、安装时的
  校验和（`FR-5` … `FR-8`、`FR-11`）随两产物形态与 `install.sh` 一并作废
  （`decision-00020` §5），它们本就不在本 spec 之内，此处只作坐标交代。
- **`spec-00011-multi-workspace` 持有的**：注册表的位置、格式与整份校验
  （`spec-00011-FR-1`、`spec-00011-FR-18`）；`add` / `remove` / `list` 的行为
  （`spec-00011-FR-2` … `spec-00011-FR-5`、`spec-00011-FR-21`）；可用性判定
  （`spec-00011-FR-6`）；启动路径的登记与接入（`spec-00011-FR-13`、
  `spec-00011-FR-14`）；端口被他人占用时启动路径与 `add` 的拒绝
  （`spec-00011-FR-15`）。本 spec 的 `FR-6` 走的是同一条登记路径，语义在那边。
- 模板仓库的内容：`template.json` 的字段设计、有哪些语言与变体分支、
  `post_create` 具体做什么、模板里的 `whiteboard.config.yaml` 长什么样。本 spec
  只规定命令**如何处置** `template.json` 所声明的东西（`FR-2`）。
- `config` 子命令与白板界面里的 workspace 创建（`decision-00020` §2 第 7 条 ⑥）；
  后者到来时由 Host 直接调用同进程的脚手架模块（同决定 §2 第 8 条，第三十二轮
  推翻了原先的「以子进程调 `persimmon new`」），脚手架逻辑仍只此一份。
- 交互式脚手架：变量缺值一律失败（`FR-2`、`FR-5`），不提问、不读 TTY。
- `update` 的事务性：合并中途失败不回滚已加入的文件（`FR-12`），也不提供
  `--abort` 一类的撤销。
- 离线兜底：`new` 与 `update` 都要取网络上的模板，无网络时按各自的失败路径报错
  （`FR-5`、`FR-9` 的取模板失败）；不设本地模板缓存。
- 脚手架逻辑的第二份实现。任何新的命令行入口只能加在同一个包里
  （`decision-00020` §2 第 9 条：「今后不得再为命令行引入第二种实现语言，
  不得再出现第二份注册表实现或第二份脚手架」）。
- **Windows**：不在支持范围内（`decision-00020` §2 第 10 条，域主 2026-09-09
  裁定），本 spec 的任何一条需求都不对 Windows 作断言。理由与本 spec 直接相关：
  模板产出的项目带 `CLAUDE.md -> AGENTS.md` 符号链接（本仓库根即一例），
  Windows 上建符号链接要 Developer Mode 或提权，而符号链接的落地与
  `update` 时的四种处置（`FR-10`）正是本 spec 的核心内容之一；解归档改用外壳
  `tar`（`FR-17`），它在 Windows 上不保证存在。支持矩阵见 §7。

## 7. Non-Functional

- **支持平台**：linux 与 darwin。`new` 与 `update` 依赖的外壳 `tar`
  （`FR-17`）与 `git`（`FR-12`）在这两个平台上的行为一致性——`tar` 读标准输入
  加 `--strip-components=1` 在 macOS 的 bsdtar 与 Linux 的 GNU tar 上对目录、
  普通文件、符号链接与权限位的处置，`git merge-file` 以空临时文件作共同祖先时
  的输出与退出码——须由实施的 plan 实测确认，仓库内无从断言
  （`design-00004` §10）。Windows 见 §6。
- **回归约束**：移植是重写，最容易让老缺陷原样长回来。四条已修缺陷
  （`issue-00034` / `00035` / `00036` / `00037`，需求归属见 §1）各须留**一条
  引其 issue id 的回归测试**（`decision-00020` §2 第 4 条）；除这四处更正外，
  脚手架的行为语义一律不改（同决定 §2 第 3 条）。此后再发现的缺陷仍按
  `AGENTS.md` §8 先开 `docs/issue`、先写失败的测试再改。
- **测试形态与覆盖率**：本 spec 的验收由 `src/` 之下的 vitest 用例承载
  （`TESTING.md`），受 `vitest.config.ts` 的 90% 行 / 分支 / 函数三项约束。
  命令层 `src/cli.ts` **同受这一道门**，由 `spec-00012` §7 认领（那边另写明
  `bin/` 里不得有 argv 透传之外的逻辑，免得薄入口成为门的逃逸口）——同一道门，
  两份 spec 一个口径，不各说各的（第三十二轮的审计据编排者裁定补入这一句：
  此前只有本 spec 认领 `src/`）。
  Go 侧 `scaffold` 那条 legacy 记债的棘轮（迁入时 25.7%、`plan-00033` 收到
  82.8%）**不随代码迁移过来**：移植后的代码按新代码对待
  （`decision-00020` §4）。做法是先把既有的 Go 测试**等价**译过来，再在其上
  补足三项门槛所缺的用例——先等价翻译再叠加，是压制译错风险的做法。
- `new` 与 `update` 各取一次模板分支的 tarball（`update` 取两次：基准与上游），
  耗时受网络支配；不设进度条要求，也不做速率限制的退避与重试（`FR-14`）。

## Links

- Parent: [prd-00003-multi-workspace](../prd/prd-00003-multi-workspace.md)
- Decision: [decision-00020-unified-go-cli](../decision/decision-00020-unified-go-cli.md)（它的 `constrains` 列出本 spec；spec 不携带 `implements`，`docs/README.md` 关系规则）
- Design: [design-00004-persimmon-cli](../design/design-00004-persimmon-cli.md) §2/§5/§6 · [design-00003-multi-workspace](../design/design-00003-multi-workspace.md) §2（经 `design-00004` 引用）
- 并列 spec: [spec-00012-persimmon-command](spec-00012-persimmon-command.md) · [spec-00011-multi-workspace](spec-00011-multi-workspace.md)（分界见 §6）
- Rules: [rule-00001-docs-workflow](../rule/rule-00001-docs-workflow.md)（不变）
